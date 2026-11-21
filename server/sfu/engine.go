// Package sfu forwards each participant's media to the others in the room, on Pion.
package sfu

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/pion/ice/v4"
	"github.com/pion/interceptor"
	"github.com/pion/rtcp"
	"github.com/pion/webrtc/v4"

	"github.com/versatile-sh/live/server/core/room"
)

// Reporter hears whether a participant's media path is up.
type Reporter interface {
	MediaUp(slug room.Slug, pid room.PID, gen uint32)
	MediaDown(slug room.Slug, pid room.PID, gen uint32)
	ServerTrouble(slug room.Slug, pid room.PID, gen uint32, trouble room.MediaTrouble, detail string)
}

// Sender delivers a media signal to one participant without blocking.
type Sender = func(room.MediaSignal)

// Config says where media travels: one UDP port for everyone when set, and the address to announce when the host is behind one.
type Config struct {
	UDPPort  int
	PublicIP string
	// Loopback keeps media on 127.0.0.1, for tests on one machine.
	Loopback bool
}

// Loopback limits ICE to 127.0.0.1 over UDP4: a machine with many interfaces (bridges, VMs) otherwise pairs every one and connects slowly.
func Loopback(settings *webrtc.SettingEngine) {
	settings.SetIncludeLoopbackCandidate(true)
	settings.SetNetworkTypes([]webrtc.NetworkType{webrtc.NetworkTypeUDP4})
	settings.SetIPFilter(func(ip net.IP) bool { return ip.IsLoopback() })
	settings.SetICEMulticastDNSMode(ice.MulticastDNSModeDisabled)
}

// Engine holds one pair of connections per participant: one it publishes on, one it is sent the room on.
type Engine struct {
	api    *webrtc.API
	report Reporter
	shared *histories
	mu     sync.Mutex
	rooms  map[room.Slug]map[room.PID]*peer
}

type peer struct {
	slug   room.Slug
	pid    room.PID
	gen    uint32
	send   Sender
	shared *histories

	mu      sync.Mutex
	sub     *webrtc.PeerConnection
	pub     *webrtc.PeerConnection
	dtls    string
	dirty   bool
	silent  atomic.Bool
	sources map[string]string
	names   map[string]string
	waiting []parked
	feeds   map[string]*feed
	senders map[*feed]*webrtc.RTPSender
}

// parked is a track that arrived before the publisher named it; it is read once it is named.
type parked struct {
	pc     *webrtc.PeerConnection
	remote *webrtc.TrackRemote
}

// keyframeGap is the least time between two keyframe requests for one feed, however many subscribers ask.
const keyframeGap = 500 * time.Millisecond

// feed is one source a participant sends, as it reaches the server, and whether the others are being sent it.
type feed struct {
	local *webrtc.TrackLocalStaticRTP
	pc    *webrtc.PeerConnection
	ssrc  uint32
	video bool
	on    bool
	past  *history
	asked atomic.Int64
}

// keyframe asks the publisher for a full picture, at most once per keyframeGap.
func (f *feed) keyframe() {
	if !f.video {
		return
	}
	now := time.Now().UnixNano()
	last := f.asked.Load()
	if now-last < int64(keyframeGap) || !f.asked.CompareAndSwap(last, now) {
		return
	}
	_ = f.pc.WriteRTCP([]rtcp.Packet{&rtcp.PictureLossIndication{MediaSSRC: f.ssrc}})
}

// wantsKeyframe reports whether a compound RTCP packet holds a picture loss indication or a full intra request, without allocating.
func wantsKeyframe(b []byte) bool {
	for len(b) >= 4 {
		if format := b[0] & 0x1f; b[1] == 206 && (format == 1 || format == 4) {
			return true
		}
		size := (int(binary.BigEndian.Uint16(b[2:4])) + 1) * 4
		if size > len(b) {
			return false
		}
		b = b[size:]
	}
	return false
}

