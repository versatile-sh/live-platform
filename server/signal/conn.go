package signal

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/gobwas/ws"
	"github.com/panjf2000/gnet/v2"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
	"go.opentelemetry.io/otel/trace/noop"

	"github.com/versatile-sh/live/server/clientinfo"
	"github.com/versatile-sh/live/server/core/room"
	"github.com/versatile-sh/live/server/port"
	"github.com/versatile-sh/live/server/port/outbound"
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
	origin   string
	remote   string
	headers  clientinfo.Headers
	limiter  bucket
	troubles bucket
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

func (c *conn) Roster(snapshot room.Snapshot) bool {
	frame := c.server.frames.rosterFrame(snapshot)
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

func (c *conn) Photo(pid room.PID, jpeg []byte) {
	frame := c.server.frames.photoFrame(pid, jpeg)
	c.mu.Lock()
	defer c.mu.Unlock()
	switch {
	case c.gone || c.phase == phaseEnding:
	case c.phase != phaseJoined:
		c.held = append(c.held, frame)
	case c.pending.Load() <= c.server.cfg.MaxPending:
		c.send(frame)
	}
}

func (c *conn) Media(signal room.MediaSignal) {
	frame := textFrame(encodeMedia(signal))
	c.mu.Lock()
	defer c.mu.Unlock()
	switch {
	case c.gone || c.phase == phaseEnding:
	case c.phase != phaseJoined:
		c.held = append(c.held, frame)
	case c.pending.Load() <= c.server.cfg.MaxPending:
		c.send(frame)
	}
}

func (c *conn) Board(update room.BoardUpdate) bool {
	frame := c.server.frames.boardFrame(update)
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

func (c *conn) Chat(message room.ChatMessage) bool {
	frame := c.server.frames.chatFrame(message)
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
		if !c.limiter.take(c.server.cfg.Now()) {
			c.fail(CloseFlood, "too many frames")
			return
		}
		c.server.presence.Touch(c.slug, c.seat.PID, c.seat.Gen)
		c.dispatch(f)
	}
}

func (c *conn) enter(hello clientFrame) {
	c.server.entry.RLock()
	if c.server.draining {
		c.server.entry.RUnlock()
		c.fail(CloseRestarting, "restarting")
		return
	}
	slug, seat, reentry, err := c.seatFor(hello)
	c.server.entry.RUnlock()
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
		c.send(textFrame(encodeJoined(seat, reentry)))
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

func (c *conn) seatFor(hello clientFrame) (room.Slug, room.Seat, string, error) {
	slug, err := room.NewSlug(hello.Slug)
	if err != nil {
		return "", room.Seat{}, "", err
	}
	switch hello.T {
	case "join":
		proof, ok := decodeVerifier(hello.Verifier)
		if !ok {
			return "", room.Seat{}, "", port.NewError(port.CodeInvalidArgument, "verifier is 32 bytes in base64url")
		}
		face, err := room.NewFace(hello.Face)
		if err != nil {
			return "", room.Seat{}, "", err
		}
		client := c.headers.Client(c.remote)
		record, vouched := c.vouched(hello.Pass, slug)
		if vouched {
			client.Discord = &record.Discord
		}
		span := c.joinSpan(record.TraceParent, slug, vouched)
		defer span.End()
		ids := span.SpanContext()
		entry := room.Entry{Name: hello.Name, Look: room.NewLook(hello.Look), Face: face, Proof: proof, Listed: hello.Listed, Origin: c.origin, Country: c.country, Client: client}
		if ids.IsSampled() {
			entry.TraceID, entry.SpanID = ids.TraceID().String(), ids.SpanID().String()
		}
		seat, err := c.server.presence.Join(slug, entry, c)
		if err != nil {
			span.SetStatus(codes.Error, err.Error())
		}
		reentry := ""
		if err == nil && vouched {
			reentry, _ = c.server.passes.Renew(hello.Pass)
		}
		return slug, seat, reentry, err
	case "resume":
		if secret, ok := decodeSecret(hello.Secret); ok {
			seat, err := c.server.presence.Resume(slug, room.PID(hello.PID), secret, c)
			return slug, seat, "", err
		}
		return "", room.Seat{}, "", port.NewError(port.CodeNotFound, "participant not found")
	}
	return "", room.Seat{}, "", port.NewError(port.CodeInvalidArgument, "the first frame is join or resume")
}

func (c *conn) joinSpan(parent string, slug room.Slug, vouched bool) trace.Span {
	if c.server.join == nil {
		return noop.Span{}
	}
	return c.server.join(parent, attribute.String("live.room", string(slug)), attribute.Bool("live.discord", vouched))
}

func (c *conn) vouched(pass string, slug room.Slug) (outbound.PassRecord, bool) {
	if pass == "" || c.server.passes == nil {
		return outbound.PassRecord{}, false
	}
	record, ok := c.server.passes.Recall(pass)
	if !ok || record.Slug != slug {
		return outbound.PassRecord{}, false
	}
	return record, true
}

func (c *conn) dispatch(f clientFrame) {
	p := c.server.presence
	switch f.T {
	case "hb":
		c.send(hbFrame)
	case "media":
		p.SetMedia(c.slug, c.seat.PID, c.seat.Gen, room.Flags(f.Flags))
	case "rtc":
		if (f.Role != room.MediaRolePublish && f.Role != room.MediaRoleSubscribe) || (f.Kind != room.MediaKindOffer && f.Kind != room.MediaKindAnswer && f.Kind != room.MediaKindICE) || len(f.Sources) > 8 {
			c.fail(CloseBadFrame, "malformed media signal")
			return
		}
		p.MediaSignal(c.slug, c.seat.PID, c.seat.Gen, room.MediaSignal{Role: f.Role, Kind: f.Kind, SDP: f.SDP, Candidate: f.Candidate, Sources: f.Sources})
	case "trouble":
		trouble, ok := room.BrowserTrouble(f.Code)
		if ok && c.troubles.take(c.server.cfg.Now()) {
			p.MediaTrouble(c.slug, c.seat.PID, c.seat.Gen, trouble)
		}
	case "look":
		face, err := room.NewFace(f.Face)
		if err != nil {
			c.send(textFrame(encodeError(err)))
			return
		}
		p.SetLook(c.slug, c.seat.PID, c.seat.Gen, room.NewLook(f.Look), face)
	case "photo":
		photo, err := base64.StdEncoding.DecodeString(f.Data)
		if err != nil {
			photo = []byte{0}
		}
		if err := room.CheckPhoto(photo); err != nil {
			c.send(textFrame(encodeError(err)))
			return
		}
		p.SetPhoto(c.slug, c.seat.PID, c.seat.Gen, photo)
	case "chat":
		var image []byte
		if f.Data != "" {
			decoded, err := base64.StdEncoding.DecodeString(f.Data)
			if err != nil || len(decoded) == 0 || room.CheckPhoto(decoded) != nil {
				c.send(textFrame(encodeError(room.CheckPhoto([]byte{0}))))
				return
			}
			image = decoded
		}
		text := ""
		if len(image) == 0 || strings.TrimSpace(f.Text) != "" {
			checked, err := room.NewChatText(f.Text)
			if err != nil {
				c.send(textFrame(encodeError(err)))
				return
			}
			text = checked
		}
		p.Chat(c.slug, c.seat.PID, c.seat.Gen, room.PID(f.To), text, image)
	case "board":
		data, err := room.NewBoardData(f.Board)
		if err != nil {
			c.send(textFrame(encodeError(err)))
			return
		}
		p.Board(c.slug, c.seat.PID, c.seat.Gen, room.PID(f.To), data)
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
	case "ban":
		err = c.server.presence.Ban(c.slug, c.seat.PID, c.seat.Gen, room.PID(f.PID))
	case "mute-all", "unmute-all", "mute", "allow", "lock-board", "unlock-board", "draw-deny", "draw-allow":
		err = c.server.presence.Quiet(c.slug, c.seat.PID, c.seat.Gen, room.QuietOp(f.Op), room.PID(f.PID))
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
