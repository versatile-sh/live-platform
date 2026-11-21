package sfu

import (
	"crypto/rand"
	"encoding/binary"
	"sync"
	"time"

	"github.com/pion/interceptor"
	"github.com/pion/rtcp"
	"github.com/pion/rtp"
)

const (
	lossWindow = 512
	nackEvery  = 100 * time.Millisecond
)

// headerKey is the key Pion's interceptors cache a parsed RTP header under; it is unexported, so it is read off an attributes map once.
var headerKey = func() any {
	probe := interceptor.Attributes{}
	if _, err := probe.GetRTPHeader([]byte{0x80, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1}); err != nil {
		return nil
	}
	for key := range probe {
		return key
	}
	return nil
}()

// lossLog remembers which of the last lossWindow sequence numbers of one received stream arrived, as Pion's receive log does, in a fixed array.
type lossLog struct {
	mu          sync.Mutex
	seen        [lossWindow / 64]uint64
	end         uint16
	started     bool
	consecutive uint16
	attrs       interceptor.Attributes
	header      rtp.Header
}

func (l *lossLog) set(seq uint16)      { p := seq % lossWindow; l.seen[p/64] |= 1 << (p % 64) }
func (l *lossLog) unset(seq uint16)    { p := seq % lossWindow; l.seen[p/64] &^= 1 << (p % 64) }
func (l *lossLog) has(seq uint16) bool { p := seq % lossWindow; return l.seen[p/64]&(1<<(p%64)) != 0 }

func (l *lossLog) add(seq uint16) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if !l.started {
		l.set(seq)
		l.end, l.consecutive, l.started = seq, seq, true
		return
	}
	switch diff := seq - l.end; {
	case diff == 0:
		return
	case diff < 1<<15:
		for i := l.end + 1; i != seq; i++ {
			l.unset(i)
		}
		l.end = seq
		if l.consecutive+1 == seq {
			l.consecutive = seq
		} else if seq-l.consecutive > lossWindow {
			l.consecutive = seq - lossWindow
			l.advance()
		}
	case l.consecutive+1 == seq:
		l.consecutive = seq
		l.advance()
	}
	l.set(seq)
}

func (l *lossLog) advance() {
	i := l.consecutive + 1
	for i != l.end+1 && l.has(i) {
		i++
	}
	l.consecutive = i - 1
}

// missing appends to out the sequence numbers not yet arrived since the last run of consecutive ones.
func (l *lossLog) missing(out []uint16) []uint16 {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.end-l.consecutive >= 1<<15 {
		return out
	}
	for i := l.consecutive + 1; i != l.end+1; i++ {
		if !l.has(i) {
			out = append(out, i)
		}
	}
	return out
}

// lossTracker asks publishers again for what did not arrive; it takes the place of Pion's NACK generator, which allocates an attributes map and a header for every packet received.
type lossTracker struct {
	interceptor.NoOp
	loop    *lossLoop
	ssrc    uint32
	mu      sync.Mutex
	streams map[uint32]*lossLog
	writer  interceptor.RTCPWriter
	joined  bool
	closed  bool
}

// lossLoop is the one goroutine that, every nackEvery, asks for what every connection's streams are missing; it runs only while some connection receives a stream that takes NACKs.
type lossLoop struct {
	mu       sync.Mutex
	trackers map[*lossTracker]struct{}
	running  bool
}

func (l *lossLoop) add(t *lossTracker) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.trackers[t] = struct{}{}
	if !l.running {
		l.running = true
		go l.run()
	}
}

func (l *lossLoop) remove(t *lossTracker) {
	l.mu.Lock()
	delete(l.trackers, t)
	l.mu.Unlock()
}

func (l *lossLoop) run() {
	ticker := time.NewTicker(nackEvery)
	defer ticker.Stop()
	nack := &rtcp.TransportLayerNack{}
	packets := []rtcp.Packet{nack}
	missing := make([]uint16, 0, lossWindow)
	var trackers []*lossTracker
	for range ticker.C {
		l.mu.Lock()
		if len(l.trackers) == 0 {
			l.running = false
			l.mu.Unlock()
			return
		}
		trackers = trackers[:0]
		for t := range l.trackers {
			trackers = append(trackers, t)
		}
		l.mu.Unlock()
		for _, t := range trackers {
			missing = t.ask(nack, packets, missing)
		}
		clear(trackers)
	}
}

