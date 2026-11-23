package signal

import (
	"bytes"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/gobwas/ws"
	"github.com/gobwas/ws/wsutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/versatile-sh/live/server/core/room"
	"github.com/versatile-sh/live/server/port/outbound"
)

func TestHardening(t *testing.T) {
	t.Run("a frame header that can never be valid closes the connection with a protocol error", func(t *testing.T) {
		c := dial(t, startServer(t, nil))
		c.join("ana")
		_, err := c.conn.Write([]byte{0x81, 0xff, 0x80, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4})
		require.NoError(t, err)
		assert.Equal(t, ws.StatusProtocolError, c.closeCode())
	})

	t.Run("a ping counts against the frame limiter", func(t *testing.T) {
		c := dial(t, startServer(t, func(cfg *Config) { cfg.FramesPerSec, cfg.FrameBurst = 1, 3 }))
		c.join("ana")
		for i := 0; i < 6; i++ {
			_ = wsutil.WriteClientMessage(c.conn, ws.OpPing, nil)
		}
		_ = c.conn.SetReadDeadline(time.Now().Add(3 * time.Second))
		for {
			h, err := ws.ReadHeader(c.conn)
			require.NoError(t, err)
			payload := make([]byte, h.Length)
			_, err = io.ReadFull(c.conn, payload)
			require.NoError(t, err)
			if h.OpCode == ws.OpClose {
				code, _ := ws.ParseCloseFrameData(payload)
				assert.Equal(t, CloseFlood, code)
				return
			}
		}
	})

	t.Run("a ping is answered with a pong while the limiter allows it", func(t *testing.T) {
		c := dial(t, startServer(t, nil))
		c.join("ana")
		require.NoError(t, wsutil.WriteClientMessage(c.conn, ws.OpPing, []byte("x")))
		_ = c.conn.SetReadDeadline(time.Now().Add(3 * time.Second))
		for {
			h, err := ws.ReadHeader(c.conn)
			require.NoError(t, err)
			_, err = io.CopyN(io.Discard, c.conn, h.Length)
			require.NoError(t, err)
			if h.OpCode == ws.OpPong {
				return
			}
		}
	})

	t.Run("a media signal naming a source outside the four lanes closes the connection", func(t *testing.T) {
		c := dial(t, startServer(t, nil))
		c.join("ana")
		c.send(`{"t":"rtc","role":"pub","kind":"offer","sdp":"x","sources":{"s":"admin"}}`)
		assert.Equal(t, CloseBadFrame, c.closeCode())
	})
}

func TestAFailedJoinGivesItsPassBack(t *testing.T) {
	t.Run("with a private room and no password the pass can still be claimed", func(t *testing.T) {
		url, _, ledger := auditedServer(t)
		owner := dial(t, url)
		owner.send(`{"t":"join","slug":"bk","name":"ana","verifier":"` + strings.Repeat("A", 43) + `"}`)
		owner.joined()
		ledger.Remember("pass-for-bk-0000000", outbound.PassRecord{Slug: "bk", Discord: room.Discord{UserID: "42"}})
		guest := dial(t, url)
		guest.send(`{"t":"join","slug":"bk","name":"bia","pass":"pass-for-bk-0000000"}`)
		refused := guest.until(func(f serverFrame) bool { return f.T == "error" })
		assert.Equal(t, "error", refused.T)
		_, ok := ledger.Claim("pass-for-bk-0000000", "bk")
		assert.True(t, ok)
	})
}

func TestValidSources(t *testing.T) {
	t.Run("with the four lanes it accepts", func(t *testing.T) {
		assert.True(t, validSources(map[string]string{"a": "microphone", "b": "camera", "c": "screen", "d": "screenAudio"}))
	})
	t.Run("with another name it refuses", func(t *testing.T) {
		assert.False(t, validSources(map[string]string{"a": "mic"}))
	})
	t.Run("with more than eight it refuses", func(t *testing.T) {
		many := map[string]string{}
		for _, k := range []string{"1", "2", "3", "4", "5", "6", "7", "8", "9"} {
			many[k] = "camera"
		}
		assert.False(t, validSources(many))
	})
}

func TestOriginFallsBackToTheSocketAddress(t *testing.T) {
	t.Run("when the address header is configured but missing the origin is the socket's", func(t *testing.T) {
		s := NewServer(nil, DefaultConfig(nil, time.Now))
		s.cfg.AddressHeader = "X-Client"
		c := &conn{server: s, remote: "10.0.0.9"}
		request := "GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Protocol: " + Subprotocol + "\r\n\r\n"
		_, err := c.upgrader().Upgrade(struct {
			io.Reader
			io.Writer
		}{bytes.NewReader([]byte(request)), io.Discard})
		require.NoError(t, err)
		assert.Equal(t, s.originOf("10.0.0.9"), c.origin)
	})
}

func TestRosterCarriesTheRoomsAccess(t *testing.T) {
	t.Run("with a private listed room both flags are on the frame", func(t *testing.T) {
		snapshot := room.Snapshot{Version: 1, Private: true, Listed: true}
		assert.Contains(t, string(encodeRoster(snapshot)), `"private":true,"listed":true`)
		assert.Equal(t, string(textFrame(encodeRoster(snapshot))), string(rosterText(snapshot)))
	})
	t.Run("with a public unlisted room neither flag is sent", func(t *testing.T) {
		assert.NotContains(t, string(encodeRoster(room.Snapshot{Version: 1})), "private")
		assert.NotContains(t, string(encodeRoster(room.Snapshot{Version: 1})), "listed")
	})
}