// fingerprint is the DTLS fingerprint a description announces; a new one means the browser opened a new connection.
func fingerprint(sdp string) string {
	at := strings.Index(sdp, "a=fingerprint:")
	if at < 0 {
		return ""
	}
	line := sdp[at:]
	if end := strings.IndexAny(line, "\r\n"); end >= 0 {
		line = line[:end]
	}
	return line
}

// New builds an engine; with a UDP port every participant's media shares that one socket.
func New(cfg Config, report Reporter) (*Engine, error) {
	media := &webrtc.MediaEngine{}
	if err := media.RegisterDefaultCodecs(); err != nil {
		return nil, err
	}
	shared := newHistories()
	registry, err := interceptors(media, shared)
	if err != nil {
		return nil, err
	}
	settings := webrtc.SettingEngine{}
	if cfg.UDPPort != 0 {
		conn, err := net.ListenUDP("udp", &net.UDPAddr{Port: cfg.UDPPort})
		if err != nil {
			return nil, err
		}
		settings.SetICEUDPMux(webrtc.NewICEUDPMux(nil, conn))
	}
	if cfg.PublicIP != "" {
		settings.SetNAT1To1IPs([]string{cfg.PublicIP}, webrtc.ICECandidateTypeHost)
	}
	if cfg.Loopback {
		Loopback(&settings)
	}
	api := webrtc.NewAPI(webrtc.WithMediaEngine(media), webrtc.WithInterceptorRegistry(registry), webrtc.WithSettingEngine(settings))
	return &Engine{api: api, report: report, shared: shared, rooms: map[room.Slug]map[room.PID]*peer{}}, nil
}

// interceptors are Pion's defaults with the server's own NACK generator and responder, which allocate nothing per packet and keep one history per stream for every subscriber, and without Pion's statistics, which nothing reads.
func interceptors(media *webrtc.MediaEngine, shared *histories) (*interceptor.Registry, error) {
	registry := &interceptor.Registry{}
	media.RegisterFeedback(webrtc.RTCPFeedback{Type: "nack"}, webrtc.RTPCodecTypeVideo)
	media.RegisterFeedback(webrtc.RTCPFeedback{Type: "nack", Parameter: "pli"}, webrtc.RTPCodecTypeVideo)
	registry.Add(lossFactory{})
	if err := webrtc.ConfigureRTCPReports(registry); err != nil {
		return nil, err
	}
	if err := webrtc.ConfigureSimulcastExtensionHeaders(media); err != nil {
		return nil, err
	}
	if err := webrtc.ConfigureTWCCSender(media, registry); err != nil {
		return nil, err
	}
	registry.Add(retransmitFactory{shared: shared})
	return registry, nil
}

// Attach gives a participant its media connections, replacing any it had, and starts sending it the room.
func (e *Engine) Attach(slug room.Slug, pid room.PID, gen uint32, send Sender) {
	e.Detach(slug, pid)
	p := &peer{slug: slug, pid: pid, gen: gen, send: send, shared: e.shared, names: map[string]string{}, feeds: map[string]*feed{}, senders: map[*feed]*webrtc.RTPSender{}}
	sub, err := e.api.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		e.report.MediaDown(slug, pid, gen)
		return
	}
	p.sub = sub
	if _, err := sub.CreateDataChannel("lv", nil); err != nil {
		_ = sub.Close()
		e.report.MediaDown(slug, pid, gen)
		return
	}
	sub.OnICECandidate(func(c *webrtc.ICECandidate) { p.candidate(room.MediaRoleSubscribe, c) })
	sub.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		switch state {
		case webrtc.PeerConnectionStateConnected:
			e.report.MediaUp(slug, pid, gen)
		case webrtc.PeerConnectionStateFailed:
			e.report.ServerTrouble(slug, pid, gen, room.TroubleSubscribeLost, "")
			e.report.MediaDown(slug, pid, gen)
		}
	})

	e.mu.Lock()
	members := e.rooms[slug]
	if members == nil {
		members = map[room.PID]*peer{}
		e.rooms[slug] = members
	}
	var existing []*feed
	for _, other := range members {
		other.mu.Lock()
		for _, f := range other.feeds {
			if f.on {
				existing = append(existing, f)
			}
		}
		other.mu.Unlock()
	}
	members[pid] = p
	e.mu.Unlock()

	p.mu.Lock()
	for _, f := range existing {
		p.forward(f)
	}
	p.offer()
	p.mu.Unlock()
}

