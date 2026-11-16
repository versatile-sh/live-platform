// S1 stand-in client. Modes: participant (join, PeerConnection with a synthetic
// Opus RTP track, app hb every 4 s, resume logic) and observer (log every roster).
// SIGUSR1: stop the app hb (socket Pongs and media continue = frozen page).
// SIGUSR2: abruptly close the WebSocket, resume after -resume-delay.
// SIGTERM: clean leave.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/coder/websocket"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

var (
	server  = flag.String("server", "ws://127.0.0.1:8080/ws", "")
	roomN   = flag.String("room", "r", "")
	name    = flag.String("name", "c", "")
	mode    = flag.String("mode", "participant", "participant|observer")
	resumeD = flag.Duration("resume-delay", 0, "delay before resume after SIGUSR2")
	media   = flag.Bool("media", true, "")
	resumeW = flag.Duration("resume-window", 10500*time.Millisecond, "client resume retry window")
)

var freezeHB atomic.Bool

func jl(kind string, kv ...any) {
	m := map[string]any{"ts": time.Now().UnixNano(), "k": kind, "name": *name}
	for i := 0; i+1 < len(kv); i += 2 {
		m[kv[i].(string)] = kv[i+1]
	}
	b, _ := json.Marshal(m)
	fmt.Println(string(b))
}

type sess struct{ pid, secret string }

func dial(ctx context.Context) (*websocket.Conn, error) {
	dctx, c := context.WithTimeout(ctx, 4*time.Second)
	defer c()
	conn, _, err := websocket.Dial(dctx, *server+"?room="+*roomN, &websocket.DialOptions{Subprotocols: []string{"lv.1"}})
	if err == nil {
		conn.SetReadLimit(1 << 20)
	}
	return conn, err
}

func readMsg(ctx context.Context, c *websocket.Conn) (map[string]any, error) {
	_, d, err := c.Read(ctx)
	if err != nil {
		return nil, err
	}
	var m map[string]any
	json.Unmarshal(d, &m)
	return m, nil
}

var errGone = errors.New("gone")
var errClean = errors.New("clean")

