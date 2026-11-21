// Package integration runs the room, the signalling server and the media plane together, with Pion clients for browsers.
package integration

import (
	"context"
	"encoding/json"
	"net"
	"sync"
	"testing"
	"time"

	"github.com/gobwas/ws"
	"github.com/gobwas/ws/wsutil"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/versatile-sh/live/server/core/room"
	"github.com/versatile-sh/live/server/service/presence"
	"github.com/versatile-sh/live/server/sfu"
	"github.com/versatile-sh/live/server/signal"
)

const wait = 15 * time.Second

type frame struct {
	T         string `json:"t"`
	PID       uint32 `json:"pid"`
	Role      string `json:"role"`
	Kind      string `json:"kind"`
	SDP       string `json:"sdp"`
	Candidate string `json:"candidate"`
	People    []struct {
		PID   uint32 `json:"pid"`
		State string `json:"state"`
	} `json:"people"`
}

type tab struct {
	t      *testing.T
	conn   net.Conn
	write  sync.Mutex
	sub    *webrtc.PeerConnection
	pub    *webrtc.PeerConnection
	mu     sync.Mutex
	pid    uint32
	states map[uint32]string
	heard  map[string]bool
}

var browserAPI = func() *webrtc.API {
	settings := webrtc.SettingEngine{}
	sfu.Loopback(&settings)
	return webrtc.NewAPI(webrtc.WithSettingEngine(settings))
}()

func (c *tab) send(v any) {
	data, _ := json.Marshal(v)
	c.write.Lock()
	defer c.write.Unlock()
	_ = wsutil.WriteClientText(c.conn, data)
}

func open(t *testing.T, api *webrtc.API, url, slug, name string) *tab {
	t.Helper()
	conn, _, _, err := ws.Dialer{Protocols: []string{signal.Subprotocol}}.Dial(context.Background(), url)
	require.NoError(t, err)
	sub, err := api.NewPeerConnection(webrtc.Configuration{})
	require.NoError(t, err)
	pub, err := api.NewPeerConnection(webrtc.Configuration{})
	require.NoError(t, err)
	c := &tab{t: t, conn: conn, sub: sub, pub: pub, states: map[uint32]string{}, heard: map[string]bool{}}
	t.Cleanup(func() { _ = conn.Close(); _ = sub.Close(); _ = pub.Close() })
	trickle := func(role string) func(*webrtc.ICECandidate) {
		return func(candidate *webrtc.ICECandidate) {
			if candidate == nil {
				return
			}
			encoded, _ := json.Marshal(candidate.ToJSON())
			c.send(map[string]string{"t": "rtc", "role": role, "kind": "ice", "candidate": string(encoded)})
		}
	}
	sub.OnICECandidate(trickle("sub"))
	pub.OnICECandidate(trickle("pub"))
	sub.OnTrack(func(remote *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		if _, _, err := remote.ReadRTP(); err == nil {
			c.mu.Lock()
			c.heard[remote.StreamID()] = true
			c.mu.Unlock()
		}
	})
	c.send(map[string]string{"t": "join", "slug": slug, "name": name})
	go c.read()
	go func() {
		for range time.Tick(2 * time.Second) {
			c.send(map[string]string{"t": "hb"})
		}
	}()
	return c
}

func (c *tab) read() {
	for {
		data, _, err := wsutil.ReadServerData(c.conn)
		if err != nil {
			return
		}
		var f frame
		if json.Unmarshal(data, &f) != nil {
			continue
		}
		switch f.T {
		case "joined":
			c.mu.Lock()
			c.pid = f.PID
			c.mu.Unlock()
		case "roster":
			c.mu.Lock()
			c.states = map[uint32]string{}
			for _, p := range f.People {
				c.states[p.PID] = p.State
			}
			c.mu.Unlock()
		case "rtc":
			c.rtc(f)
		}
	}
}

