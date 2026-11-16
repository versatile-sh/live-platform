package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"runtime"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	_ "net/http/pprof"

	"github.com/coder/websocket"
	"github.com/pion/webrtc/v4"
)

var relayLog = flag.Bool("relaylog", false, "log selected pair for every PC")

type ctl struct {
	kind string
	i    int
}

type sfuState struct {
	sc       scenario
	api      *webrtc.API
	mu       sync.Mutex
	pcs      map[int]*webrtc.PeerConnection
	socks    map[int]*websocket.Conn
	locals   map[string]*webrtc.TrackLocalStaticRTP
	subCount map[string]int
	armed    bool
	inbox    chan ctl
	inboxMax atomic.Int64
	inboxFul atomic.Int64
	rtpIn    atomic.Int64
	rtpOutX  atomic.Int64 // expected out = in x subscribers
	subsDone atomic.Int64
	pcCount  atomic.Int64
	decoyRx  atomic.Int64
	decoyLog sync.Map
}

func (s *sfuState) post(c ctl) {
	select {
	case s.inbox <- c:
	default:
		s.inboxFul.Add(1)
	}
}

func rssKB() (rss, hwm int64) {
	b, _ := os.ReadFile("/proc/self/status")
	for _, l := range strings.Split(string(b), "\n") {
		f := strings.Fields(l)
		if len(f) >= 2 && f[0] == "VmRSS:" {
			rss, _ = strconv.ParseInt(f[1], 10, 64)
		}
		if len(f) >= 2 && f[0] == "VmHWM:" {
			hwm, _ = strconv.ParseInt(f[1], 10, 64)
		}
	}
	return
}

func runSFU() {
	bind := flag.String("bind", "127.0.0.1", "IP to bind (mux, http, turn)")
	scn := flag.String("scenario", "video30", "")
	muxPort := flag.Int("mux", 7882, "")
	httpPort := flag.Int("http", 8080, "")
	turnMode := flag.String("turn", "ip", "off|default|ip|ipport")
	decoy := flag.Int("decoy", 7999, "decoy UDP port (non-mux) on the SFU IP")
	flag.Parse()
	sc := scenarios[*scn]
	s := &sfuState{sc: sc, pcs: map[int]*webrtc.PeerConnection{}, socks: map[int]*websocket.Conn{},
		locals: map[string]*webrtc.TrackLocalStaticRTP{}, subCount: map[string]int{}, inbox: make(chan ctl, 256)}
	se := webrtc.SettingEngine{}
	se.SetICETimeouts(5*time.Second, 25*time.Second, 2*time.Second)
	uc, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.ParseIP(*bind), Port: *muxPort})
	if err != nil {
		panic(err)
	}
	se.SetICEUDPMux(webrtc.NewICEUDPMux(nil, uc))
	se.SetNAT1To1IPs([]string{*bind}, webrtc.ICECandidateTypeHost)
	s.api = webrtc.NewAPI(webrtc.WithSettingEngine(se))
	// room actor: owns control-plane state. Media forwarding does not pass through it (stub design).
	go func() {
		alive := map[int]time.Time{}
		for c := range s.inbox {
			if d := int64(len(s.inbox)); d > s.inboxMax.Load() {
				s.inboxMax.Store(d)
			}
			alive[c.i] = time.Now()
			_ = c.kind
		}
	}()
	// decoy listener standing in for "any other UDP service on the SFU IP"
	dc, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.ParseIP(*bind), Port: *decoy})
	if err != nil {
		panic(err)
	}
	go func() {
		b := make([]byte, 2048)
		for {
			n, from, err := dc.ReadFromUDP(b)
			if err != nil {
				return
			}
			s.decoyRx.Add(1)
			s.decoyLog.Store(from.String(), string(b[:n]))
		}
	}()
	if *turnMode != "off" {
		startTurn(*bind, *muxPort, *turnMode)
	}
	http.HandleFunc("/ws", s.handleWS)
	http.HandleFunc("/stats", func(w http.ResponseWriter, r *http.Request) {
		if r2 := r.URL.Query().Get("gc"); r2 == "1" {
			debug.FreeOSMemory() // forced GC: report live heap, not garbage headroom
		}
		var m runtime.MemStats
		runtime.ReadMemStats(&m)
		rss, hwm := rssKB()
		dl := map[string]string{}
		s.decoyLog.Range(func(k, v any) bool { dl[k.(string)] = v.(string); return true })
		json.NewEncoder(w).Encode(map[string]any{
			"ts": time.Now().UnixNano(), "goroutines": runtime.NumGoroutine(), "heap_alloc": m.HeapAlloc, "sys": m.Sys,
			"rss_kb": rss, "hwm_kb": hwm, "pcs": s.pcCount.Load(), "armed": s.armed, "subs_done": s.subsDone.Load(),
			"rtp_in": s.rtpIn.Load(), "rtp_out_expected": s.rtpOutX.Load(), "inbox_max": s.inboxMax.Load(), "inbox_full": s.inboxFul.Load(),
			"inbox_len": len(s.inbox), "decoy_rx": s.decoyRx.Load(), "decoy_from": dl, "gc": m.NumGC, "numcpu": runtime.NumCPU(), "gomaxprocs": runtime.GOMAXPROCS(0),
		})
	})
	fmt.Println("sfu listening", *bind, "scenario", *scn, "turn", *turnMode)
	panic(http.ListenAndServe(fmt.Sprintf("%s:%d", *bind, *httpPort), nil))
}