// run one connection generation; est reports whether the join/resume was accepted
func run(ctx context.Context, s *sess, usr2 chan struct{}, term chan struct{}) (est bool, err error) {
	c, err := dial(ctx)
	if err != nil {
		return false, err
	}
	defer c.CloseNow()
	var first []byte
	if s.pid == "" {
		first, _ = json.Marshal(map[string]any{"t": "join", "name": *name})
	} else {
		first, _ = json.Marshal(map[string]any{"t": "resume", "pid": s.pid, "secret": s.secret})
	}
	if err := c.Write(ctx, websocket.MessageText, first); err != nil {
		return false, err
	}
	rctx, cancel := context.WithCancel(ctx)
	defer cancel()
	m, err := readMsg(rctx, c)
	if err != nil {
		if websocket.CloseStatus(err) == 4404 {
			return false, errGone
		}
		return false, err
	}
	s.pid, _ = m["pid"].(string)
	s.secret, _ = m["secret"].(string)
	jl("joined", "pid", s.pid, "gen", m["gen"])
	lost := make(chan error, 4)
	var pc *webrtc.PeerConnection
	if *mode == "participant" && *media {
		se := webrtc.SettingEngine{}
		se.SetICETimeouts(4*time.Second, 4*time.Second, time.Second)
		api := webrtc.NewAPI(webrtc.WithSettingEngine(se))
		pc, err = api.NewPeerConnection(webrtc.Configuration{})
		if err != nil {
			return true, err
		}
		defer pc.Close()
		tr, _ := webrtc.NewTrackLocalStaticRTP(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeOpus}, "audio", "s")
		pc.AddTrack(tr)
		pc.OnICEConnectionStateChange(func(st webrtc.ICEConnectionState) {
			jl("ice", "st", st.String())
			if st == webrtc.ICEConnectionStateFailed {
				lost <- errors.New("ice-failed")
			}
		})
		off, _ := pc.CreateOffer(nil)
		gc := webrtc.GatheringCompletePromise(pc)
		pc.SetLocalDescription(off)
		<-gc
		b, _ := json.Marshal(map[string]any{"t": "offer", "sdp": pc.LocalDescription().SDP})
		c.Write(ctx, websocket.MessageText, b)
		go func() { // synthetic 50 pkt/s Opus-like stream
			t := time.NewTicker(20 * time.Millisecond)
			defer t.Stop()
			var seq uint16
			var ts uint32
			pl := make([]byte, 80)
			for {
				select {
				case <-t.C:
					seq++
					ts += 960
					tr.WriteRTP(&rtp.Packet{Header: rtp.Header{Version: 2, PayloadType: 111, SequenceNumber: seq, Timestamp: ts, SSRC: 1234}, Payload: pl})
				case <-rctx.Done():
					return
				}
			}
		}()
	}
	go func() { // reader; also answers server pings
		for {
			m, err := readMsg(rctx, c)
			if err != nil {
				lost <- fmt.Errorf("read: %w", err)
				return
			}
			switch m["t"] {
			case "roster":
				b, _ := json.Marshal(m)
				fmt.Printf("{\"ts\":%d,\"k\":\"roster_rx\",\"name\":%q,\"msg\":%s}\n", time.Now().UnixNano(), *name, b)
			case "answer":
				if pc != nil {
					sdp, _ := m["sdp"].(string)
					pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: sdp})
				}
			}
		}
	}()
	hb := time.NewTicker(4 * time.Second)
	defer hb.Stop()
	for {
		select {
		case <-hb.C:
			if *mode == "participant" && !freezeHB.Load() {
				if err := c.Write(ctx, websocket.MessageText, []byte(`{"t":"hb"}`)); err != nil {
					return true, err
				}
			}
		case err := <-lost:
			return true, err
		case <-usr2:
			jl("usr2_close_ws")
			c.CloseNow()
			return true, errors.New("usr2")
		case <-term:
			c.Write(ctx, websocket.MessageText, []byte(`{"t":"leave"}`))
			c.Close(websocket.StatusNormalClosure, "bye")
			return true, errClean
		case <-ctx.Done():
			return true, ctx.Err()
		}
	}
}

func main() {
	flag.Parse()
	ctx := context.Background()
	usr1 := make(chan os.Signal, 1)
	usr2s := make(chan os.Signal, 1)
	terms := make(chan os.Signal, 1)
	signal.Notify(usr1, syscall.SIGUSR1)
	signal.Notify(usr2s, syscall.SIGUSR2)
	signal.Notify(terms, syscall.SIGTERM, syscall.SIGINT)
	usr2 := make(chan struct{}, 1)
	term := make(chan struct{}, 1)
	go func() {
		for {
			select {
			case <-usr1:
				freezeHB.Store(true)
				jl("hb_frozen")
			case <-usr2s:
				usr2 <- struct{}{}
			case <-terms:
				term <- struct{}{}
			}
		}
	}()
	s := &sess{}
	var lostAt time.Time
	for {
		est, err := run(ctx, s, usr2, term)
		if errors.Is(err, errClean) {
			jl("clean_exit")
			return
		}
		if errors.Is(err, errGone) {
			jl("rejoin_prompt")
			return
		}
		jl("lost", "err", fmt.Sprint(err), "est", est)
		if s.pid == "" {
			time.Sleep(time.Second)
			continue
		}
		if est || lostAt.IsZero() {
			lostAt = time.Now()
		}
		if err != nil && err.Error() == "usr2" {
			time.Sleep(*resumeD)
		} else if time.Since(lostAt) > *resumeW {
			jl("giveup_rejoin_prompt")
			return
		} else {
			time.Sleep(time.Second)
		}
	}
}
