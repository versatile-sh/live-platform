package sfu

import (
	"encoding/binary"
	"sync"
	"time"

	"github.com/pion/interceptor"
	"github.com/pion/rtcp"
	"github.com/pion/rtp"
)

// retransmitPackets is how many sent packets each forwarded video stream keeps for retransmission, once for all its subscribers; 256 still covers more than half a second of a 4 Mbps screen.
const retransmitPackets = 256

// resendGap is the least time between two resends of one packet to one subscriber, so a NACK repeated before the first resend lands is not answered twice.
const resendGap = 100 * time.Millisecond

// history is the last packets of one forwarded stream, kept once however many subscribers it goes to.
type history struct {
	mu    sync.RWMutex
	slots [retransmitPackets]slot
}

type slot struct {
	seq  uint16
	full bool
	raw  []byte
}

// put keeps a packet unless it is already kept: every subscriber writes the same packets, and the first one to write stores it.
func (h *history) put(header *rtp.Header, payload []byte) {
	s := &h.slots[header.SequenceNumber%retransmitPackets]
	h.mu.RLock()
	kept := s.full && s.seq == header.SequenceNumber
	h.mu.RUnlock()
	if kept {
		return
	}
	size := header.MarshalSize() + len(payload)
	h.mu.Lock()
	if cap(s.raw) < size {
		s.raw = make([]byte, size, max(size, 1200))
	}
	s.raw = s.raw[:size]
	n, err := header.MarshalTo(s.raw)
	if err == nil {
		copy(s.raw[n:], payload)
	}
	s.seq, s.full = header.SequenceNumber, err == nil
	h.mu.Unlock()
}

// copyOut writes the packet kept under a sequence number into scratch, reporting whether it is still kept.
func (h *history) copyOut(seq uint16, scratch []byte) ([]byte, bool) {
	s := &h.slots[seq%retransmitPackets]
	h.mu.RLock()
	defer h.mu.RUnlock()
	if !s.full || s.seq != seq {
		return scratch, false
	}
	return append(scratch[:0], s.raw...), true
}

// histories finds the history a subscriber's stream is sent from by the SSRC the server sends it under.
// Two connections may draw the same SSRC: that SSRC is then given no history, so a resend can never carry another stream's packet.
type histories struct {
	mu     sync.Mutex
	bySSRC map[uint32]*history
	shared map[uint32]int
}

func newHistories() *histories {
	return &histories{bySSRC: map[uint32]*history{}, shared: map[uint32]int{}}
}

func (h *histories) route(ssrc uint32, past *history) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.shared[ssrc]++
	if h.shared[ssrc] == 1 {
		h.bySSRC[ssrc] = past
	} else {
		delete(h.bySSRC, ssrc)
	}
}

func (h *histories) unroute(ssrc uint32) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.shared[ssrc]--; h.shared[ssrc] <= 0 {
		delete(h.shared, ssrc)
		delete(h.bySSRC, ssrc)
	}
}

func (h *histories) find(ssrc uint32) *history {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.bySSRC[ssrc]
}

// retransmitter answers subscribers' NACKs from the shared histories; it takes the place of Pion's responder, which keeps a copy of every packet for every subscriber.
type retransmitter struct {
	interceptor.NoOp
	shared *histories
	mu     sync.Mutex
	bySSRC map[uint32]*outgoing
}

// outgoing is one forwarded stream to one subscriber.
type outgoing struct {
	past        *history
	writer      interceptor.RTPWriter
	ssrc        uint32
	payloadType uint8
	rtxSSRC     uint32
	rtxType     uint8
	mu          sync.Mutex
	scratch     []byte
	wrapped     []byte
	header      rtp.Header
	rtxSeq      uint16
	sent        [retransmitPackets]int64
}