func (c *tab) rtc(f frame) {
	pc := c.sub
	if f.Role == "pub" {
		pc = c.pub
	}
	switch f.Kind {
	case "ice":
		var init webrtc.ICECandidateInit
		if json.Unmarshal([]byte(f.Candidate), &init) == nil {
			_ = pc.AddICECandidate(init)
		}
	case "offer":
		if pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: f.SDP}) != nil {
			return
		}
		answer, err := pc.CreateAnswer(nil)
		if err != nil || pc.SetLocalDescription(answer) != nil {
			return
		}
		c.send(map[string]string{"t": "rtc", "role": "sub", "kind": "answer", "sdp": answer.SDP})
	case "answer":
		_ = pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: f.SDP})
	}
}

func (c *tab) publish(source string) {
	c.t.Helper()
	track, err := webrtc.NewTrackLocalStaticRTP(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeOpus}, "t-"+source, "s-"+source)
	require.NoError(c.t, err)
	_, err = c.pub.AddTrack(track)
	require.NoError(c.t, err)
	offer, err := c.pub.CreateOffer(nil)
	require.NoError(c.t, err)
	require.NoError(c.t, c.pub.SetLocalDescription(offer))
	c.send(map[string]any{"t": "rtc", "role": "pub", "kind": "offer", "sdp": offer.SDP, "sources": map[string]string{"s-" + source: source}})
	go func() {
		for seq := uint16(0); ; seq++ {
			time.Sleep(20 * time.Millisecond)
			if track.WriteRTP(&rtp.Packet{Header: rtp.Header{Version: 2, SequenceNumber: seq, Timestamp: uint32(seq) * 960}, Payload: []byte{0xF8, 0xFF, 0xFE}}) != nil {
				return
			}
		}
	}()
}

func (c *tab) state(pid uint32) string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.states[pid]
}

func (c *tab) hears(stream string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.heard[stream]
}

func TestCall(t *testing.T) {
	cfg := room.DefaultConfig()
	cfg.ConnectTimeout = 3 * time.Second
	hub := presence.NewHub(cfg, presence.DefaultLiveness(), time.Now)
	engine, err := sfu.New(sfu.Config{Loopback: true}, hub)
	require.NoError(t, err)
	hub.UseMedia(engine)

	probe, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	addr := probe.Addr().String()
	require.NoError(t, probe.Close())
	server := signal.NewServer(hub, signal.DefaultConfig(nil, time.Now))
	go func() { _ = server.Run(addr) }()
	<-server.Ready()
	t.Cleanup(func() {
		ctx, stop := context.WithTimeout(context.Background(), 2*time.Second)
		defer stop()
		_ = server.Stop(ctx)
	})
	url := "ws://" + addr + "/ws"

	ana := open(t, browserAPI, url, "call", "ana")
	bia := open(t, browserAPI, url, "call", "bia")

	t.Run("a participant becomes active only when its media path is up, through the real signalling", func(t *testing.T) {
		require.Eventually(t, func() bool { return ana.state(1) == "active" && ana.state(2) == "active" && bia.state(1) == "active" }, wait, 50*time.Millisecond)
	})

	t.Run("a microphone published by one is heard by the other, labelled with who and what", func(t *testing.T) {
		ana.publish("microphone")
		require.Eventually(t, func() bool { return bia.hears("1:microphone") }, wait, 50*time.Millisecond)
		assert.False(t, ana.hears("1:microphone"))
	})

	t.Run("a participant that never answers the media offer is removed, and nobody stays connecting forever", func(t *testing.T) {
		conn, _, _, err := ws.Dialer{Protocols: []string{signal.Subprotocol}}.Dial(context.Background(), url)
		require.NoError(t, err)
		defer conn.Close()
		require.NoError(t, wsutil.WriteClientText(conn, []byte(`{"t":"join","slug":"call","name":"mute"}`)))
		go func() {
			for {
				if _, _, err := wsutil.ReadServerData(conn); err != nil {
					return
				}
			}
		}()
		require.Eventually(t, func() bool { return ana.state(3) == "connecting" }, wait, 50*time.Millisecond)
		require.Eventually(t, func() bool { return ana.state(3) == "" }, wait, 50*time.Millisecond)
	})
}
