package sfu

import (
	"testing"
	"time"

	"github.com/pion/interceptor"
	"github.com/pion/rtcp"
	"github.com/pion/rtp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type sentPacket struct {
	ssrc        uint32
	payloadType uint8
	seq         uint16
	payload     string
}

func video(ssrc uint32, payloadType uint8) *interceptor.StreamInfo {
	return &interceptor.StreamInfo{SSRC: ssrc, PayloadType: payloadType, RTCPFeedback: []interceptor.RTCPFeedback{{Type: "nack"}, {Type: "nack", Parameter: "pli"}}}
}

func subscriber(t *testing.T, shared *histories, info *interceptor.StreamInfo) (interceptor.RTPWriter, func([]byte), *[]sentPacket) {
	t.Helper()
	made, err := retransmitFactory{shared: shared}.NewInterceptor("")
	require.NoError(t, err)
	r := made.(*retransmitter)
	var sent []sentPacket
	writer := r.BindLocalStream(info, interceptor.RTPWriterFunc(func(header *rtp.Header, payload []byte, _ interceptor.Attributes) (int, error) {
		sent = append(sent, sentPacket{header.SSRC, header.PayloadType, header.SequenceNumber, string(payload)})
		return len(payload), nil
	}))
	var incoming []byte
	reader := r.BindRTCPReader(interceptor.RTCPReaderFunc(func(b []byte, a interceptor.Attributes) (int, interceptor.Attributes, error) {
		return copy(b, incoming), a, nil
	}))
	feed := func(raw []byte) {
		incoming = raw
		buf := make([]byte, 1500)
		_, _, err := reader.Read(buf, nil)
		require.NoError(t, err)
	}
	return writer, feed, &sent
}

func nackFor(ssrc uint32, seqs ...uint16) []byte {
	raw, _ := (&rtcp.TransportLayerNack{MediaSSRC: ssrc, Nacks: rtcp.NackPairsFromSequenceNumbers(seqs)}).Marshal()
	return raw
}

func TestRetransmitter(t *testing.T) {
	shared := newHistories()
	past := newHistory()
	shared.route(111, past)
	shared.route(222, past)
	ana, anaRTCP, anaSent := subscriber(t, shared, video(111, 96))
	bia, biaRTCP, biaSent := subscriber(t, shared, video(222, 98))
	for seq := uint16(10); seq < 20; seq++ {
		payload := []byte{byte(seq), 0xaa}
		_, _ = ana.Write(&rtp.Header{Version: 2, SequenceNumber: seq, Timestamp: uint32(seq), SSRC: 111, PayloadType: 96}, payload, nil)
		_, _ = bia.Write(&rtp.Header{Version: 2, SequenceNumber: seq, Timestamp: uint32(seq), SSRC: 222, PayloadType: 98}, payload, nil)
	}
	*anaSent, *biaSent = nil, nil

	t.Run("a NACK is answered with the packets asked for, under the asking subscriber's SSRC and payload type", func(t *testing.T) {
		biaRTCP(nackFor(222, 12, 15))
		assert.Equal(t, []sentPacket{{222, 98, 12, "\x0c\xaa"}, {222, 98, 15, "\x0f\xaa"}}, *biaSent)
		assert.Empty(t, *anaSent)
	})

	t.Run("the same packet asked for again at once is not sent twice, and one no longer kept is skipped", func(t *testing.T) {
		*biaSent = nil
		biaRTCP(nackFor(222, 12, 3))
		assert.Empty(t, *biaSent)
	})

	t.Run("each packet is kept once for every subscriber, and the history wraps", func(t *testing.T) {
		kept := 0
		for i := range past.slots {
			if past.slots[i].full {
				kept++
			}
		}
		assert.Equal(t, 10, kept)
		for seq := uint16(20); seq < 20+historyFewest; seq++ {
			_, _ = ana.Write(&rtp.Header{Version: 2, SequenceNumber: seq, SSRC: 111, PayloadType: 96}, []byte{1}, nil)
		}
		*anaSent = nil
		anaRTCP(nackFor(111, 19, 20+historyFewest-1))
		assert.Equal(t, []sentPacket{{111, 96, 20 + historyFewest - 1, "\x01"}}, *anaSent)
	})

	t.Run("RTCP without a NACK passes unparsed, and keeping and resending allocate nothing once warm", func(t *testing.T) {
		report, _ := (&rtcp.ReceiverReport{SSRC: 1}).Marshal()
		pli, _ := (&rtcp.PictureLossIndication{MediaSSRC: 111}).Marshal()
		assert.False(t, hasNack(report))
		assert.False(t, hasNack(pli))
		assert.True(t, hasNack(append(append([]byte{}, report...), nackFor(111, 1)...)))
		header := &rtp.Header{Version: 2, SequenceNumber: 30, SSRC: 111, PayloadType: 96}
		payload := make([]byte, 1000)
		assert.Zero(t, testing.AllocsPerRun(200, func() {
			header.SequenceNumber++
			past.put(header, payload)
		}))
		assert.Zero(t, testing.AllocsPerRun(200, func() { hasNack(report) }))
	})

	t.Run("with a retransmission stream negotiated, a packet is sent again on it with its original sequence number in front", func(t *testing.T) {
		info := video(333, 96)
		info.SSRCRetransmission, info.PayloadTypeRetransmission = 334, 97
		shared.route(333, past)
		caio, caioRTCP, caioSent := subscriber(t, shared, info)
		_, _ = caio.Write(&rtp.Header{Version: 2, SequenceNumber: 500, SSRC: 333, PayloadType: 96}, []byte{0x42}, nil)
		*caioSent = nil
		caioRTCP(nackFor(333, 500))
		assert.Equal(t, []sentPacket{{334, 97, 1, "\x01\xf4\x42"}}, *caioSent)
	})

	t.Run("an SSRC two connections drew is given no history", func(t *testing.T) {
		clash := newHistories()
		clash.route(5, past)
		clash.route(5, newHistory())
		assert.Nil(t, clash.find(5))
		clash.unroute(5)
		clash.unroute(5)
		clash.route(5, past)
		assert.Same(t, past, clash.find(5))
	})

	t.Run("an audio stream, or one without NACK, is passed through and kept nowhere", func(t *testing.T) {
		made, _ := retransmitFactory{shared: shared}.NewInterceptor("")
		plain := interceptor.RTPWriterFunc(func(*rtp.Header, []byte, interceptor.Attributes) (int, error) { return 0, nil })
		info := &interceptor.StreamInfo{ID: "microphone", SSRC: 9}
		assert.NotNil(t, made.BindLocalStream(info, plain))
		assert.Empty(t, made.(*retransmitter).bySSRC)
	})
}

