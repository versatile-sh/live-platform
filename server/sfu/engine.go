// Package sfu forwards each participant's media to the others in the room, on Pion.
package sfu

import (
	"encoding/json"
	"errors"
	"io"
	"net"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/pion/ice/v4"
	"github.com/pion/interceptor"
	"github.com/pion/interceptor/pkg/intervalpli"
	"github.com/pion/webrtc/v4"

	"github.com/versatile-sh/live/server/core/room"
)

// Reporter hears whether a participant's media path is up.
type Reporter interface {
	MediaUp(slug room.Slug, pid room.PID, gen uint32)
	MediaDown(slug room.Slug, pid room.PID, gen uint32)
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
	mu     sync.Mutex
	rooms  map[room.Slug]map[room.PID]*peer
}

type peer struct {
	slug room.Slug
	pid  room.PID
	gen  uint32
	send Sender

	mu      sync.Mutex
	sub     *webrtc.PeerConnection
	pub     *webrtc.PeerConnection
	dirty   bool
	silent  atomic.Bool
	sources map[string]string
	tracks  map[string]*webrtc.TrackLocalStaticRTP
	senders map[*webrtc.TrackLocalStaticRTP]*webrtc.RTPSender
}

// New builds an engine; with a UDP port every participant's media shares that one socket.
func New(cfg Config, report Reporter) (*Engine, error) {
	media := &webrtc.MediaEngine{}
	if err := media.RegisterDefaultCodecs(); err != nil {
		return nil, err
	}
	registry := &interceptor.Registry{}
	if err := webrtc.RegisterDefaultInterceptors(media, registry); err != nil {
		return nil, err
	}
	keyframes, err := intervalpli.NewReceiverInterceptor(intervalpli.GeneratorInterval(2 * time.Second))
	if err != nil {
		return nil, err
	}
	registry.Add(keyframes)

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
	return &Engine{api: api, report: report, rooms: map[room.Slug]map[room.PID]*peer{}}, nil
}

// Attach gives a participant its media connections, replacing any it had, and starts sending it the room.
func (e *Engine) Attach(slug room.Slug, pid room.PID, gen uint32, send Sender) {
	e.Detach(slug, pid)
	p := &peer{slug: slug, pid: pid, gen: gen, send: send, tracks: map[string]*webrtc.TrackLocalStaticRTP{}, senders: map[*webrtc.TrackLocalStaticRTP]*webrtc.RTPSender{}}
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
			e.report.MediaDown(slug, pid, gen)
		}
	})

	e.mu.Lock()
	members := e.rooms[slug]
	if members == nil {
		members = map[room.PID]*peer{}
		e.rooms[slug] = members
	}
	var existing []*webrtc.TrackLocalStaticRTP
	for _, other := range members {
		other.mu.Lock()
		for _, track := range other.tracks {
			existing = append(existing, track)
		}
		other.mu.Unlock()
	}
	members[pid] = p
	e.mu.Unlock()

	p.mu.Lock()
	for _, track := range existing {
		p.forward(track)
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
	gone := make([]*webrtc.TrackLocalStaticRTP, 0, len(p.tracks))
	for _, track := range p.tracks {
		gone = append(gone, track)
	}
	sub, pub := p.sub, p.pub
	p.sub, p.pub = nil, nil
	p.mu.Unlock()
	if sub != nil {
		_ = sub.Close()
	}
	if pub != nil {
		_ = pub.Close()
	}
	for _, track := range gone {
		e.withdraw(others, track)
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
	if p.pub == nil || p.pub.ConnectionState() == webrtc.PeerConnectionStateClosed {
		pub, err := e.api.NewPeerConnection(webrtc.Configuration{})
		if err != nil {
			p.mu.Unlock()
			return
		}
		pub.OnICECandidate(func(c *webrtc.ICECandidate) { p.candidate(room.MediaRolePublish, c) })
		pub.OnTrack(func(remote *webrtc.TrackRemote, _ *webrtc.RTPReceiver) { e.incoming(p, remote) })
		p.pub = pub
	}
	pub := p.pub
	p.sources = signal.Sources
	var stopped []*webrtc.TrackLocalStaticRTP
	for source, track := range p.tracks {
		if !declared(signal.Sources, source) {
			stopped = append(stopped, track)
			delete(p.tracks, source)
		}
	}
	p.mu.Unlock()

	answer, err := answerOffer(pub, signal.SDP)
	if err == nil {
		p.send(room.MediaSignal{Role: room.MediaRolePublish, Kind: room.MediaKindAnswer, SDP: answer.SDP})
	}
	if err != nil || len(signal.Sources) == 0 {
		p.mu.Lock()
		if p.pub == pub {
			p.pub = nil
		}
		p.mu.Unlock()
		_ = pub.Close()
	}

	if len(stopped) > 0 {
		e.mu.Lock()
		others := e.others(p.slug, p.pid)
		e.mu.Unlock()
		for _, track := range stopped {
			e.withdraw(others, track)
		}
	}
}

func answerOffer(pub *webrtc.PeerConnection, sdp string) (webrtc.SessionDescription, error) {
	if err := pub.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: sdp}); err != nil {
		return webrtc.SessionDescription{}, err
	}
	answer, err := pub.CreateAnswer(nil)
	if err != nil {
		return webrtc.SessionDescription{}, err
	}
	return answer, pub.SetLocalDescription(answer)
}

func declared(sources map[string]string, source string) bool {
	for _, s := range sources {
		if s == source {
			return true
		}
	}
	return false
}

func (e *Engine) incoming(p *peer, remote *webrtc.TrackRemote) {
	p.mu.Lock()
	source := p.sources[remote.StreamID()]
	if source == "" {
		source = p.sources[remote.ID()]
	}
	if source == "" || p.sub == nil {
		p.mu.Unlock()
		return
	}
	local, err := webrtc.NewTrackLocalStaticRTP(remote.Codec().RTPCodecCapability, source, strconv.FormatUint(uint64(p.pid), 10)+":"+source)
	if err != nil {
		p.mu.Unlock()
		return
	}
	previous := p.tracks[source]
	p.tracks[source] = local
	p.mu.Unlock()

	e.mu.Lock()
	others := e.others(p.slug, p.pid)
	e.mu.Unlock()
	if previous != nil {
		e.withdraw(others, previous)
	}
	for _, other := range others {
		other.mu.Lock()
		other.forward(local)
		other.offer()
		other.mu.Unlock()
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
	current := p.tracks[source] == local
	if current {
		delete(p.tracks, source)
	}
	p.mu.Unlock()
	if current {
		e.mu.Lock()
		others = e.others(p.slug, p.pid)
		e.mu.Unlock()
		e.withdraw(others, local)
	}
}

func (e *Engine) withdraw(from []*peer, track *webrtc.TrackLocalStaticRTP) {
	for _, other := range from {
		other.mu.Lock()
		if sender := other.senders[track]; sender != nil && other.sub != nil {
			_ = other.sub.RemoveTrack(sender)
			delete(other.senders, track)
			other.offer()
		}
		other.mu.Unlock()
	}
}

func (p *peer) forward(track *webrtc.TrackLocalStaticRTP) {
	if p.sub == nil || p.senders[track] != nil {
		return
	}
	sender, err := p.sub.AddTrack(track)
	if err != nil {
		return
	}
	p.senders[track] = sender
	go func() {
		feedback := make([]byte, 1500)
		for {
			if _, _, err := sender.Read(feedback); err != nil {
				return
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
