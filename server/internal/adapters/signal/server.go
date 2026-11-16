package signal

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gobwas/ws"
	"github.com/panjf2000/gnet/v2"
	"github.com/panjf2000/gnet/v2/pkg/logging"

	"github.com/versatile-sh/live/server/internal/ports/inbound"
)

const (
	path             = "/ws"
	maxHandshakeSize = 4 << 10
	maxControlSize   = 125
)

var headEnd = []byte("\r\n\r\n")

// Config bounds what one connection, and all of them together, may cost the server.
type Config struct {
	Origins       []string
	CountryHeader string
	AddressHeader string
	// Salt keys the opaque origin of each visitor; given, it stays the same across restarts so that bans hold through a deploy.
	Salt         []byte
	HelloTimeout time.Duration
	ReadLimit    int64
	FramesPerSec float64
	FrameBurst   float64
	MaxPending   int64
	MaxConns     int64
}

// DefaultConfig returns the limits of lv.1 for the given allowed origins.
func DefaultConfig(origins []string) Config {
	return Config{
		Origins:      origins,
		HelloTimeout: 5 * time.Second,
		ReadLimit:    128 << 10,
		FramesPerSec: 20,
		FrameBurst:   80,
		MaxPending:   2 << 20,
		MaxConns:     20000,
	}
}

// Server speaks lv.1 to every participant from a few event loops, with no goroutine per connection.
type Server struct {
	gnet.BuiltinEventEngine
	presence inbound.Presence
	cfg      Config
	engine   gnet.Engine
	ready    chan struct{}
	conns    atomic.Int64
	salt     [16]byte
	open     sync.Map
}

// NewServer builds the signalling endpoint over the presence port.
func NewServer(presence inbound.Presence, cfg Config) *Server {
	s := &Server{presence: presence, cfg: cfg, ready: make(chan struct{})}
	if copy(s.salt[:], cfg.Salt) < len(s.salt) {
		_, _ = rand.Read(s.salt[:])
	}
	return s
}

// Run serves on addr until Stop is called.
func (s *Server) Run(addr string) error {
	return gnet.Run(s, "tcp://"+addr, gnet.WithMulticore(true), gnet.WithReuseAddr(true), gnet.WithTCPNoDelay(gnet.TCPNoDelay), gnet.WithTCPKeepAlive(30*time.Second), gnet.WithLogLevel(logging.ErrorLevel))
}

// Ready is closed once the server accepts connections.
func (s *Server) Ready() <-chan struct{} { return s.ready }

