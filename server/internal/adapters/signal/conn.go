package signal

import (
	"encoding/json"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/gobwas/ws"
	"github.com/panjf2000/gnet/v2"

	"github.com/versatile-sh/live/server/internal/domain/room"
	"github.com/versatile-sh/live/server/internal/domain/shared"
)

type phase uint8

const (
	phaseHello phase = iota
	phaseEntering
	phaseJoined
	phaseEnding
)

var hbFrame = textFrame([]byte(`{"t":"hb"}`))

type conn struct {
	server   *Server
	raw      gnet.Conn
	upgraded atomic.Bool
	country  string
	limiter  bucket
	late     *time.Timer
	pending  atomic.Int64

	mu    sync.Mutex
	phase phase
	gone  bool
	left  bool
	held  [][]byte
	slug  room.Slug
	seat  room.Seat
}

// Roster queues a snapshot and reports false when the connection has fallen too far behind.
func (c *conn) Roster(snapshot room.Snapshot) bool {
	frame := textFrame(encodeRoster(snapshot))
	c.mu.Lock()
	defer c.mu.Unlock()
	switch {
	case c.gone || c.phase == phaseEnding:
		return true
	case c.phase != phaseJoined:
		c.held = append(c.held, frame)
		return true
	case c.pending.Load() > c.server.cfg.MaxPending:
		return false
	}
	c.send(frame)
	return true
}

// Chat queues a message and reports false when the connection has fallen too far behind.
func (c *conn) Chat(message room.ChatMessage) bool {
	frame := textFrame(encodeChat(message))
	c.mu.Lock()
	defer c.mu.Unlock()
	switch {
	case c.gone || c.phase != phaseJoined:
		return true
	case c.pending.Load() > c.server.cfg.MaxPending:
		return false
	}
	c.send(frame)
	return true
}

// Close ends the connection from the room's side with the code of the reason.
func (c *conn) Close(reason room.CloseReason) {
	c.fail(closeCode(reason), string(reason))
}

func (c *conn) send(frame []byte) {
	n := int64(len(frame))
	c.pending.Add(n)
	if err := c.raw.AsyncWrite(frame, func(gnet.Conn, error) error { c.pending.Add(-n); return nil }); err != nil {
		c.pending.Add(-n)
	}
}

func (c *conn) fail(code ws.StatusCode, reason string) {
	c.mu.Lock()
	ending := c.phase == phaseEnding
	c.phase = phaseEnding
	c.mu.Unlock()
	if ending {
		return
	}
	if err := c.raw.AsyncWrite(closeFrame(code, reason), func(raw gnet.Conn, _ error) error { return raw.Close() }); err != nil {
		_ = c.raw.Close()
	}
}

func (c *conn) expireHello() {
	c.mu.Lock()
	waiting := c.phase == phaseHello && !c.gone
	c.mu.Unlock()
	switch {
	case !waiting:
	case c.upgraded.Load():
		c.fail(CloseNoHello, "no join or resume in time")
	default:
		_ = c.raw.Close()
	}
}

func (c *conn) closed() {
	c.late.Stop()
	c.mu.Lock()
	c.gone = true
	report := c.phase == phaseJoined || (c.phase == phaseEnding && c.seat.PID != 0)
	report = report && !c.left
	c.mu.Unlock()
	if report {
		c.server.presence.Disconnected(c.slug, c.seat.PID, c.seat.Gen)
	}
}

func (c *conn) text(payload []byte) {
	var f clientFrame
	if !utf8.Valid(payload) || json.Unmarshal(payload, &f) != nil {
		c.fail(CloseBadFrame, "frames are JSON text")
		return
	}
	c.mu.Lock()
	current := c.phase
	if current == phaseHello {
		c.phase = phaseEntering
	}
	c.mu.Unlock()
	switch current {
	case phaseHello:
		c.late.Stop()
		go c.enter(f)
	case phaseEntering:
		c.fail(CloseBadFrame, "wait for joined")
	case phaseJoined:
		if !c.limiter.take(time.Now()) {
			c.fail(CloseFlood, "too many frames")
			return
		}
		c.server.presence.Touch(c.slug, c.seat.PID, c.seat.Gen)
		c.dispatch(f)
	}
}

