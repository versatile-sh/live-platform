package ws

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/versatile-sh/live/server/internal/application/presence"
	"github.com/versatile-sh/live/server/internal/domain/room"
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
}

type client struct {
	t    *testing.T
	conn *websocket.Conn
	me   serverFrame
}

func startServer(t *testing.T, tune func(*Config)) string {
	t.Helper()
	roomCfg := room.Config{Capacity: 10, ConnectTimeout: time.Second, Grace: 150 * time.Millisecond, UnhealthyCap: 300 * time.Millisecond, EmptyRelease: 200 * time.Millisecond}
	hub := presence.NewHub(roomCfg, presence.Liveness{UnstableAfter: 200 * time.Millisecond, SuspectAfter: 500 * time.Millisecond}, time.Now)
	cfg := DefaultConfig(nil)
	cfg.PingEvery = 50 * time.Millisecond
	if tune != nil {
		tune(&cfg)
	}
	srv := httptest.NewServer(NewHandler(hub, cfg))
	t.Cleanup(srv.Close)
	return "ws" + strings.TrimPrefix(srv.URL, "http")
}

func dial(t *testing.T, url string) *client {
	t.Helper()
	conn, _, err := websocket.Dial(context.Background(), url, &websocket.DialOptions{Subprotocols: []string{Subprotocol}})
	require.NoError(t, err)
	t.Cleanup(func() { conn.CloseNow() })
	return &client{t: t, conn: conn}
}

func (c *client) send(frame string) {
	c.t.Helper()
	require.NoError(c.t, c.conn.Write(context.Background(), websocket.MessageText, []byte(frame)))
}

func (c *client) next() (serverFrame, error) {
	ctx, stop := context.WithTimeout(context.Background(), 3*time.Second)
	defer stop()
	var f serverFrame
	_, data, err := c.conn.Read(ctx)
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

func (c *client) closeCode() websocket.StatusCode {
	for {
		if _, err := c.next(); err != nil {
			return websocket.CloseStatus(err)
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
		bia.conn.CloseNow()
		ana.until(func(f serverFrame) bool { return has(f, bia.me.PID, "reconnecting") })
		gone := ana.until(func(f serverFrame) bool { return f.T == "roster" && !has(f, bia.me.PID, "") })
		require.Len(t, gone.Gone, 1)
		assert.Equal(t, "timeout", gone.Gone[0].Reason)
	})

	t.Run("leaving removes at once", func(t *testing.T) {
		url := startServer(t, nil)
		ana, bia := dial(t, url), dial(t, url)
		ana.join("ana")
		bia.join("bia")
		ana.until(func(f serverFrame) bool { return has(f, bia.me.PID, "") })
		started := time.Now()
		bia.send(`{"t":"leave"}`)
		gone := ana.until(func(f serverFrame) bool { return f.T == "roster" && !has(f, bia.me.PID, "") })
		assert.Equal(t, "left", gone.Gone[0].Reason)
		assert.Less(t, time.Since(started), 100*time.Millisecond)
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

	t.Run("the owner removes a participant, who is closed with 4403", func(t *testing.T) {
		url := startServer(t, nil)
		ana, bia := dial(t, url), dial(t, url)
		ana.join("ana")
		bia.join("bia")
		bia.send(`{"t":"owner","op":"remove","pid":1}`)
		refused := bia.until(func(f serverFrame) bool { return f.T == "error" })
		assert.Equal(t, "INVARIANT_VIOLATION", refused.Code)
		ana.send(`{"t":"owner","op":"remove","pid":2}`)
		refused = ana.until(func(f serverFrame) bool { return f.T == "error" })
		assert.Equal(t, "INVARIANT_VIOLATION", refused.Code, "an owner still connecting has no powers")
	})

	t.Run("connections that break the protocol are closed with its code", func(t *testing.T) {
		cases := []struct {
			name  string
			tune  func(*Config)
			drive func(c *client)
			code  websocket.StatusCode
		}{
			{"silent after the upgrade", func(c *Config) { c.HelloTimeout = 80 * time.Millisecond }, func(c *client) {}, CloseNoHello},
			{"first frame is not join or resume", nil, func(c *client) { c.send(`{"t":"hb"}`) }, CloseBadFrame},
			{"invalid slug", nil, func(c *client) { c.send(`{"t":"join","slug":"API!","name":"a"}`) }, CloseBadFrame},
			{"binary frame", nil, func(c *client) {
				c.join("ana")
				require.NoError(c.t, c.conn.Write(context.Background(), websocket.MessageBinary, []byte{1}))
			}, CloseBadFrame},
			{"unknown frame type", nil, func(c *client) { c.join("ana"); c.send(`{"t":"nope"}`) }, CloseBadFrame},
			{"frame above the size limit", nil, func(c *client) {
				c.join("ana")
				c.send(`{"t":"hb","name":"` + strings.Repeat("x", 17<<10) + `"}`)
			}, websocket.StatusMessageTooBig},
			{"flood", func(c *Config) { c.FramesPerSec, c.FrameBurst = 1, 3 }, func(c *client) {
				c.join("ana")
				for i := 0; i < 6; i++ {
					_ = c.conn.Write(context.Background(), websocket.MessageText, []byte(`{"t":"hb"}`))
				}
			}, CloseFlood},
		}
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				c := dial(t, startServer(t, tc.tune))
				tc.drive(c)
				assert.Equal(t, tc.code, c.closeCode())
			})
		}
	})

	t.Run("a page from another origin cannot open a session", func(t *testing.T) {
		url := startServer(t, nil)
		_, _, err := websocket.Dial(context.Background(), url, &websocket.DialOptions{
			Subprotocols: []string{Subprotocol},
			HTTPHeader:   map[string][]string{"Origin": {"https://evil.example"}},
		})
		assert.Error(t, err)
	})
}