func (s *sfuState) handleWS(w http.ResponseWriter, r *http.Request) {
	c, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	c.SetReadLimit(1 << 20)
	idx, _ := strconv.Atoi(r.URL.Query().Get("i"))
	ctx := context.Background()
	pc, err := s.api.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		return
	}
	s.pcCount.Add(1)
	s.mu.Lock()
	s.pcs[idx] = pc
	s.socks[idx] = c
	s.mu.Unlock()
	pc.OnICEConnectionStateChange(func(st webrtc.ICEConnectionState) {
		s.post(ctl{"ice", idx})
		if st == webrtc.ICEConnectionStateConnected {
			go func() {
				time.Sleep(2 * time.Second)
				if idx < 3 || *relayLog {
					fmt.Println("sfu pc", idx, "selected pair:", selectedPair(pc))
				}
			}()
		}
	})
	pc.OnTrack(func(tr *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		kind := tr.ID() // client sets track id = "<kind>"
		k := key(idx, kind)
		local, _ := webrtc.NewTrackLocalStaticRTP(tr.Codec().RTPCodecCapability, kind, "p"+itoa(idx))
		s.mu.Lock()
		s.locals[k] = local
		n := len(s.locals)
		fire := n == s.sc.totalPubs() && !s.armed
		if fire {
			s.armed = true
		}
		s.mu.Unlock()
		if fire {
			go s.armAll()
		}
		go func() {
			for {
				p, _, err := tr.ReadRTP()
				if err != nil {
					return
				}
				s.rtpIn.Add(1)
				s.mu.Lock()
				sc := s.subCount[k]
				s.mu.Unlock()
				s.rtpOutX.Add(int64(sc))
				local.WriteRTP(p)
			}
		}()
	})
	for {
		_, d, err := c.Read(ctx)
		if err != nil {
			return
		}
		var m struct {
			T, SDP string
		}
		json.Unmarshal(d, &m)
		switch strings.ToLower(m.T) {
		case "hb":
			s.post(ctl{"hb", idx})
		case "offer":
			pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: m.SDP})
			ans, _ := pc.CreateAnswer(nil)
			gc := webrtc.GatheringCompletePromise(pc)
			pc.SetLocalDescription(ans)
			<-gc
			b, _ := json.Marshal(map[string]any{"t": "answer", "sdp": pc.LocalDescription().SDP})
			c.Write(ctx, websocket.MessageText, b)
		case "answer":
			pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: m.SDP})
			s.subsDone.Add(1)
		}
	}
}

// armAll: all publishers registered; add each subscriber's downlink tracks and renegotiate.
func (s *sfuState) armAll() {
	time.Sleep(500 * time.Millisecond)
	for i := 0; i < s.sc.n; i++ {
		s.mu.Lock()
		pc, c := s.pcs[i], s.socks[i]
		var add []*webrtc.TrackLocalStaticRTP
		for _, k := range s.sc.subs(i) {
			add = append(add, s.locals[k])
			s.subCount[k]++
		}
		s.mu.Unlock()
		for _, l := range add {
			if _, err := pc.AddTrack(l); err != nil {
				fmt.Println("addtrack err", err)
			}
		}
		off, _ := pc.CreateOffer(nil)
		gc := webrtc.GatheringCompletePromise(pc)
		pc.SetLocalDescription(off)
		<-gc
		b, _ := json.Marshal(map[string]any{"t": "offer", "sdp": pc.LocalDescription().SDP})
		c.Write(context.Background(), websocket.MessageText, b)
		time.Sleep(20 * time.Millisecond)
	}
}

func newSecret() string { b := make([]byte, 16); rand.Read(b); return hex.EncodeToString(b) }