// Stop closes every connection and ends Run; a server that never booted has nothing to stop.
func (s *Server) Stop(ctx context.Context) error {
	select {
	case <-s.ready:
		return s.engine.Stop(ctx)
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Handoff closes every connection with the code that tells a browser to come straight back, for when another server has taken the rooms over.
func (s *Server) Handoff() {
	s.open.Range(func(key, _ any) bool {
		key.(*conn).fail(CloseRestarting, "restarting")
		return true
	})
}

// OnBoot records the engine so that Stop can reach it.
func (s *Server) OnBoot(engine gnet.Engine) gnet.Action {
	s.engine = engine
	close(s.ready)
	return gnet.None
}

// OnOpen admits a connection under the global cap and starts its hello deadline.
func (s *Server) OnOpen(raw gnet.Conn) ([]byte, gnet.Action) {
	if s.conns.Add(1) > s.cfg.MaxConns {
		return nil, gnet.Close
	}
	c := &conn{server: s, raw: raw, limiter: newBucket(s.cfg.FramesPerSec, s.cfg.FrameBurst, time.Now())}
	if s.cfg.AddressHeader == "" && raw.RemoteAddr() != nil {
		if host, _, err := net.SplitHostPort(raw.RemoteAddr().String()); err == nil {
			c.origin = s.originOf(host)
		}
	}
	c.late = time.AfterFunc(s.cfg.HelloTimeout, c.expireHello)
	s.open.Store(c, struct{}{})
	raw.SetContext(c)
	return nil, gnet.None
}

// OnClose tells the room that a participant's connection ended.
func (s *Server) OnClose(raw gnet.Conn, _ error) gnet.Action {
	s.conns.Add(-1)
	if c, ok := raw.Context().(*conn); ok {
		s.open.Delete(c)
		c.closed()
	}
	return gnet.None
}

// OnTraffic consumes every complete handshake or frame that has arrived.
func (s *Server) OnTraffic(raw gnet.Conn) gnet.Action {
	c := raw.Context().(*conn)
	for {
		buf, _ := raw.Peek(-1)
		var used int
		var action gnet.Action
		if c.upgraded.Load() {
			used, action = c.frame(buf)
		} else {
			used, action = c.handshake(buf)
		}
		if used > 0 {
			_, _ = raw.Discard(used)
		}
		if action != gnet.None || used == 0 {
			return action
		}
	}
}

func (c *conn) handshake(buf []byte) (int, gnet.Action) {
	end := bytes.Index(buf, headEnd)
	if end < 0 {
		if len(buf) > maxHandshakeSize {
			return 0, gnet.Close
		}
		return 0, gnet.None
	}
	end += len(headEnd)
	var reply bytes.Buffer
	hs, err := c.upgrader().Upgrade(struct {
		io.Reader
		io.Writer
	}{bytes.NewReader(buf[:end]), &reply})
	_, _ = c.raw.Write(reply.Bytes())
	if err != nil {
		return end, gnet.Close
	}
	c.upgraded.Store(true)
	if hs.Protocol != Subprotocol {
		c.fail(ws.StatusPolicyViolation, "subprotocol lv.1 required")
	}
	return end, gnet.None
}

func (c *conn) upgrader() ws.Upgrader {
	var host, origin string
	return ws.Upgrader{
		Protocol: func(p []byte) bool { return string(p) == Subprotocol },
		OnRequest: func(uri []byte) error {
			if q := bytes.IndexByte(uri, '?'); q >= 0 {
				uri = uri[:q]
			}
			if string(uri) != path {
				return ws.RejectConnectionError(ws.RejectionStatus(404))
			}
			return nil
		},
		OnHost: func(h []byte) error { host = string(h); return nil },
		OnHeader: func(key, value []byte) error {
			switch {
			case string(key) == "Origin":
				origin = string(value)
			case c.server.cfg.CountryHeader != "" && strings.EqualFold(string(key), c.server.cfg.CountryHeader):
				c.country = countryCode(value)
			case c.server.cfg.AddressHeader != "" && strings.EqualFold(string(key), c.server.cfg.AddressHeader):
				first, _, _ := strings.Cut(string(value), ",")
				if ip := net.ParseIP(strings.TrimSpace(first)); ip != nil {
					c.origin = c.server.originOf(ip.String())
				}
			}
			return nil
		},
		OnBeforeUpgrade: func() (ws.HandshakeHeader, error) {
			if !originAllowed(origin, host, c.server.cfg.Origins) {
				return nil, ws.RejectConnectionError(ws.RejectionStatus(403), ws.RejectionReason("origin not allowed"))
			}
			return nil, nil
		},
	}
}

// originOf turns a visitor's address into an opaque key that lasts as long as this process, so a ban never stores the address itself.
func (s *Server) originOf(address string) string {
	sum := sha256.Sum256(append(s.salt[:], address...))
	return hex.EncodeToString(sum[:12])
}

func countryCode(value []byte) string {
	if len(value) != 2 || value[0] < 'A' || value[0] > 'Z' || value[1] < 'A' || value[1] > 'Z' || string(value) == "XX" || string(value) == "T1" {
		return ""
	}
	return string(value)
}

func originAllowed(origin, host string, allowed []string) bool {
	if origin == "" {
		return true
	}
	for _, a := range allowed {
		if origin == a {
			return true
		}
	}
	return len(allowed) == 0 && (origin == "http://"+host || origin == "https://"+host)
}

func (c *conn) frame(buf []byte) (int, gnet.Action) {
	r := bytes.NewReader(buf)
	h, err := ws.ReadHeader(r)
	if err != nil {
		return 0, gnet.None
	}
	head := len(buf) - r.Len()
	control := h.OpCode.IsControl()
	switch {
	case !h.Masked || h.Rsv != 0 || (control && (!h.Fin || h.Length > maxControlSize)):
		c.fail(ws.StatusProtocolError, "malformed frame")
		return len(buf), gnet.None
	case h.Length > c.server.cfg.ReadLimit:
		c.fail(ws.StatusMessageTooBig, "frame too large")
		return len(buf), gnet.None
	case len(buf) < head+int(h.Length):
		return 0, gnet.None
	}
	payload := bytes.Clone(buf[head : head+int(h.Length)])
	ws.Cipher(payload, h.Mask, 0)
	switch h.OpCode {
	case ws.OpText:
		if !h.Fin {
			c.fail(CloseBadFrame, "fragmented frames are not accepted")
			break
		}
		c.text(payload)
	case ws.OpPing:
		c.send(ws.MustCompileFrame(ws.NewPongFrame(payload)))
	case ws.OpPong:
	case ws.OpClose:
		c.fail(ws.StatusNormalClosure, "")
	default:
		c.fail(CloseBadFrame, "frames are JSON text")
	}
	return head + int(h.Length), gnet.None
}
