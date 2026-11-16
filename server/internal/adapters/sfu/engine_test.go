package sfu

import (
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/versatile-sh/live/server/internal/domain/room"
)

const wait = 10 * time.Second

type reports struct {
	mu sync.Mutex
	up map[room.PID]bool
}

func (r *reports) MediaUp(_ room.Slug, pid room.PID, _ uint32) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.up[pid] = true
}

func (r *reports) MediaDown(_ room.Slug, pid room.PID, _ uint32) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.up[pid] = false
}

func (r *reports) isUp(pid room.PID) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.up[pid]
}

type browser struct {
	t      *testing.T
	engine *Engine
	pid    room.PID
	sub    *webrtc.PeerConnection
	pub    *webrtc.PeerConnection
	mu     sync.Mutex
	heard  map[string]string
	offers int
}

func enter(t *testing.T, engine *Engine, pid room.PID) *browser {
	t.Helper()
	sub, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	require.NoError(t, err)
	pub, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	require.NoError(t, err)
	t.Cleanup(func() { _ = sub.Close(); _ = pub.Close() })
	b := &browser{t: t, engine: engine, pid: pid, sub: sub, pub: pub, heard: map[string]string{}}
	trickle := func(role string) func(*webrtc.ICECandidate) {
		return func(c *webrtc.ICECandidate) {
			if c == nil {
				return
			}
			encoded, _ := json.Marshal(c.ToJSON())
			engine.Signal("bk", pid, 1, room.MediaSignal{Role: role, Kind: room.MediaKindICE, Candidate: string(encoded)})
		}
	}
	sub.OnICECandidate(trickle(room.MediaRoleSubscribe))
	pub.OnICECandidate(trickle(room.MediaRolePublish))
	sub.OnTrack(func(remote *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		if _, _, err := remote.ReadRTP(); err != nil {
			return
		}
		b.mu.Lock()
		b.heard[remote.ID()] = remote.StreamID()
		b.mu.Unlock()
	})
	engine.Attach("bk", pid, 1, b.receive)
	return b
}

func (b *browser) receive(signal room.MediaSignal) {
	switch {
	case signal.Kind == room.MediaKindICE:
		var init webrtc.ICECandidateInit
		if json.Unmarshal([]byte(signal.Candidate), &init) != nil {
			return
		}
		pc := b.sub
		if signal.Role == room.MediaRolePublish {
			pc = b.pub
		}
		_ = pc.AddICECandidate(init)
	case signal.Role == room.MediaRoleSubscribe && signal.Kind == room.MediaKindOffer:
		go func() {
			b.mu.Lock()
			b.offers++
			b.mu.Unlock()
			if b.sub.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: signal.SDP}) != nil {
				return
			}
			answer, err := b.sub.CreateAnswer(nil)
			if err != nil || b.sub.SetLocalDescription(answer) != nil {
				return
			}
			b.engine.Signal("bk", b.pid, 1, room.MediaSignal{Role: room.MediaRoleSubscribe, Kind: room.MediaKindAnswer, SDP: answer.SDP})
		}()
	case signal.Role == room.MediaRolePublish && signal.Kind == room.MediaKindAnswer:
		_ = b.pub.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: signal.SDP})
	}
}

func (b *browser) publish(source string) {
	b.t.Helper()
	track, err := webrtc.NewTrackLocalStaticRTP(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8}, "track-"+source, "stream")
	require.NoError(b.t, err)
	_, err = b.pub.AddTrack(track)
	require.NoError(b.t, err)
	offer, err := b.pub.CreateOffer(nil)
	require.NoError(b.t, err)
	require.NoError(b.t, b.pub.SetLocalDescription(offer))
	b.engine.Signal("bk", b.pid, 1, room.MediaSignal{Role: room.MediaRolePublish, Kind: room.MediaKindOffer, SDP: offer.SDP, Sources: map[string]string{"track-" + source: source}})
	stop := make(chan struct{})
	b.t.Cleanup(func() { close(stop) })
	go func() {
		for seq := uint16(0); ; seq++ {
			select {
			case <-stop:
				return
			case <-time.After(20 * time.Millisecond):
				_ = track.WriteRTP(&rtp.Packet{Header: rtp.Header{Version: 2, SequenceNumber: seq, Timestamp: uint32(seq) * 3000}, Payload: []byte{0x10, 0x02, 0x03}})
			}
		}
	}()
}

func (b *browser) hears(source string) (string, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	stream, ok := b.heard[source]
	return stream, ok
}

func TestEngine(t *testing.T) {
	seen := &reports{up: map[room.PID]bool{}}
	engine, err := New(Config{}, seen)
	require.NoError(t, err)

	ana := enter(t, engine, 1)
	bia := enter(t, engine, 2)

	t.Run("a participant's media path comes up with nothing published", func(t *testing.T) {
		require.Eventually(t, func() bool { return seen.isUp(1) && seen.isUp(2) }, wait, 20*time.Millisecond)
	})

	t.Run("what one publishes reaches the other, labelled with who sent it and what it is, and not the sender", func(t *testing.T) {
		ana.publish("camera")
		require.Eventually(t, func() bool { _, ok := bia.hears("camera"); return ok }, wait, 20*time.Millisecond)
		stream, _ := bia.hears("camera")
		assert.Equal(t, "1", stream)
		_, echoed := ana.hears("camera")
		assert.False(t, echoed)
	})

	t.Run("someone who arrives later is sent what is already published", func(t *testing.T) {
		caio := enter(t, engine, 3)
		require.Eventually(t, func() bool { stream, ok := caio.hears("camera"); return ok && stream == "1" }, wait, 20*time.Millisecond)
	})

	t.Run("signals from a connection the participant no longer holds are ignored", func(t *testing.T) {
		engine.Signal("bk", 2, 99, room.MediaSignal{Role: room.MediaRoleSubscribe, Kind: room.MediaKindAnswer, SDP: "garbage"})
		engine.Signal("nowhere", 2, 1, room.MediaSignal{Role: room.MediaRolePublish, Kind: room.MediaKindOffer, SDP: "garbage"})
	})

	t.Run("when the publisher goes, the others are told to stop expecting its media", func(t *testing.T) {
		bia.mu.Lock()
		before := bia.offers
		bia.mu.Unlock()
		engine.Detach("bk", 1)
		require.Eventually(t, func() bool {
			bia.mu.Lock()
			defer bia.mu.Unlock()
			return bia.offers > before
		}, wait, 20*time.Millisecond)
		engine.mu.Lock()
		_, still := engine.rooms["bk"][1]
		engine.mu.Unlock()
		assert.False(t, still)
	})
}