// send writes a kept packet again: on the retransmission stream when one was negotiated (RFC 4588, the original sequence number first), otherwise on the stream itself.
func (o *outgoing) send(payload []byte) error {
	if o.rtxSSRC == 0 || o.rtxType == 0 {
		o.header.SSRC, o.header.PayloadType = o.ssrc, o.payloadType
		_, err := o.writer.Write(&o.header, payload, nil)
		return err
	}
	o.wrapped = binary.BigEndian.AppendUint16(o.wrapped[:0], o.header.SequenceNumber)
	o.wrapped = append(o.wrapped, payload...)
	o.rtxSeq++
	o.header.SSRC, o.header.PayloadType, o.header.SequenceNumber = o.rtxSSRC, o.rtxType, o.rtxSeq
	_, err := o.writer.Write(&o.header, o.wrapped, nil)
	return err
}

type retransmitFactory struct{ shared *histories }

// NewInterceptor gives each peer connection its own retransmitter over the engine's shared histories.
func (f retransmitFactory) NewInterceptor(string) (interceptor.Interceptor, error) {
	return &retransmitter{shared: f.shared, bySSRC: map[uint32]*outgoing{}}, nil
}

// BindLocalStream stores each packet of a forwarded video stream in its shared history on the way out.
func (r *retransmitter) BindLocalStream(info *interceptor.StreamInfo, writer interceptor.RTPWriter) interceptor.RTPWriter {
	past := r.shared.find(info.SSRC)
	if past == nil || !acceptsNack(info) {
		return writer
	}
	out := &outgoing{past: past, writer: writer, ssrc: info.SSRC, payloadType: info.PayloadType, rtxSSRC: info.SSRCRetransmission, rtxType: info.PayloadTypeRetransmission}
	r.mu.Lock()
	r.bySSRC[info.SSRC] = out
	r.mu.Unlock()
	return interceptor.RTPWriterFunc(func(header *rtp.Header, payload []byte, attributes interceptor.Attributes) (int, error) {
		if header.SSRC == info.SSRC {
			past.put(header, payload)
		}
		return writer.Write(header, payload, attributes)
	})
}

// UnbindLocalStream forgets a stream that is no longer sent.
func (r *retransmitter) UnbindLocalStream(info *interceptor.StreamInfo) {
	r.mu.Lock()
	delete(r.bySSRC, info.SSRC)
	r.mu.Unlock()
}

// BindRTCPReader resends what a subscriber's NACK asks for; RTCP without a NACK passes untouched and unparsed.
func (r *retransmitter) BindRTCPReader(reader interceptor.RTCPReader) interceptor.RTCPReader {
	return interceptor.RTCPReaderFunc(func(b []byte, a interceptor.Attributes) (int, interceptor.Attributes, error) {
		n, attr, err := reader.Read(b, a)
		if err != nil || !hasNack(b[:n]) {
			return n, attr, err
		}
		packets, parseErr := rtcp.Unmarshal(b[:n])
		if parseErr != nil {
			return n, attr, err
		}
		for _, packet := range packets {
			if nack, ok := packet.(*rtcp.TransportLayerNack); ok {
				r.resend(nack)
			}
		}
		return n, attr, err
	})
}

func (r *retransmitter) resend(nack *rtcp.TransportLayerNack) {
	r.mu.Lock()
	out := r.bySSRC[nack.MediaSSRC]
	r.mu.Unlock()

	if out == nil {
		return
	}
	now := time.Now().UnixNano()
	out.mu.Lock()
	defer out.mu.Unlock()
	for _, pair := range nack.Nacks {
		pair.Range(func(seq uint16) bool {
			at := &out.sent[seq%retransmitPackets]
			if now-*at < int64(resendGap) {
				return true
			}
			raw, ok := out.past.copyOut(seq, out.scratch)
			out.scratch = raw
			if !ok {
				return true
			}
			n, err := out.header.Unmarshal(raw)
			if err != nil {
				return true
			}
			if out.send(raw[n:]) == nil {
				*at = now
			}
			return true
		})
	}
}

func acceptsNack(info *interceptor.StreamInfo) bool {
	for _, feedback := range info.RTCPFeedback {
		if feedback.Type == "nack" && feedback.Parameter == "" {
			return true
		}
	}
	return false
}

// hasNack reports whether a compound RTCP packet holds a generic NACK, without allocating.
func hasNack(b []byte) bool {
	for len(b) >= 4 {
		if b[1] == 205 && b[0]&0x1f == 1 {
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