func TestHistoryGrowsWithTheRate(t *testing.T) {
	put := func(h *history, seq uint16) {
		h.put(&rtp.Header{Version: 2, SequenceNumber: seq, SSRC: 1, PayloadType: 96}, []byte{byte(seq)})
	}
	start := time.Unix(100, 0)

	t.Run("a stream sent slowly keeps the fewest slots", func(t *testing.T) {
		h := newHistory()
		h.resize(start)
		h.count = 150
		h.resize(start.Add(time.Second))
		assert.Len(t, h.slots, historyFewest)
	})

	t.Run("a fast stream grows to cover half a second, keeping what it had, and never past the most", func(t *testing.T) {
		h := newHistory()
		for seq := uint16(1); seq <= 100; seq++ {
			put(h, seq)
		}
		h.since, h.count = start, 900
		h.resize(start.Add(time.Second))
		assert.Len(t, h.slots, 512)
		for _, seq := range []uint16{1, 50, 100} {
			raw, ok := h.copyOut(seq, nil)
			require.True(t, ok, seq)
			assert.Equal(t, byte(seq), raw[len(raw)-1])
		}
		h.since, h.count = start, 100_000
		h.resize(start.Add(time.Second))
		assert.Len(t, h.slots, historyMost)
	})

	t.Run("a padded packet, a bandwidth probe, is not kept to be sent again", func(t *testing.T) {
		h := newHistory()
		h.put(&rtp.Header{Version: 2, SequenceNumber: 5, SSRC: 1, Padding: true, PaddingSize: 200}, []byte{1})
		_, ok := h.copyOut(5, nil)
		assert.False(t, ok)
	})

	t.Run("keeping a packet allocates nothing once its slot has a buffer", func(t *testing.T) {
		h := newHistory()
		header := &rtp.Header{Version: 2, SSRC: 1, PayloadType: 96}
		payload := make([]byte, 1000)
		for seq := range uint16(historyFewest) {
			header.SequenceNumber = seq
			h.put(header, payload)
		}
		assert.Zero(t, testing.AllocsPerRun(500, func() {
			header.SequenceNumber++
			h.put(header, payload)
		}))
	})
}
