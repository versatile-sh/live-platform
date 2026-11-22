package sfu

import (
	"encoding/json"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/pion/rtcp"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/versatile-sh/live/server/core/room"
)

const wait = 10 * time.Second

var browserAPI = func() *webrtc.API {
	settings := webrtc.SettingEngine{}
	Loopback(&settings)
	return webrtc.NewAPI(webrtc.WithSettingEngine(settings))
}()

type reports struct {
	mu       sync.Mutex
	up       map[room.PID]bool
	troubles []string
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

func (r *reports) ServerTrouble(_ room.Slug, _ room.PID, _ uint32, trouble room.MediaTrouble, _ string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.troubles = append(r.troubles, string(trouble))
}

func (r *reports) seen(trouble room.MediaTrouble) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, t := range r.troubles {
		if t == string(trouble) {
			return true
		}
	}
	return false
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
	inbox  chan room.MediaSignal
	done   chan struct{}
	early  map[*webrtc.PeerConnection][]webrtc.ICECandidateInit
}

func enter(t *testing.T, engine *Engine, pid room.PID) *browser {
	t.Helper()
	return enterWith(t, engine, pid, browserAPI)
}

func enterWith(t *testing.T, engine *Engine, pid room.PID, subAPI *webrtc.API) *browser {
	t.Helper()
	sub, err := subAPI.NewPeerConnection(webrtc.Configuration{})
	require.NoError(t, err)
	t.Cleanup(func() { _ = sub.Close() })
	b := &browser{t: t, engine: engine, pid: pid, sub: sub, heard: map[string]string{}, inbox: make(chan room.MediaSignal, 256), done: make(chan struct{}), early: map[*webrtc.PeerConnection][]webrtc.ICECandidateInit{}}
	b.renew()
	go b.run()
	t.Cleanup(func() { close(b.done) })
	sub.OnICECandidate(b.trickle(room.MediaRoleSubscribe))
	sub.OnTrack(func(remote *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		if _, _, err := remote.ReadRTP(); err != nil {
			return
		}
		b.mu.Lock()
		source := remote.ID()
		b.heard[source] = remote.StreamID()
		b.mu.Unlock()
	})
	engine.Attach("bk", pid, 1, func(signal room.MediaSignal) {
		select {
		case b.inbox <- signal:
		case <-b.done:
		}
	})
	return b
}

func (b *browser) trickle(role string) func(*webrtc.ICECandidate) {
	return func(c *webrtc.ICECandidate) {
		if c == nil {
			return
		}
		encoded, _ := json.Marshal(c.ToJSON())
		b.engine.Signal("bk", b.pid, 1, room.MediaSignal{Role: role, Kind: room.MediaKindICE, Candidate: string(encoded)})
	}
}

func (b *browser) renew() {
	b.t.Helper()
	pub, err := browserAPI.NewPeerConnection(webrtc.Configuration{})
	require.NoError(b.t, err)
	b.t.Cleanup(func() { _ = pub.Close() })
	pub.OnICECandidate(b.trickle(room.MediaRolePublish))
	b.mu.Lock()
	b.pub = pub
	b.mu.Unlock()
}

func (b *browser) publisher() *webrtc.PeerConnection {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.pub
}

func (b *browser) run() {
	for {
		select {
		case <-b.done:
			return
		case signal := <-b.inbox:
			b.receive(signal)
		}
	}
}

func (b *browser) receive(signal room.MediaSignal) {
	pc := b.sub
	if signal.Role == room.MediaRolePublish {
		pc = b.publisher()
	}
	switch {
	case signal.Kind == room.MediaKindICE:
		var init webrtc.ICECandidateInit
		if json.Unmarshal([]byte(signal.Candidate), &init) != nil {
			return
		}
		if pc.RemoteDescription() == nil {
			b.early[pc] = append(b.early[pc], init)
			return
		}
		_ = pc.AddICECandidate(init)
	case signal.Role == room.MediaRoleSubscribe && signal.Kind == room.MediaKindOffer:
		b.mu.Lock()
		b.offers++
		b.mu.Unlock()
		if !b.describe(pc, webrtc.SDPTypeOffer, signal.SDP) {
			return
		}
		answer, err := b.sub.CreateAnswer(nil)
		if err != nil || b.sub.SetLocalDescription(answer) != nil {
			return
		}
		b.engine.Signal("bk", b.pid, 1, room.MediaSignal{Role: room.MediaRoleSubscribe, Kind: room.MediaKindAnswer, SDP: answer.SDP})
	case signal.Role == room.MediaRolePublish && signal.Kind == room.MediaKindAnswer:
		b.describe(pc, webrtc.SDPTypeAnswer, signal.SDP)
	}
}

func (b *browser) describe(pc *webrtc.PeerConnection, kind webrtc.SDPType, sdp string) bool {
	if pc.SetRemoteDescription(webrtc.SessionDescription{Type: kind, SDP: sdp}) != nil {
		return false
	}
	for _, init := range b.early[pc] {
		_ = pc.AddICECandidate(init)
	}
	delete(b.early, pc)
	return true
}

