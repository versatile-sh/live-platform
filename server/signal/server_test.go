package signal

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gobwas/ws"
	"github.com/gobwas/ws/wsutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/versatile-sh/live/server/core/room"
	"github.com/versatile-sh/live/server/port/inbound"
	"github.com/versatile-sh/live/server/service/presence"
)

type serverFrame struct {
	T      string      `json:"t"`
	PID    uint32      `json:"pid"`
	Gen    uint32      `json:"gen"`
	Secret string      `json:"secret"`
	V      uint64      `json:"v"`
	People []person    `json:"people"`
	Gone   []departure `json:"gone"`
	Code   string      `json:"code"`
	Name   string      `json:"name"`
	Text   string      `json:"text"`
	At     int64       `json:"at"`
	To     uint32      `json:"to"`
}

type client struct {
	t    *testing.T
	conn net.Conn
	me   serverFrame
}

func startServer(t *testing.T, tune func(*Config)) string {
	t.Helper()
	roomCfg := room.Config{Capacity: 10, ConnectTimeout: time.Second, Grace: 150 * time.Millisecond, UnhealthyCap: 300 * time.Millisecond, EmptyRelease: 200 * time.Millisecond, PasswordTries: 10, PasswordWindow: time.Minute}
	hub := presence.NewHub(roomCfg, presence.Liveness{UnstableAfter: 200 * time.Millisecond, SuspectAfter: 500 * time.Millisecond}, time.Now)
	cfg := DefaultConfig(nil)
	if tune != nil {
		tune(&cfg)
	}
	probe, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	addr := probe.Addr().String()
	require.NoError(t, probe.Close())
	var port inbound.Presence = hub
	if cfg.AddressHeader != "" {
		port = presence.WithoutMedia{Hub: hub}
	}
	srv := NewServer(port, cfg)
	go func() { _ = srv.Run(addr) }()
	<-srv.Ready()
	t.Cleanup(func() {
		ctx, stop := context.WithTimeout(context.Background(), 2*time.Second)
		defer stop()
		_ = srv.Stop(ctx)
	})
	return "ws://" + addr + path
}

func dial(t *testing.T, url string) *client {
	t.Helper()
	conn, _, _, err := ws.Dialer{Protocols: []string{Subprotocol}}.Dial(context.Background(), url)
	require.NoError(t, err)
	t.Cleanup(func() { conn.Close() })
	return &client{t: t, conn: conn}
}

func (c *client) send(frame string) {
	c.t.Helper()
	require.NoError(c.t, wsutil.WriteClientText(c.conn, []byte(frame)))
}

func (c *client) next() (serverFrame, error) {
	var f serverFrame
	_ = c.conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	data, _, err := wsutil.ReadServerData(c.conn)
	if err != nil {
		return f, err
	}
	return f, json.Unmarshal(data, &f)
}

func (c *client) join(name string) {
	c.t.Helper()
	c.send(`{"t":"join","slug":"bk","name":"` + name + `"}`)
	f, err := c.next()
	require.NoError(c.t, err)
	require.Equal(c.t, "joined", f.T)
	c.me = f
}

func (c *client) until(match func(serverFrame) bool) serverFrame {
	c.t.Helper()
	for {
		f, err := c.next()
		require.NoError(c.t, err)
		if match(f) {
			return f
		}
	}
}

func (c *client) closeCode() ws.StatusCode {
	for {
		_, err := c.next()
		var closed wsutil.ClosedError
		if errors.As(err, &closed) {
			return closed.Code
		}
		if err != nil {
			return 0
		}
	}
}

func has(f serverFrame, pid uint32, state string) bool {
	for _, p := range f.People {
		if p.PID == pid && (state == "" || p.State == state) {
			return true
		}
	}
	return false
}

