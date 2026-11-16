// S1 stub server: room actor + participant state machine (SYNTHESIS 2.2) on
// pion/webrtc v4.2.26 and coder/websocket v1.8.15. Stand-in for the real `live` binary.
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/pion/webrtc/v4"
)

type state string

const (
	stConnecting state = "connecting"
	stActive     state = "active"
	stSuspect    state = "reconnecting"
	stRemoved    state = "removed"
)

var (
	noFrameLimit = flag.Duration("noframe", 12*time.Second, "no frame from the socket")
	noHBLimit    = flag.Duration("nohb", 12*time.Second, "no app hb")
	graceLimit   = flag.Duration("grace", 8*time.Second, "SUSPECT grace")
	connectLimit = flag.Duration("connect", 15*time.Second, "ICE connect limit")
	pingEvery    = flag.Duration("ping", 4*time.Second, "server ping period")
	capLimit     = flag.Duration("cap", 0, "amendment: max time from first leaving ACTIVE until ACTIVE again (0 = off, spec as written)")
	tickEvery    = flag.Duration("tick", 250*time.Millisecond, "actor timer tick")
	addr         = flag.String("addr", ":8080", "http listen")
	udpPort      = flag.Int("udp", 7882, "ICE UDP mux port")
	publicIP     = flag.String("ip", "", "host candidate IP override")
)

type sock struct {
	conn *websocket.Conn
	out  chan []byte
	gen  int
}

type part struct {
	pid, secret, name string
	st                state
	gen               int
	sock              *sock
	pc                *webrtc.PeerConnection
	lastFrame, lastHB time.Time
	suspectAt         time.Time
	connectAt         time.Time
	reason            string
	unhealthy         time.Time
}

type event struct {
	kind   string // join, resume, frame, hb, sockclose, ice, leave, tick
	pid    string
	gen    int
	sock   *sock
	secret string
	name   string
	ice    webrtc.ICEConnectionState
	reply  chan resumeResult
	pc     *webrtc.PeerConnection
}
type resumeResult struct {
	ok       bool
	pid, sec string
	gen      int
}

type rosterEntry struct {
	Pid   string `json:"pid"`
	Name  string `json:"name"`
	State state  `json:"state"`
}

type room struct {
	name  string
	inbox chan event
	parts map[string]*part
	rv    int
	next  int
	api   *webrtc.API
}

var (
	roomsMu   sync.Mutex
	rooms     = map[string]*room{}
	inboxFull atomic.Int64
	rtpIn     atomic.Int64
	api       *webrtc.API
)

func jl(kind string, kv ...any) {
	m := map[string]any{"ts": time.Now().UnixNano(), "k": kind}
	for i := 0; i+1 < len(kv); i += 2 {
		m[kv[i].(string)] = kv[i+1]
	}
	b, _ := json.Marshal(m)
	fmt.Println(string(b))
}

func getRoom(n string) *room {
	roomsMu.Lock()
	defer roomsMu.Unlock()
	r := rooms[n]
	if r == nil {
		r = &room{name: n, inbox: make(chan event, 1024), parts: map[string]*part{}}
		rooms[n] = r
		go r.run()
	}
	return r
}

func (r *room) post(e event) {
	select {
	case r.inbox <- e:
	default:
		inboxFull.Add(1)
		jl("inbox_full", "room", r.name)
	}
}

func rnd() string { b := make([]byte, 12); rand.Read(b); return hex.EncodeToString(b) }

func (r *room) roster() []rosterEntry {
	var l []rosterEntry
	for i := 1; i <= r.next; i++ {
		p := r.parts[fmt.Sprintf("p%d", i)]
		if p != nil && p.st != stRemoved {
			l = append(l, rosterEntry{p.pid, p.name, p.st})
		}
	}
	return l
}

func (r *room) broadcast(why string) {
	r.rv++
	b, _ := json.Marshal(map[string]any{"t": "roster", "rv": r.rv, "roster": r.roster()})
	for _, p := range r.parts {
		if p.st != stRemoved && p.sock != nil {
			select {
			case p.sock.out <- b:
			default:
			}
		}
	}
	jl("roster", "room", r.name, "rv", r.rv, "why", why, "n", len(r.roster()))
}

func (r *room) setState(p *part, to state, why string) {
	if p.st == to || p.st == stRemoved {
		return
	}
	jl("state", "room", r.name, "pid", p.pid, "from", string(p.st), "to", string(to), "why", why, "gen", p.gen)
	p.st = to
	if to == stSuspect {
		p.suspectAt = time.Now()
		if p.unhealthy.IsZero() {
			p.unhealthy = p.suspectAt
		}
	}
	if to == stActive {
		p.unhealthy = time.Time{}
	}
	if to == stRemoved {
		p.reason = why
		if p.pc != nil {
			go p.pc.Close()
		}
		if p.sock != nil {
			s := p.sock
			go s.conn.Close(websocket.StatusCode(4000), "removed")
		}
	}
	r.broadcast(string(to) + ":" + p.pid + ":" + why)
}