func (b *browser) declare(sources map[string]string) {
	b.t.Helper()
	b.offer(b.publisher(), sources)
}

func (e *Engine) forwarding(slug room.Slug, to, from room.PID, source string) bool {
	e.mu.Lock()
	receiver, sender := e.rooms[slug][to], e.rooms[slug][from]
	e.mu.Unlock()
	if receiver == nil || sender == nil {
		return false
	}
	sender.mu.Lock()
	f := sender.feeds[source]
	sender.mu.Unlock()
	if f == nil {
		return false
	}
	receiver.mu.Lock()
	defer receiver.mu.Unlock()
	return receiver.senders[f] != nil
}

func (e *Engine) publisher(slug room.Slug, pid room.PID) *webrtc.PeerConnection {
	e.mu.Lock()
	p := e.rooms[slug][pid]
	e.mu.Unlock()
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.pub
}

func (b *browser) publish(source string) {
	b.t.Helper()
	b.publishKeyed(source, "stream-"+source)
}

func (b *browser) publishKeyed(source, key string) {
	b.t.Helper()
	track, err := webrtc.NewTrackLocalStaticRTP(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8}, "track-"+source, "stream-"+source)
	require.NoError(b.t, err)
	pub := b.publisher()
	_, err = pub.AddTrack(track)
	require.NoError(b.t, err)
	b.offer(pub, map[string]string{key: source})
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

func (b *browser) offer(pub *webrtc.PeerConnection, sources map[string]string) {
	b.t.Helper()
	offer, err := pub.CreateOffer(nil)
	require.NoError(b.t, err)
	require.NoError(b.t, pub.SetLocalDescription(offer))
	b.engine.Signal("bk", b.pid, 1, room.MediaSignal{Role: room.MediaRolePublish, Kind: room.MediaKindOffer, SDP: offer.SDP, Sources: sources})
}

func (b *browser) unpublish() {
	b.t.Helper()
	pub := b.publisher()
	for _, transceiver := range pub.GetTransceivers() {
		require.NoError(b.t, transceiver.Stop())
	}
	b.offer(pub, map[string]string{})
	require.Eventually(b.t, func() bool { return pub.SignalingState() != webrtc.SignalingStateHaveLocalOffer }, wait, 20*time.Millisecond)
	b.renew()
}

func (b *browser) hears(source string) (string, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	stream, ok := b.heard[source]
	return stream, ok
}

func TestWantsKeyframe(t *testing.T) {
	pli, err := (&rtcp.PictureLossIndication{MediaSSRC: 7}).Marshal()
	require.NoError(t, err)
	fir, err := (&rtcp.FullIntraRequest{MediaSSRC: 7}).Marshal()
	require.NoError(t, err)
	receiver, err := (&rtcp.ReceiverReport{SSRC: 7}).Marshal()
	require.NoError(t, err)
	nack, err := (&rtcp.TransportLayerNack{MediaSSRC: 7, Nacks: []rtcp.NackPair{{PacketID: 1}}}).Marshal()
	require.NoError(t, err)

	compound := append(append([]byte{}, receiver...), pli...)
	assert.True(t, wantsKeyframe(pli))
	assert.True(t, wantsKeyframe(fir))
	assert.True(t, wantsKeyframe(compound), "a picture loss after a receiver report in one compound packet")
	assert.False(t, wantsKeyframe(append(append([]byte{}, receiver...), nack...)))
	assert.False(t, wantsKeyframe([]byte{0x81, 206}))
	assert.False(t, wantsKeyframe([]byte{0x81, 201, 0xff, 0xff}), "a length past the end")
	assert.Zero(t, testing.AllocsPerRun(100, func() { wantsKeyframe(compound) }))
}

func TestFingerprint(t *testing.T) {
	assert.Equal(t, "a=fingerprint:sha-256 AB:CD", fingerprint("v=0\r\na=fingerprint:sha-256 AB:CD\r\nm=video"))
	assert.Empty(t, fingerprint("v=0\r\n"))
}

