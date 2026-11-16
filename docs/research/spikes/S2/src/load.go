package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

var (
	recvPkts, sentPkts, connected, renegDone atomic.Int64
)

func selectedPair(pc *webrtc.PeerConnection) string {
	rep := pc.GetStats()
	cands := map[string]webrtc.ICECandidateStats{}
	for _, v := range rep {
		if c, ok := v.(webrtc.ICECandidateStats); ok {
			cands[c.ID] = c
		}
	}
	for _, v := range rep {
		if p, ok := v.(webrtc.ICECandidatePairStats); ok && p.Nominated {
			l, r := cands[p.LocalCandidateID], cands[p.RemoteCandidateID]
			return fmt.Sprintf("local=%s/%s:%d remote=%s/%s:%d state=%s", l.CandidateType, l.IP, l.Port, r.CandidateType, r.IP, r.Port, p.State)
		}
	}
	return "none nominated"
}

type loadCfg struct {
	server, scn string
	relay       bool
	turnIP      string
	n           int
	dur         time.Duration
}

func runLoad() {
	var c loadCfg
	flag.StringVar(&c.server, "server", "127.0.0.1:8080", "")
	flag.StringVar(&c.scn, "scenario", "video30", "")
	flag.BoolVar(&c.relay, "relay", false, "")
	flag.StringVar(&c.turnIP, "turnip", "", "")
	flag.IntVar(&c.n, "n", 0, "")
	flag.DurationVar(&c.dur, "dur", 100*time.Second, "")
	flag.Parse()
	load(c)
}

func runRelayTest() {
	var c loadCfg
	flag.StringVar(&c.server, "server", "127.0.0.1:8080", "")
	flag.StringVar(&c.turnIP, "turnip", "127.0.0.1", "")
	flag.Parse()
	c.scn, c.relay, c.dur = "relay1", true, 15*time.Second
	load(c)
}

func load(c loadCfg) {
	sc := scenarios[c.scn]
	if c.n > 0 {
		sc.n = c.n
	}
	var wg sync.WaitGroup
	ctx, cancel := context.WithTimeout(context.Background(), c.dur)
	defer cancel()
	for i := 0; i < sc.n; i++ {
		wg.Add(1)
		go func(i int) { defer wg.Done(); client(ctx, c, sc, i) }(i)
		time.Sleep(15 * time.Millisecond)
	}
	t := time.NewTicker(5 * time.Second)
	go func() {
		for range t.C {
			b, _ := json.Marshal(map[string]any{"ts": time.Now().UnixNano(), "connected": connected.Load(), "reneg": renegDone.Load(), "sent": sentPkts.Load(), "recv": recvPkts.Load()})
			fmt.Println(string(b))
		}
	}()
	wg.Wait()
	t.Stop()
	b, _ := json.Marshal(map[string]any{"ts": time.Now().UnixNano(), "final": true, "connected": connected.Load(), "reneg": renegDone.Load(), "sent": sentPkts.Load(), "recv": recvPkts.Load()})
	fmt.Println(string(b))
}

