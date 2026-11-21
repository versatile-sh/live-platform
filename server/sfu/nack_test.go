package sfu

import (
	"sync"
	"testing"
	"time"

	"github.com/pion/interceptor"
	"github.com/pion/rtcp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func packet(seq uint16) []byte {
	return []byte{0x80, 96, byte(seq >> 8), byte(seq), 0, 0, 0, 1, 0, 0, 0, 9, 0xaa}
}

func TestLossLog(t *testing.T) {
	t.Run("what has not arrived since the last run of consecutive packets is missing, and stops being so once it arrives", func(t *testing.T) {
		var log lossLog
		for _, seq := range []uint16{10, 11, 13, 16, 17} {
			log.add(seq)
		}
		assert.Equal(t, []uint16{12, 14, 15}, log.missing(nil))
		log.add(12)
		log.add(14)
		assert.Equal(t, []uint16{15}, log.missing(nil))
		log.add(15)
		assert.Empty(t, log.missing(nil))
	})

	t.Run("sequence numbers wrap, and a jump past the window gives up on what fell out of it", func(t *testing.T) {
		var log lossLog
		log.add(65534)
		log.add(1)
		assert.Equal(t, []uint16{65535, 0}, log.missing(nil))
		log.add(1 + lossWindow + 10)
		assert.Len(t, log.missing(nil), lossWindow-1)
	})

	t.Run("lost packets are packed into NACK pairs of a first one and the sixteen after it", func(t *testing.T) {
		assert.Equal(t, []rtcp.NackPair{{PacketID: 12, LostPackets: 0b110}, {PacketID: 40}}, pairs(nil, []uint16{12, 14, 15, 40}))
		assert.Equal(t, []rtcp.NackPair{{PacketID: 1, LostPackets: 1 << 15}, {PacketID: 18}}, pairs(nil, []uint16{1, 17, 18}))
	})
}

func TestLossTracker(t *testing.T) {
	made, err := lossFactory{}.NewInterceptor("")
	require.NoError(t, err)
	tracker := made.(*lossTracker)
	t.Cleanup(func() { _ = tracker.Close() })
	var next []byte
	reader := tracker.BindRemoteStream(video(7, 96), interceptor.RTPReaderFunc(func(b []byte, a interceptor.Attributes) (int, interceptor.Attributes, error) {
		return copy(b, next), a, nil
	}))
	var mu sync.Mutex
	var asked []*rtcp.TransportLayerNack
	tracker.BindRTCPWriter(interceptor.RTCPWriterFunc(func(packets []rtcp.Packet, _ interceptor.Attributes) (int, error) {
		mu.Lock()
		defer mu.Unlock()
		for _, p := range packets {
			raw, _ := p.Marshal()
			var copied rtcp.TransportLayerNack
			_ = copied.Unmarshal(raw)
			asked = append(asked, &copied)
		}
		return 0, nil
	}))
	buf := make([]byte, 1500)
	read := func(seq uint16) interceptor.Attributes {
		next = packet(seq)
		_, attr, err := reader.Read(buf, nil)
		require.NoError(t, err)
		return attr
	}

	t.Run("the interceptors after it get the packet's header parsed once", func(t *testing.T) {
		attr := read(100)
		header, err := attr.GetRTPHeader(buf)
		require.NoError(t, err)
		assert.Equal(t, uint16(100), header.SequenceNumber)
		assert.Equal(t, uint32(9), header.SSRC)
	})

	t.Run("a gap is asked for again from the publisher", func(t *testing.T) {
		read(101)
		read(104)
		require.Eventually(t, func() bool {
			mu.Lock()
			defer mu.Unlock()
			return len(asked) > 0
		}, time.Second, 10*time.Millisecond)
		mu.Lock()
		defer mu.Unlock()
		assert.Equal(t, uint32(7), asked[0].MediaSSRC)
		assert.Equal(t, []rtcp.NackPair{{PacketID: 102, LostPackets: 1}}, asked[0].Nacks)
	})

	t.Run("a connection that receives nothing taking NACKs never starts asking", func(t *testing.T) {
		quiet, _ := lossFactory{}.NewInterceptor("")
		idle := quiet.(*lossTracker)
		idle.BindRTCPWriter(interceptor.RTCPWriterFunc(func([]rtcp.Packet, interceptor.Attributes) (int, error) { return 0, nil }))
		idle.BindRemoteStream(&interceptor.StreamInfo{SSRC: 3}, interceptor.RTPReaderFunc(func(b []byte, a interceptor.Attributes) (int, interceptor.Attributes, error) { return 0, a, nil }))
		idle.mu.Lock()
		running := idle.running
		idle.mu.Unlock()
		assert.False(t, running)
		require.NoError(t, idle.Close())
	})

	t.Run("reading a packet allocates nothing", func(t *testing.T) {
		seq := uint16(200)
		next = packet(seq)
		assert.Zero(t, testing.AllocsPerRun(500, func() {
			seq++
			next[2], next[3] = byte(seq>>8), byte(seq)
			attr := func() interceptor.Attributes { _, a, _ := reader.Read(buf, nil); return a }()
			_, _ = attr.GetRTPHeader(buf)
		}))
	})
}