func TestEngine(t *testing.T) {
	seen := &reports{up: map[room.PID]bool{}}
	engine, err := New(Config{Loopback: true, Now: time.Now}, seen)
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
		assert.Equal(t, "1:camera", stream)
		_, echoed := ana.hears("camera")
		assert.False(t, echoed)
	})

	t.Run("someone who arrives later is sent what is already published", func(t *testing.T) {
		caio := enter(t, engine, 3)
		require.Eventually(t, func() bool { stream, ok := caio.hears("camera"); return ok && stream == "1:camera" }, wait, 20*time.Millisecond)
	})

	t.Run("a silenced participant's microphone is not carried to the others, and is again once let speak", func(t *testing.T) {
		dani := enter(t, engine, 4)
		var packets atomic.Int64
		dani.sub.OnTrack(func(remote *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
			for {
				if _, _, err := remote.ReadRTP(); err != nil {
					return
				}
				if remote.StreamID() == "1:microphone" {
					packets.Add(1)
				}
			}
		})
		ana.publish("microphone")
		require.Eventually(t, func() bool { return packets.Load() > 3 }, wait, 20*time.Millisecond)
		engine.Silence("bk", 1, true)
		time.Sleep(150 * time.Millisecond)
		before := packets.Load()
		time.Sleep(300 * time.Millisecond)
		assert.LessOrEqual(t, packets.Load()-before, int64(1), "nothing more arrives while silenced")
		engine.Silence("bk", 1, false)
		require.Eventually(t, func() bool { return packets.Load() > before+3 }, wait, 20*time.Millisecond)
	})

	t.Run("a client older than stream ids, naming its source by track id, is still carried", func(t *testing.T) {
		bia.publishKeyed("screen", "track-screen")
		require.Eventually(t, func() bool { stream, ok := ana.hears("screen"); return ok && stream == "2:screen" }, wait, 20*time.Millisecond)
	})

	t.Run("a source declared off keeps its feed and stops reaching the others, and reaches them again once declared on", func(t *testing.T) {
		require.Eventually(t, func() bool { return engine.forwarding("bk", 1, 2, "screen") }, wait, 20*time.Millisecond)
		bia.declare(map[string]string{})
		require.Eventually(t, func() bool { return !engine.forwarding("bk", 1, 2, "screen") }, wait, 20*time.Millisecond)
		bia.declare(map[string]string{"track-screen": "screen"})
		require.Eventually(t, func() bool { return engine.forwarding("bk", 1, 2, "screen") }, wait, 20*time.Millisecond)
	})

	t.Run("a track that arrives before its source is named waits, and is carried once the publisher names it", func(t *testing.T) {
		caio := enter(t, engine, 5)
		track, err := webrtc.NewTrackLocalStaticRTP(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8}, "track-camera", "stream-late")
		require.NoError(t, err)
		_, err = caio.publisher().AddTrack(track)
		require.NoError(t, err)
		caio.declare(map[string]string{})
		stop := make(chan struct{})
		t.Cleanup(func() { close(stop) })
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
		require.Eventually(t, func() bool {
			engine.mu.Lock()
			p := engine.rooms["bk"][5]
			engine.mu.Unlock()
			p.mu.Lock()
			defer p.mu.Unlock()
			return len(p.waiting) == 1
		}, wait, 20*time.Millisecond)
		caio.declare(map[string]string{"stream-late": "camera"})
		require.Eventually(t, func() bool { return engine.forwarding("bk", 2, 5, "camera") }, wait, 20*time.Millisecond)
	})

	t.Run("an offer from a new browser connection replaces the publish connection instead of failing on the old one", func(t *testing.T) {
		before := engine.publisher("bk", 2)
		fresh, err := browserAPI.NewPeerConnection(webrtc.Configuration{})
		require.NoError(t, err)
		t.Cleanup(func() { _ = fresh.Close() })
		_, err = fresh.AddTransceiverFromKind(webrtc.RTPCodecTypeVideo, webrtc.RTPTransceiverInit{Direction: webrtc.RTPTransceiverDirectionSendonly})
		require.NoError(t, err)
		offer, err := fresh.CreateOffer(nil)
		require.NoError(t, err)
		require.NoError(t, fresh.SetLocalDescription(offer))
		engine.Signal("bk", 2, 1, room.MediaSignal{Role: room.MediaRolePublish, Kind: room.MediaKindOffer, SDP: offer.SDP, Sources: map[string]string{}})
		after := engine.publisher("bk", 2)
		assert.NotSame(t, before, after)
		assert.Equal(t, webrtc.PeerConnectionStateClosed, before.ConnectionState())
		assert.True(t, seen.seen(room.TroublePublishReplaced), "the replaced connection is told as a trouble")
		engine.mu.Lock()
		p := engine.rooms["bk"][2]
		engine.mu.Unlock()
		p.mu.Lock()
		for source, f := range p.feeds {
			assert.Same(t, after, f.pc, "no feed of the closed connection is kept: %s", source)
		}
		p.mu.Unlock()
	})

	t.Run("an offer the server cannot apply is told as a trouble instead of going unanswered in silence", func(t *testing.T) {
		enter(t, engine, 6)
		engine.Signal("bk", 6, 1, room.MediaSignal{Role: room.MediaRolePublish, Kind: room.MediaKindOffer, SDP: "v=0 not a description"})
		assert.True(t, seen.seen(room.TroubleOfferRejected))
	})

	t.Run("one who stopped publishing everything publishes again, on a new connection", func(t *testing.T) {
		eva := enter(t, engine, 7)
		eva.publish("camera")
		require.Eventually(t, func() bool { stream, ok := ana.hears("camera"); return ok && stream == "7:camera" }, wait, 20*time.Millisecond)
		eva.unpublish()
		eva.publish("screen")
		require.Eventually(t, func() bool { stream, ok := ana.hears("screen"); return ok && stream == "7:screen" }, wait, 20*time.Millisecond)
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