// ask sends one NACK per stream of this connection that is missing packets, reusing the loop's scratch.
func (t *lossTracker) ask(nack *rtcp.TransportLayerNack, packets []rtcp.Packet, missing []uint16) []uint16 {
	t.mu.Lock()
	writer := t.writer
	t.mu.Unlock()
	if writer == nil {
		return missing
	}
	nack.SenderSSRC = t.ssrc
	t.mu.Lock()
	defer t.mu.Unlock()
	for ssrc, log := range t.streams {
		missing = log.missing(missing[:0])
		if len(missing) == 0 {
			continue
		}
		nack.MediaSSRC = ssrc
		nack.Nacks = pairs(nack.Nacks[:0], missing)
		_, _ = writer.Write(packets, nil)
	}
	return missing
}

// join hands the tracker to the loop once it can write RTCP and receives a stream that takes NACKs, so a connection that only sends never costs a tick; it holds mu.
func (t *lossTracker) join() {
	if t.joined || t.closed || t.writer == nil || len(t.streams) == 0 {
		return
	}
	t.joined = true
	t.loop.add(t)
}

type lossFactory struct{ loop *lossLoop }

func newLossFactory() lossFactory {
	return lossFactory{loop: &lossLoop{trackers: map[*lossTracker]struct{}{}}}
}

// NewInterceptor gives each peer connection its own tracker, all asked for by the factory's one loop.
func (f lossFactory) NewInterceptor(string) (interceptor.Interceptor, error) {
	var ssrc [4]byte
	_, _ = rand.Read(ssrc[:])
	return &lossTracker{loop: f.loop, ssrc: binary.BigEndian.Uint32(ssrc[:]), streams: map[uint32]*lossLog{}}, nil
}

// BindRemoteStream notes each packet's sequence number and hands the interceptors after it one parsed header, kept per stream.
func (t *lossTracker) BindRemoteStream(info *interceptor.StreamInfo, reader interceptor.RTPReader) interceptor.RTPReader {
	if !acceptsNack(info) {
		return reader
	}
	log := &lossLog{attrs: interceptor.Attributes{}}
	t.mu.Lock()
	t.streams[info.SSRC] = log
	t.join()
	t.mu.Unlock()
	return interceptor.RTPReaderFunc(func(b []byte, a interceptor.Attributes) (int, interceptor.Attributes, error) {
		n, attr, err := reader.Read(b, a)
		if err != nil || n < 4 {
			return n, attr, err
		}
		log.add(binary.BigEndian.Uint16(b[2:4]))
		if attr != nil || headerKey == nil {
			return n, attr, err
		}
		if _, parseErr := log.header.Unmarshal(b[:n]); parseErr != nil {
			delete(log.attrs, headerKey)
		} else {
			log.attrs[headerKey] = &log.header
		}
		return n, log.attrs, err
	})
}

// UnbindRemoteStream forgets a stream no longer received, and leaves the loop with the last one.
func (t *lossTracker) UnbindRemoteStream(info *interceptor.StreamInfo) {
	t.mu.Lock()
	delete(t.streams, info.SSRC)
	leave := t.joined && len(t.streams) == 0
	if leave {
		t.joined = false
	}
	t.mu.Unlock()
	if leave {
		t.loop.remove(t)
	}
}

// BindRTCPWriter keeps the writer NACKs are sent on.
func (t *lossTracker) BindRTCPWriter(writer interceptor.RTCPWriter) interceptor.RTCPWriter {
	t.mu.Lock()
	if t.writer == nil {
		t.writer = writer
		t.join()
	}
	t.mu.Unlock()
	return writer
}

// Close leaves the loop for good.
func (t *lossTracker) Close() error {
	t.mu.Lock()
	t.closed, t.joined = true, false
	t.mu.Unlock()
	t.loop.remove(t)
	return nil
}

// pairs packs ascending sequence numbers into NACK pairs: a first lost packet and a bitmask of the sixteen after it.
func pairs(out []rtcp.NackPair, seqs []uint16) []rtcp.NackPair {
	for _, seq := range seqs {
		if len(out) > 0 {
			last := &out[len(out)-1]
			if gap := seq - last.PacketID; gap >= 1 && gap <= 16 {
				last.LostPackets |= 1 << (gap - 1)
				continue
			}
		}
		out = append(out, rtcp.NackPair{PacketID: seq})
	}
	return out
}
