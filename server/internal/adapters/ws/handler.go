package ws

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/versatile-sh/live/server/internal/domain/room"
	"github.com/versatile-sh/live/server/internal/domain/shared"
	"github.com/versatile-sh/live/server/internal/ports/inbound"
)

const outboxSize = 32

// Config bounds what one connection may cost the server.
type Config struct {
	Origins      []string
	HelloTimeout time.Duration
	PingEvery    time.Duration
	PingTimeout  time.Duration
	WriteTimeout time.Duration
	ReadLimit    int64
	FramesPerSec float64
	FrameBurst   float64
}

// DefaultConfig returns the limits of lv.1 for the given allowed origins.
func DefaultConfig(origins []string) Config {
	return Config{
		Origins:      origins,
		HelloTimeout: 5 * time.Second,
		PingEvery:    4 * time.Second,
		PingTimeout:  4 * time.Second,
		WriteTimeout: 5 * time.Second,
		ReadLimit:    16 << 10,
		FramesPerSec: 20,
		FrameBurst:   40,
	}
}

// Handler upgrades HTTP requests into lv.1 sessions.
type Handler struct {
	presence inbound.Presence
	cfg      Config
}

// NewHandler builds the WebSocket endpoint over the presence port.
func NewHandler(presence inbound.Presence, cfg Config) *Handler {
	return &Handler{presence: presence, cfg: cfg}
}

// ServeHTTP accepts one connection and serves it until it ends.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{Subprotocols: []string{Subprotocol}, OriginPatterns: h.cfg.Origins})
	if err != nil {
		return
	}
	if conn.Subprotocol() != Subprotocol {
		conn.Close(websocket.StatusPolicyViolation, "subprotocol lv.1 required")
		return
	}
	conn.SetReadLimit(h.cfg.ReadLimit)
	ctx, cancel := context.WithCancel(r.Context())
	s := &session{handler: h, conn: conn, out: make(chan []byte, outboxSize), cancel: cancel}
	code, reason := s.serve(ctx)
	cancel()
	s.writers.Wait()
	conn.Close(code, reason)
}

type session struct {
	handler *Handler
	conn    *websocket.Conn
	out     chan []byte
	cancel  context.CancelFunc
	writers sync.WaitGroup

	mu      sync.Mutex
	closing room.CloseReason

	slug room.Slug
	seat room.Seat
	left bool
}

// Roster queues a snapshot and reports false when the outbox is full.
func (s *session) Roster(snapshot room.Snapshot) bool {
	select {
	case s.out <- encodeRoster(snapshot):
		return true
	default:
		return false
	}
}

// Close ends the connection from the room's side without blocking the room.
func (s *session) Close(reason room.CloseReason) {
	s.mu.Lock()
	first := s.closing == ""
	if first {
		s.closing = reason
	}
	s.mu.Unlock()
	if first {
		go s.conn.Close(closeCode(reason), string(reason))
	}
}

func (s *session) serve(ctx context.Context) (websocket.StatusCode, string) {
	cfg := s.handler.cfg
	late := time.AfterFunc(cfg.HelloTimeout, func() { s.conn.Close(CloseNoHello, "no join or resume in time") })
	hello, code, reason := s.read(ctx)
	late.Stop()
	if code != 0 {
		return code, reason
	}
	if err := s.enter(hello); err != nil {
		s.write(ctx, encodeError(err))
		return CloseBadFrame, "entry refused"
	}
	defer s.depart()
	s.write(ctx, encodeJoined(s.seat))
	s.writers.Add(2)
	go s.pump(ctx)
	go s.ping(ctx)

	limiter := newBucket(cfg.FramesPerSec, cfg.FrameBurst, time.Now())
	for {
		frame, code, reason := s.read(ctx)
		if code != 0 {
			return s.closedBy(code, reason)
		}
		if !limiter.take(time.Now()) {
			return CloseFlood, "too many frames"
		}
		s.handler.presence.Touch(s.slug, s.seat.PID, s.seat.Gen)
		if !s.dispatch(ctx, frame) {
			return CloseBadFrame, "unknown frame"
		}
		if s.left {
			return websocket.StatusNormalClosure, "left"
		}
	}
}

func (s *session) closedBy(code websocket.StatusCode, reason string) (websocket.StatusCode, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closing != "" {
		return closeCode(s.closing), string(s.closing)
	}
	return code, reason
}

func (s *session) read(ctx context.Context) (clientFrame, websocket.StatusCode, string) {
	var frame clientFrame
	typ, data, err := s.conn.Read(ctx)
	if err != nil {
		return frame, websocket.StatusGoingAway, "connection ended"
	}
	if typ != websocket.MessageText || json.Unmarshal(data, &frame) != nil {
		return frame, CloseBadFrame, "frames are JSON text"
	}
	return frame, 0, ""
}

func (s *session) enter(hello clientFrame) error {
	slug, err := room.NewSlug(hello.Slug)
	if err != nil {
		return err
	}
	s.slug = slug
	switch hello.T {
	case "join":
		s.seat, err = s.handler.presence.Join(slug, hello.Name, s)
	case "resume":
		secret, ok := decodeSecret(hello.Secret)
		if !ok {
			return shared.NewDomainError(shared.ErrCodeNotFound, "participant not found", nil)
		}
		s.seat, err = s.handler.presence.Resume(slug, room.PID(hello.PID), secret, s)
	default:
		err = shared.NewDomainError(shared.ErrCodeInvalidArgument, "the first frame is join or resume", nil)
	}
	return err
}

func (s *session) depart() {
	if !s.left {
		s.handler.presence.Disconnected(s.slug, s.seat.PID, s.seat.Gen)
	}
}

func (s *session) dispatch(ctx context.Context, f clientFrame) bool {
	p := s.handler.presence
	switch f.T {
	case "hb":
	case "media":
		p.SetMedia(s.slug, s.seat.PID, s.seat.Gen, room.Flags(f.Flags))
	case "leave":
		p.Leave(s.slug, s.seat.PID, s.seat.Gen)
		s.left = true
	case "owner":
		var err error
		switch f.Op {
		case "remove":
			err = p.Remove(s.slug, s.seat.PID, s.seat.Gen, room.PID(f.PID))
		case "transfer":
			err = p.Transfer(s.slug, s.seat.PID, s.seat.Gen, room.PID(f.PID))
		default:
			return false
		}
		if err != nil {
			s.queue(encodeError(err))
		}
	default:
		return false
	}
	return true
}

func (s *session) queue(frame []byte) {
	select {
	case s.out <- frame:
	default:
		s.Close(room.CloseSlow)
	}
}

func (s *session) pump(ctx context.Context) {
	defer s.writers.Done()
	for {
		select {
		case <-ctx.Done():
			return
		case frame := <-s.out:
			if !s.write(ctx, frame) {
				s.cancel()
				return
			}
		}
	}
}

func (s *session) ping(ctx context.Context) {
	defer s.writers.Done()
	ticker := time.NewTicker(s.handler.cfg.PingEvery)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			pingCtx, stop := context.WithTimeout(ctx, s.handler.cfg.PingTimeout)
			err := s.conn.Ping(pingCtx)
			stop()
			if err != nil {
				s.cancel()
				return
			}
		}
	}
}

func (s *session) write(ctx context.Context, frame []byte) bool {
	writeCtx, stop := context.WithTimeout(ctx, s.handler.cfg.WriteTimeout)
	defer stop()
	return s.conn.Write(writeCtx, websocket.MessageText, frame) == nil
}