func (r *room) run() {
	t := time.NewTicker(*tickEvery)
	defer t.Stop()
	go func() {
		for range t.C {
			r.post(event{kind: "tick"})
		}
	}()
	for e := range r.inbox {
		now := time.Now()
		switch e.kind {
		case "join":
			r.next++
			p := &part{pid: fmt.Sprintf("p%d", r.next), secret: rnd(), name: e.name, st: stConnecting, gen: 1,
				sock: e.sock, lastFrame: now, lastHB: now, connectAt: now}
			e.sock.gen = 1
			r.parts[p.pid] = p
			e.reply <- resumeResult{true, p.pid, p.secret, 1}
			sendJoined(e.sock, p)
			r.broadcast("join:" + p.pid)
		case "resume":
			p := r.parts[e.pid]
			if p == nil || p.st == stRemoved || p.secret != e.secret {
				e.reply <- resumeResult{ok: false}
				continue
			}
			old := p.sock
			p.gen++
			p.secret = rnd()
			p.sock = e.sock
			e.sock.gen = p.gen
			if old != nil {
				go old.conn.Close(websocket.StatusCode(4001), "superseded")
			}
			if p.pc != nil {
				go p.pc.Close()
				p.pc = nil
			}
			p.lastFrame, p.lastHB, p.connectAt = now, now, now
			jl("resume", "room", r.name, "pid", p.pid, "gen", p.gen, "from", string(p.st))
			p.st = stConnecting // via setState-free path to keep one broadcast below
			e.reply <- resumeResult{true, p.pid, p.secret, p.gen}
			sendJoined(e.sock, p)
			r.broadcast("resume:" + p.pid)
		case "frame", "hb":
			if p := r.parts[e.pid]; p != nil && p.gen == e.gen {
				p.lastFrame = now
				if e.kind == "hb" {
					p.lastHB = now
				}
			}
		case "sockclose":
			if p := r.parts[e.pid]; p != nil && p.gen == e.gen && p.st != stRemoved {
				if p.st == stActive || p.st == stConnecting {
					r.setState(p, stSuspect, "socket-close")
				}
			}
		case "ice":
			p := r.parts[e.pid]
			if p == nil || p.gen != e.gen {
				continue // stale (gen)
			}
			switch e.ice {
			case webrtc.ICEConnectionStateConnected, webrtc.ICEConnectionStateCompleted:
				if p.st == stConnecting {
					p.lastFrame, p.lastHB = now, now
					r.setState(p, stActive, "ice-connected")
				}
			case webrtc.ICEConnectionStateFailed:
				if p.st == stActive || p.st == stConnecting {
					r.setState(p, stSuspect, "ice-failed")
				}
			}
		case "attachpc":
			if p := r.parts[e.pid]; p != nil && p.gen == e.gen && p.st != stRemoved {
				p.pc = e.pc
			} else {
				go e.pc.Close()
			}
		case "leave":
			if p := r.parts[e.pid]; p != nil && p.gen == e.gen {
				r.setState(p, stRemoved, "leave")
			}
		case "tick":
			for _, p := range r.parts {
				if *capLimit > 0 && (p.st == stSuspect || p.st == stConnecting) && !p.unhealthy.IsZero() && now.Sub(p.unhealthy) >= *capLimit {
					r.setState(p, stRemoved, "unhealthy-cap")
					continue
				}
				switch p.st {
				case stActive:
					if now.Sub(p.lastFrame) > *noFrameLimit {
						r.setState(p, stSuspect, "no-frame")
					} else if now.Sub(p.lastHB) > *noHBLimit {
						r.setState(p, stSuspect, "no-hb")
					}
				case stConnecting:
					if now.Sub(p.connectAt) > *connectLimit {
						r.setState(p, stRemoved, "media-timeout")
					}
				case stSuspect:
					if now.Sub(p.suspectAt) >= *graceLimit {
						r.setState(p, stRemoved, "timeout")
					}
				}
			}
		}
	}
}

func sendJoined(s *sock, p *part) {
	b, _ := json.Marshal(map[string]any{"t": "joined", "pid": p.pid, "secret": p.secret, "gen": p.gen})
	s.out <- b
}

func writer(ctx context.Context, s *sock) {
	for {
		select {
		case b := <-s.out:
			wctx, c := context.WithTimeout(ctx, 5*time.Second)
			err := s.conn.Write(wctx, websocket.MessageText, b)
			c()
			if err != nil {
				return
			}
		case <-ctx.Done():
			return
		}
	}
}