// Detach closes a participant's media and stops sending what it published to the others.
func (e *Engine) Detach(slug room.Slug, pid room.PID) {
	e.mu.Lock()
	members := e.rooms[slug]
	p := members[pid]
	delete(members, pid)
	if len(members) == 0 {
		delete(e.rooms, slug)
	}
	others := e.others(slug, pid)
	e.mu.Unlock()
	if p == nil {
		return
	}
	p.mu.Lock()
	gone := make([]*feed, 0, len(p.feeds))
	for _, f := range p.feeds {
		if f.on {
			gone = append(gone, f)
		}
	}
	clear(p.feeds)
	for f, sender := range p.senders {
		if f.past != nil {
			p.shared.unroute(sentSSRC(sender))
		}
	}
	clear(p.senders)
	sub, pub := p.sub, p.pub
	p.sub, p.pub = nil, nil
	p.waiting = nil
	p.mu.Unlock()
	if sub != nil {
		_ = sub.Close()
	}
	if pub != nil {
		_ = pub.Close()
	}
	for _, f := range gone {
		e.withdraw(others, f)
	}
}

// Silence stops, or resumes, carrying a participant's microphone: the packets still arrive and are dropped here, so a muted participant cannot be heard whatever their browser does.
func (e *Engine) Silence(slug room.Slug, pid room.PID, silent bool) {
	e.mu.Lock()
	p := e.rooms[slug][pid]
	e.mu.Unlock()
	if p != nil {
		p.silent.Store(silent)
	}
}

// Signal applies a description or a candidate a participant sent; one from a connection it no longer holds is ignored.
func (e *Engine) Signal(slug room.Slug, pid room.PID, gen uint32, signal room.MediaSignal) {
	e.mu.Lock()
	p := e.rooms[slug][pid]
	e.mu.Unlock()
	if p == nil || p.gen != gen {
		return
	}
	switch {
	case signal.Kind == room.MediaKindICE:
		p.addCandidate(signal)
	case signal.Role == room.MediaRoleSubscribe && signal.Kind == room.MediaKindAnswer:
		p.answered(signal.SDP)
	case signal.Role == room.MediaRolePublish && signal.Kind == room.MediaKindOffer:
		e.published(p, signal)
	}
}

func (e *Engine) others(slug room.Slug, except room.PID) []*peer {
	out := make([]*peer, 0, len(e.rooms[slug]))
	for pid, other := range e.rooms[slug] {
		if pid != except {
			out = append(out, other)
		}
	}
	return out
}