func TestSignalling(t *testing.T) {
	t.Run("a tab that dies without leaving is shown reconnecting and then removed", func(t *testing.T) {
		url := startServer(t, nil)
		ana, bia := dial(t, url), dial(t, url)
		ana.join("ana")
		bia.join("bia")
		ana.until(func(f serverFrame) bool { return has(f, bia.me.PID, "") })
		bia.conn.Close()
		ana.until(func(f serverFrame) bool { return has(f, bia.me.PID, "reconnecting") })
		gone := ana.until(func(f serverFrame) bool { return f.T == "roster" && !has(f, bia.me.PID, "") })
		require.Len(t, gone.Gone, 1)
		assert.Equal(t, "timeout", gone.Gone[0].Reason)
	})

	t.Run("leaving removes at once and a heartbeat is answered", func(t *testing.T) {
		url := startServer(t, nil)
		ana, bia := dial(t, url), dial(t, url)
		ana.join("ana")
		bia.join("bia")
		ana.until(func(f serverFrame) bool { return has(f, bia.me.PID, "") })
		ana.send(`{"t":"hb"}`)
		ana.until(func(f serverFrame) bool { return f.T == "hb" })
		started := time.Now()
		bia.send(`{"t":"leave"}`)
		gone := ana.until(func(f serverFrame) bool { return f.T == "roster" && !has(f, bia.me.PID, "") })
		assert.Equal(t, "left", gone.Gone[0].Reason)
		assert.Less(t, time.Since(started), 100*time.Millisecond)
		assert.Equal(t, ws.StatusNormalClosure, bia.closeCode())
	})

	t.Run("a resume closes the connection it replaces with 4001", func(t *testing.T) {
		url := startServer(t, nil)
		old := dial(t, url)
		old.join("ana")
		fresh := dial(t, url)
		fresh.send(`{"t":"resume","slug":"bk","pid":1,"secret":"` + old.me.Secret + `"}`)
		f, err := fresh.next()
		require.NoError(t, err)
		assert.Equal(t, "joined", f.T)
		assert.Equal(t, old.me.Gen+1, f.Gen)
		assert.Equal(t, CloseSuperseded, old.closeCode())
	})

	t.Run("owner actions are refused with an error frame when not allowed", func(t *testing.T) {
		url := startServer(t, nil)
		ana, bia := dial(t, url), dial(t, url)
		ana.join("ana")
		bia.join("bia")
		bia.send(`{"t":"owner","op":"remove","pid":1}`)
		refused := bia.until(func(f serverFrame) bool { return f.T == "error" })
		assert.Equal(t, "INVARIANT_VIOLATION", refused.Code)
	})

	t.Run("a banned participant is closed with the ban code and their address cannot come back, while others can", func(t *testing.T) {
		url := startServer(t, func(cfg *Config) { cfg.AddressHeader = "X-Client" })
		from := func(address string) *client {
			conn, _, _, err := ws.Dialer{Protocols: []string{Subprotocol}, Header: ws.HandshakeHeaderHTTP(http.Header{"X-Client": {address}})}.Dial(context.Background(), url)
			require.NoError(t, err)
			t.Cleanup(func() { conn.Close() })
			return &client{t: t, conn: conn}
		}
		ana, bia := from("10.0.0.1"), from("10.0.0.2, 172.16.0.1")
		ana.join("ana")
		bia.join("bia")
		ana.send(`{"t":"owner","op":"ban","pid":2}`)
		assert.Equal(t, CloseBanned, bia.closeCode())
		again := from("10.0.0.2")
		again.send(`{"t":"join","slug":"bk","name":"bia"}`)
		refused := again.until(func(f serverFrame) bool { return f.T == "error" })
		assert.Equal(t, "BANNED", refused.Code)
		caio := from("10.0.0.3")
		caio.join("caio")
	})

	t.Run("a private room is created by its first entry and refuses a wrong password", func(t *testing.T) {
		url := startServer(t, nil)
		right := strings.Repeat("A", 43)
		wrong := strings.Repeat("B", 43)
		owner := dial(t, url)
		owner.send(`{"t":"join","slug":"bk","name":"ana","verifier":"` + right + `"}`)
		f, err := owner.next()
		require.NoError(t, err)
		require.Equal(t, "joined", f.T)
		for _, proof := range []string{"", wrong, "not-base64!"} {
			guest := dial(t, url)
			guest.send(`{"t":"join","slug":"bk","name":"bia","verifier":"` + proof + `"}`)
			refused, err := guest.next()
			require.NoError(t, err)
			assert.Equal(t, "error", refused.T)
			assert.Equal(t, CloseBadFrame, guest.closeCode())
		}
		guest := dial(t, url)
		guest.send(`{"t":"join","slug":"bk","name":"bia","verifier":"` + right + `"}`)
		f, err = guest.next()
		require.NoError(t, err)
		assert.Equal(t, "joined", f.T)
	})

	t.Run("a look chosen on entry and changed later reaches the room", func(t *testing.T) {
		url := startServer(t, nil)
		ana, bia := dial(t, url), dial(t, url)
		ana.send(`{"t":"join","slug":"bk","name":"ana","look":"c6f432-0e1116-45","face":"(•‿•)"}`)
		_, err := ana.next()
		require.NoError(t, err)
		bia.join("bia")
		seen := bia.until(func(f serverFrame) bool { return has(f, 1, "") })
		assert.Equal(t, "c6f432-0e1116-45", seen.People[0].Look)
		assert.Equal(t, "(•‿•)", seen.People[0].Face)
		ana.send(`{"t":"look","look":"ffffff-000000-90","face":"^_^"}`)
		bia.until(func(f serverFrame) bool {
			return f.T == "roster" && len(f.People) > 0 && f.People[0].Look == "ffffff-000000-90" && f.People[0].Face == "^_^"
		})
		ana.send(`{"t":"photo","data":"/9j/4AECA//Z"}`)
		shown := bia.until(func(f serverFrame) bool { return f.T == "photo" })
		assert.Equal(t, uint32(1), shown.PID)
		ana.send(`{"t":"photo","data":"PHN2Zy8+"}`)
		refused := ana.until(func(f serverFrame) bool { return f.T == "error" })
		assert.Equal(t, "INVALID_ARGUMENT", refused.Code)
	})

	t.Run("a chat line reaches the room with its author, and a bad one is refused to its sender only", func(t *testing.T) {
		url := startServer(t, nil)
		ana, bia := dial(t, url), dial(t, url)
		ana.join("ana")
		bia.join("bia")
		ana.send(`{"t":"chat","text":"  hello there  "}`)
		heard := bia.until(func(f serverFrame) bool { return f.T == "chat" })
		assert.Equal(t, "hello there", heard.Text)
		assert.Equal(t, "ana", heard.Name)
		assert.Equal(t, ana.me.PID, heard.PID)
		assert.NotZero(t, heard.At)
		ana.until(func(f serverFrame) bool { return f.T == "chat" })
		ana.send(`{"t":"chat","to":2,"text":"just you"}`)
		private := bia.until(func(f serverFrame) bool { return f.T == "chat" && f.Text == "just you" })
		assert.Equal(t, uint32(2), private.To)
		ana.send(`{"t":"chat","text":"   "}`)
		refused := ana.until(func(f serverFrame) bool { return f.T == "error" })
		assert.Equal(t, "INVALID_ARGUMENT", refused.Code)
	})

	t.Run("a frame split across packets is reassembled", func(t *testing.T) {
		c := dial(t, startServer(t, nil))
		var wire strings.Builder
		require.NoError(t, wsutil.WriteClientText(&wire, []byte(`{"t":"join","slug":"bk","name":"ana"}`)))
		for _, b := range []byte(wire.String()) {
			_, err := c.conn.Write([]byte{b})
			require.NoError(t, err)
		}
		f, err := c.next()
		require.NoError(t, err)
		assert.Equal(t, "joined", f.T)
	})

	t.Run("connections that break the protocol are closed with its code", func(t *testing.T) {
		cases := []struct {
			name  string
			tune  func(*Config)
			drive func(c *client)
			code  ws.StatusCode
		}{
			{"silent after the upgrade", func(c *Config) { c.HelloTimeout = 80 * time.Millisecond }, func(c *client) {}, CloseNoHello},
			{"first frame is not join or resume", nil, func(c *client) { c.send(`{"t":"hb"}`) }, CloseBadFrame},
			{"invalid slug", nil, func(c *client) { c.send(`{"t":"join","slug":"API!","name":"a"}`) }, CloseBadFrame},
			{"a frame before joined arrives", nil, func(c *client) {
				c.send(`{"t":"join","slug":"bk","name":"a"}`)
				c.send(`{"t":"hb"}`)
				c.send(`{"t":"hb"}`)
			}, 0},
			{"binary frame", nil, func(c *client) {
				c.join("ana")
				require.NoError(c.t, wsutil.WriteClientBinary(c.conn, []byte{1}))
			}, CloseBadFrame},
			{"unmasked frame", nil, func(c *client) {
				c.join("ana")
				require.NoError(c.t, wsutil.WriteServerText(c.conn, []byte(`{"t":"hb"}`)))
			}, ws.StatusProtocolError},
			{"unknown frame type", nil, func(c *client) { c.join("ana"); c.send(`{"t":"nope"}`) }, CloseBadFrame},
			{"frame above the size limit", nil, func(c *client) {
				c.join("ana")
				require.NoError(c.t, ws.WriteHeader(c.conn, ws.Header{Fin: true, OpCode: ws.OpText, Masked: true, Length: 128<<10 + 1}))
			}, ws.StatusMessageTooBig},
			{"flood", func(c *Config) { c.FramesPerSec, c.FrameBurst = 1, 3 }, func(c *client) {
				c.join("ana")
				for i := 0; i < 4; i++ {
					_ = wsutil.WriteClientText(c.conn, []byte(`{"t":"hb"}`))
				}
			}, CloseFlood},
		}
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				c := dial(t, startServer(t, tc.tune))
				tc.drive(c)
				code := c.closeCode()
				if tc.code != 0 {
					assert.Equal(t, tc.code, code)
				}
			})
		}
	})

	t.Run("the upgrade is refused for a foreign origin, a wrong path and a slow handshake", func(t *testing.T) {
		url := startServer(t, func(c *Config) { c.HelloTimeout = 100 * time.Millisecond })
		_, _, _, err := ws.Dialer{Protocols: []string{Subprotocol}, Header: ws.HandshakeHeaderHTTP(http.Header{"Origin": {"https://evil.example"}})}.Dial(context.Background(), url)
		require.Error(t, err)
		_, _, _, err = ws.Dialer{Protocols: []string{Subprotocol}}.Dial(context.Background(), strings.TrimSuffix(url, path)+"/other")
		require.Error(t, err)
		raw, err := net.Dial("tcp", strings.TrimSuffix(strings.TrimPrefix(url, "ws://"), path))
		require.NoError(t, err)
		defer raw.Close()
		_, _ = raw.Write([]byte("GET /ws HTTP/1.1\r\nHost: x\r\n"))
		_ = raw.SetReadDeadline(time.Now().Add(2 * time.Second))
		_, err = raw.Read(make([]byte, 1))
		require.Error(t, err, "the server closes a handshake that never completes")
		assert.NotErrorIs(t, err, context.DeadlineExceeded)
	})
}