func handleWS(w http.ResponseWriter, req *http.Request) {
	c, err := websocket.Accept(w, req, &websocket.AcceptOptions{Subprotocols: []string{"lv.1"}})
	if err != nil {
		return
	}
	c.SetReadLimit(16 << 10)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s := &sock{conn: c, out: make(chan []byte, 64)}
	rm := getRoom(req.URL.Query().Get("room"))
	// AUTH: 5 s for the first message
	fctx, fc := context.WithTimeout(ctx, 5*time.Second)
	_, data, err := c.Read(fctx)
	fc()
	if err != nil {
		c.Close(4401, "auth timeout")
		return
	}
	var m map[string]any
	json.Unmarshal(data, &m)
	reply := make(chan resumeResult, 1)
	switch m["t"] {
	case "join":
		n, _ := m["name"].(string)
		rm.post(event{kind: "join", sock: s, name: n, reply: reply})
	case "resume":
		pid, _ := m["pid"].(string)
		sec, _ := m["secret"].(string)
		rm.post(event{kind: "resume", pid: pid, secret: sec, sock: s, reply: reply})
	default:
		c.Close(4403, "forbidden")
		return
	}
	var rr resumeResult
	select {
	case rr = <-reply:
	case <-time.After(5 * time.Second):
		c.Close(4429, "busy")
		return
	}
	if !rr.ok {
		c.Close(4404, "gone")
		return
	}
	pid, gen := rr.pid, rr.gen
	go writer(ctx, s)
	// server Ping every pingEvery; the pong counts as a frame
	go func() {
		t := time.NewTicker(*pingEvery)
		defer t.Stop()
		for {
			select {
			case <-t.C:
				pctx, pc := context.WithTimeout(ctx, *pingEvery)
				if err := c.Ping(pctx); err == nil {
					rm.post(event{kind: "frame", pid: pid, gen: gen})
				}
				pc()
			case <-ctx.Done():
				return
			}
		}
	}()
	for {
		_, data, err := c.Read(ctx)
		if err != nil {
			rm.post(event{kind: "sockclose", pid: pid, gen: gen})
			return
		}
		var m struct {
			T   string `json:"t"`
			SDP string `json:"sdp"`
		}
		if json.Unmarshal(data, &m) != nil {
			continue
		}
		switch m.T {
		case "hb":
			rm.post(event{kind: "hb", pid: pid, gen: gen})
		case "leave":
			rm.post(event{kind: "leave", pid: pid, gen: gen})
		case "offer":
			rm.post(event{kind: "frame", pid: pid, gen: gen})
			go answer(rm, s, pid, gen, m.SDP)
		default:
			rm.post(event{kind: "frame", pid: pid, gen: gen})
		}
	}
}

func answer(rm *room, s *sock, pid string, gen int, sdp string) {
	pc, err := api.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		jl("pc_err", "err", err.Error())
		return
	}
	pc.OnICEConnectionStateChange(func(st webrtc.ICEConnectionState) {
		jl("ice", "pid", pid, "gen", gen, "st", st.String())
		rm.post(event{kind: "ice", pid: pid, gen: gen, ice: st})
	})
	pc.OnTrack(func(tr *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		for {
			if _, _, err := tr.ReadRTP(); err != nil {
				return
			}
			rtpIn.Add(1)
		}
	})
	if err := pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: sdp}); err != nil {
		jl("pc_err", "err", err.Error())
		return
	}
	ans, _ := pc.CreateAnswer(nil)
	gc := webrtc.GatheringCompletePromise(pc)
	pc.SetLocalDescription(ans)
	<-gc
	rm.post(event{kind: "attachpc", pid: pid, gen: gen, pc: pc})
	b, _ := json.Marshal(map[string]any{"t": "answer", "sdp": pc.LocalDescription().SDP})
	select {
	case s.out <- b:
	default:
	}
}

func main() {
	flag.Parse()
	se := webrtc.SettingEngine{}
	se.SetICETimeouts(4*time.Second, 4*time.Second, time.Second)
	uc, err := net.ListenUDP("udp", &net.UDPAddr{Port: *udpPort})
	if err != nil {
		log.Fatal(err)
	}
	se.SetICEUDPMux(webrtc.NewICEUDPMux(nil, uc))
	if *publicIP != "" {
		se.SetNAT1To1IPs([]string{*publicIP}, webrtc.ICECandidateTypeHost)
	}
	api = webrtc.NewAPI(webrtc.WithSettingEngine(se))
	http.HandleFunc("/ws", handleWS)
	http.HandleFunc("/stats", func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprintf(w, "rtp_in=%d inbox_full=%d\n", rtpIn.Load(), inboxFull.Load())
	})
	jl("listen", "addr", *addr, "udp", *udpPort)
	log.New(os.Stderr, "", 0).Fatal(http.ListenAndServe(*addr, nil))
}