func (e *Engine) published(p *peer, signal room.MediaSignal) {
	p.mu.Lock()
	if p.sub == nil {
		p.mu.Unlock()
		return
	}
	dtls := fingerprint(signal.SDP)
	var stale *webrtc.PeerConnection
	var why string
	if p.pub != nil && (p.dtls != dtls || closedState(p.pub.ConnectionState())) {
		why = "new connection"
		if closedState(p.pub.ConnectionState()) {
			why = p.pub.ConnectionState().String()
		}
		stale, p.pub = p.pub, nil
		clear(p.names)
		p.waiting = nil
	}
	if p.pub == nil {
		pub, err := e.api.NewPeerConnection(webrtc.Configuration{})
		if err != nil {
			p.mu.Unlock()
			return
		}
		pub.OnICECandidate(func(c *webrtc.ICECandidate) { p.candidate(room.MediaRolePublish, c) })
		pub.OnTrack(func(remote *webrtc.TrackRemote, _ *webrtc.RTPReceiver) { e.incoming(p, pub, remote) })
		pub.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
			if state == webrtc.PeerConnectionStateFailed {
				e.report.ServerTrouble(p.slug, p.pid, p.gen, room.TroublePublishLost, "")
			}
		})
		p.pub, p.dtls = pub, dtls
	}
	pub := p.pub
	p.sources = signal.Sources
	for key, source := range signal.Sources {
		p.names[key] = source
	}
	var named []parked
	kept := p.waiting[:0]
	for _, w := range p.waiting {
		if p.nameOf(w.remote) != "" {
			named = append(named, w)
		} else {
			kept = append(kept, w)
		}
	}
	clear(p.waiting[len(kept):])
	p.waiting = kept
	var stopped, resumed []*feed
	for source, f := range p.feeds {
		on := declared(signal.Sources, source)
		if f.on && !on {
			stopped = append(stopped, f)
		} else if !f.on && on {
			resumed = append(resumed, f)
		}
		f.on = on
	}
	p.mu.Unlock()
	if stale != nil {
		_ = stale.Close()
		e.report.ServerTrouble(p.slug, p.pid, p.gen, room.TroublePublishReplaced, why)
	}
	for _, w := range named {
		go e.incoming(p, w.pc, w.remote)
	}

	if err := pub.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: signal.SDP}); err != nil {
		e.report.ServerTrouble(p.slug, p.pid, p.gen, room.TroubleOfferRejected, err.Error())
		return
	}
	answer, err := pub.CreateAnswer(nil)
	if err == nil {
		err = pub.SetLocalDescription(answer)
	}
	if err != nil {
		e.report.ServerTrouble(p.slug, p.pid, p.gen, room.TroubleOfferRejected, err.Error())
		return
	}
	p.send(room.MediaSignal{Role: room.MediaRolePublish, Kind: room.MediaKindAnswer, SDP: answer.SDP})

	if len(stopped) == 0 && len(resumed) == 0 {
		return
	}
	e.mu.Lock()
	others := e.others(p.slug, p.pid)
	e.mu.Unlock()
	for _, f := range stopped {
		e.withdraw(others, f)
	}
	for _, f := range resumed {
		e.spread(others, f)
	}
}

func (p *peer) nameOf(remote *webrtc.TrackRemote) string {
	if source := p.names[remote.StreamID()]; source != "" {
		return source
	}
	return p.names[remote.ID()]
}

func sentSSRC(sender *webrtc.RTPSender) uint32 {
	if encodings := sender.GetParameters().Encodings; len(encodings) > 0 {
		return uint32(encodings[0].SSRC)
	}
	return 0
}

func closedState(state webrtc.PeerConnectionState) bool {
	return state == webrtc.PeerConnectionStateClosed || state == webrtc.PeerConnectionStateFailed
}

func declared(sources map[string]string, source string) bool {
	for _, s := range sources {
		if s == source {
			return true
		}
	}
	return false
}