func (c *conn) enter(hello clientFrame) {
	slug, seat, err := c.seatFor(hello)
	if err != nil {
		c.send(textFrame(encodeError(err)))
		c.fail(CloseBadFrame, "entry refused")
		return
	}
	c.mu.Lock()
	c.slug, c.seat = slug, seat
	lost := c.gone || c.phase == phaseEnding
	if !lost {
		c.phase = phaseJoined
		c.send(textFrame(encodeJoined(seat)))
		for _, frame := range c.held {
			c.send(frame)
		}
	}
	c.held = nil
	c.mu.Unlock()
	if lost {
		c.server.presence.Disconnected(slug, seat.PID, seat.Gen)
	}
}

func (c *conn) seatFor(hello clientFrame) (room.Slug, room.Seat, error) {
	slug, err := room.NewSlug(hello.Slug)
	if err != nil {
		return "", room.Seat{}, err
	}
	switch hello.T {
	case "join":
		proof, ok := decodeVerifier(hello.Verifier)
		if !ok {
			return "", room.Seat{}, shared.NewDomainError(shared.ErrCodeInvalidArgument, "verifier is 32 bytes in base64url", nil)
		}
		seat, err := c.server.presence.Join(slug, room.Entry{Name: hello.Name, Proof: proof, Listed: hello.Listed, Country: c.country}, c)
		return slug, seat, err
	case "resume":
		if secret, ok := decodeSecret(hello.Secret); ok {
			seat, err := c.server.presence.Resume(slug, room.PID(hello.PID), secret, c)
			return slug, seat, err
		}
		return "", room.Seat{}, shared.NewDomainError(shared.ErrCodeNotFound, "participant not found", nil)
	}
	return "", room.Seat{}, shared.NewDomainError(shared.ErrCodeInvalidArgument, "the first frame is join or resume", nil)
}

func (c *conn) dispatch(f clientFrame) {
	p := c.server.presence
	switch f.T {
	case "hb":
		c.send(hbFrame)
	case "media":
		p.SetMedia(c.slug, c.seat.PID, c.seat.Gen, room.Flags(f.Flags))
	case "chat":
		text, err := room.NewChatText(f.Text)
		if err != nil {
			c.send(textFrame(encodeError(err)))
			return
		}
		p.Chat(c.slug, c.seat.PID, c.seat.Gen, text)
	case "leave":
		c.mu.Lock()
		c.left = true
		c.mu.Unlock()
		p.Leave(c.slug, c.seat.PID, c.seat.Gen)
		c.fail(ws.StatusNormalClosure, "left")
	case "owner":
		go c.owner(f)
	default:
		c.fail(CloseBadFrame, "unknown frame")
	}
}

func (c *conn) owner(f clientFrame) {
	var err error
	switch f.Op {
	case "remove":
		err = c.server.presence.Remove(c.slug, c.seat.PID, c.seat.Gen, room.PID(f.PID))
	case "transfer":
		err = c.server.presence.Transfer(c.slug, c.seat.PID, c.seat.Gen, room.PID(f.PID))
	case "listed":
		err = c.server.presence.SetListed(c.slug, c.seat.PID, c.seat.Gen, f.Listed)
	case "password":
		verifier, ok := decodeVerifier(f.Verifier)
		if !ok {
			c.fail(CloseBadFrame, "verifier is 32 bytes in base64url")
			return
		}
		err = c.server.presence.SetPassword(c.slug, c.seat.PID, c.seat.Gen, verifier)
	default:
		c.fail(CloseBadFrame, "unknown owner action")
		return
	}
	if err != nil {
		c.send(textFrame(encodeError(err)))
	}
}