func client(ctx context.Context, cfg loadCfg, sc scenario, i int) {
	ws, _, err := websocket.Dial(ctx, "ws://"+cfg.server+"/ws?i="+itoa(i), nil)
	if err != nil {
		fmt.Println("dial err", i, err)
		return
	}
	ws.SetReadLimit(1 << 20)
	defer ws.CloseNow()
	pcfg := webrtc.Configuration{}
	if cfg.relay {
		u, p := restCreds()
		pcfg.ICEServers = []webrtc.ICEServer{{URLs: []string{"turn:" + cfg.turnIP + ":3478?transport=udp"}, Username: u, Credential: p}}
		pcfg.ICETransportPolicy = webrtc.ICETransportPolicyRelay
	}
	se := webrtc.SettingEngine{}
	se.SetICETimeouts(5*time.Second, 25*time.Second, 2*time.Second)
	api := webrtc.NewAPI(webrtc.WithSettingEngine(se))
	pc, err := api.NewPeerConnection(pcfg)
	if err != nil {
		fmt.Println("pc err", err)
		return
	}
	defer pc.Close()
	var senders []struct {
		tr   *webrtc.TrackLocalStaticRTP
		kind string
	}
	for _, kind := range sc.pubs(i) {
		mt := webrtc.MimeTypeVP8
		if kind == "aud" {
			mt = webrtc.MimeTypeOpus
		}
		tr, _ := webrtc.NewTrackLocalStaticRTP(webrtc.RTPCodecCapability{MimeType: mt}, kind, "p"+itoa(i))
		if _, err := pc.AddTrack(tr); err != nil {
			fmt.Println("addtrack", err)
		}
		senders = append(senders, struct {
			tr   *webrtc.TrackLocalStaticRTP
			kind string
		}{tr, kind})
	}
	if len(senders) == 0 { // listeners join with a recvonly audio m-line so ICE/DTLS come up in the first negotiation
		pc.AddTransceiverFromKind(webrtc.RTPCodecTypeAudio, webrtc.RTPTransceiverInit{Direction: webrtc.RTPTransceiverDirectionRecvonly})
	}
	pc.OnTrack(func(tr *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		for {
			if _, _, err := tr.ReadRTP(); err != nil {
				return
			}
			recvPkts.Add(1)
		}
	})
	pc.OnICEConnectionStateChange(func(st webrtc.ICEConnectionState) {
		if st == webrtc.ICEConnectionStateConnected {
			connected.Add(1)
			if cfg.relay {
				go func() { time.Sleep(2 * time.Second); fmt.Println("client selected pair:", selectedPair(pc)) }()
			}
		}
	})
	off, _ := pc.CreateOffer(nil)
	gc := webrtc.GatheringCompletePromise(pc)
	pc.SetLocalDescription(off)
	<-gc
	b, _ := json.Marshal(map[string]any{"t": "offer", "sdp": pc.LocalDescription().SDP})
	ws.Write(ctx, websocket.MessageText, b)
	started := false
	go func() {
		t := time.NewTicker(4 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-t.C:
				ws.Write(ctx, websocket.MessageText, []byte(`{"t":"hb"}`))
			case <-ctx.Done():
				return
			}
		}
	}()
	for {
		_, d, err := ws.Read(ctx)
		if err != nil {
			return
		}
		var m struct{ T, SDP string }
		json.Unmarshal(d, &m)
		switch strings.ToLower(m.T) {
		case "answer":
			pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: m.SDP})
			if !started {
				started = true
				for _, s := range senders {
					go send(ctx, s.tr, s.kind)
				}
			}
		case "offer":
			pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: m.SDP})
			ans, _ := pc.CreateAnswer(nil)
			g := webrtc.GatheringCompletePromise(pc)
			pc.SetLocalDescription(ans)
			<-g
			bb, _ := json.Marshal(map[string]any{"t": "answer", "sdp": pc.LocalDescription().SDP})
			ws.Write(ctx, websocket.MessageText, bb)
			renegDone.Add(1)
		}
	}
}

func send(ctx context.Context, tr *webrtc.TrackLocalStaticRTP, kind string) {
	pps, pl := rate(kind)
	t := time.NewTicker(time.Second / time.Duration(pps))
	defer t.Stop()
	payload := make([]byte, pl)
	var seq uint16
	var ts uint32
	for {
		select {
		case <-t.C:
			seq++
			ts += 90000 / uint32(pps)
			if err := tr.WriteRTP(&rtp.Packet{Header: rtp.Header{Version: 2, SequenceNumber: seq, Timestamp: ts}, Payload: payload}); err == nil {
				sentPkts.Add(1)
			}
		case <-ctx.Done():
			return
		}
	}
}