func (e *Engine) incoming(p *peer, pc *webrtc.PeerConnection, remote *webrtc.TrackRemote) {
	p.mu.Lock()
	if p.sub == nil || p.pub != pc {
		p.mu.Unlock()
		return
	}
	source := p.nameOf(remote)
	if source == "" {
		p.waiting = append(p.waiting, parked{pc: pc, remote: remote})
		p.mu.Unlock()
		return
	}
	on := declared(p.sources, source)
	local, err := webrtc.NewTrackLocalStaticRTP(remote.Codec().RTPCodecCapability, source, strconv.FormatUint(uint64(p.pid), 10)+":"+source)
	if err != nil {
		p.mu.Unlock()
		return
	}
	f := &feed{local: local, pc: pc, ssrc: uint32(remote.SSRC()), video: remote.Kind() == webrtc.RTPCodecTypeVideo, on: on}
	if f.video {
		f.past = &history{}
	}
	previous := p.feeds[source]
	p.feeds[source] = f
	p.mu.Unlock()

	e.mu.Lock()
	others := e.others(p.slug, p.pid)
	e.mu.Unlock()
	if previous != nil && previous.on {
		e.withdraw(others, previous)
	}
	if on {
		e.spread(others, f)
	}

	packet := make([]byte, 1500)
	for {
		n, _, err := remote.Read(packet)
		if err != nil {
			break
		}
		if source == "microphone" && p.silent.Load() {
			continue
		}
		if _, err := local.Write(packet[:n]); err != nil && !errors.Is(err, io.ErrClosedPipe) {
			break
		}
	}
	p.mu.Lock()
	current := p.feeds[source] == f
	shown := current && f.on
	if current {
		delete(p.feeds, source)
	}
	p.mu.Unlock()
	if shown {
		e.mu.Lock()
		others = e.others(p.slug, p.pid)
		e.mu.Unlock()
		e.withdraw(others, f)
	}
}

func (e *Engine) spread(to []*peer, f *feed) {
	for _, other := range to {
		other.mu.Lock()
		other.forward(f)
		other.offer()
		other.mu.Unlock()
	}
	f.keyframe()
}

func (e *Engine) withdraw(from []*peer, f *feed) {
	for _, other := range from {
		other.mu.Lock()
		if sender := other.senders[f]; sender != nil && other.sub != nil {
			_ = other.sub.RemoveTrack(sender)
			if f.past != nil {
				other.shared.unroute(sentSSRC(sender))
			}
			delete(other.senders, f)
			other.offer()
		}
		other.mu.Unlock()
	}
}

func (p *peer) forward(f *feed) {
	if p.sub == nil || p.senders[f] != nil {
		return
	}
	sender, err := p.sub.AddTrack(f.local)
	if err != nil {
		return
	}
	p.senders[f] = sender
	if f.past != nil {
		p.shared.route(sentSSRC(sender), f.past)
	}
	go func() {
		feedback := make([]byte, 1500)
		for {
			n, _, err := sender.Read(feedback)
			if err != nil {
				return
			}
			if wantsKeyframe(feedback[:n]) {
				f.keyframe()
			}
		}
	}()
}

func (p *peer) offer() {
	if p.sub == nil {
		return
	}
	if p.sub.SignalingState() != webrtc.SignalingStateStable {
		p.dirty = true
		return
	}
	p.dirty = false
	offer, err := p.sub.CreateOffer(nil)
	if err != nil || p.sub.SetLocalDescription(offer) != nil {
		return
	}
	p.send(room.MediaSignal{Role: room.MediaRoleSubscribe, Kind: room.MediaKindOffer, SDP: offer.SDP})
}

func (p *peer) answered(sdp string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.sub == nil || p.sub.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: sdp}) != nil {
		return
	}
	if p.dirty {
		p.offer()
	}
}

func (p *peer) candidate(role string, c *webrtc.ICECandidate) {
	if c == nil {
		return
	}
	encoded, err := json.Marshal(c.ToJSON())
	if err != nil {
		return
	}
	p.send(room.MediaSignal{Role: role, Kind: room.MediaKindICE, Candidate: string(encoded)})
}

func (p *peer) addCandidate(signal room.MediaSignal) {
	var init webrtc.ICECandidateInit
	if json.Unmarshal([]byte(signal.Candidate), &init) != nil {
		return
	}
	p.mu.Lock()
	pc := p.sub
	if signal.Role == room.MediaRolePublish {
		pc = p.pub
	}
	p.mu.Unlock()
	if pc != nil {
		_ = pc.AddICECandidate(init)
	}
}
