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

	t.Run("a packet further behind than the window is ignored, not recorded over the one it aliases", func(t *testing.T) {
		var log lossLog
		for _, seq := range []uint16{1000, 1001, 1003} {
			log.add(seq)
		}
		log.add(1002 - lossWindow)
		assert.Equal(t, []uint16{1002}, log.missing(nil))
		log.add(1003 - lossWindow)
		assert.Equal(t, []uint16{1002}, log.missing(nil))
		log.add(1003 - lossWindow + 1)
		assert.Equal(t, []uint16{1002}, log.missing(nil))
	})

	t.Run("a jump far past the window clears it at once and tracks from the new sequence", func(t *testing.T) {
		var log lossLog
		for _, seq := range []uint16{100, 101, 103} {
			log.add(seq)
		}
		log.add(103 + 32000)
		assert.Equal(t, uint16(103+32000), log.end)
		assert.Len(t, log.missing(nil), lossWindow-1)
		assert.False(t, log.has(103+32000-1))
		log.add(103 + 32000 - 1)
		assert.Len(t, log.missing(nil), lossWindow-2)
	})

	t.Run("a jump of exactly the window length leaves nothing recorded from before it", func(t *testing.T) {
		var log lossLog
		log.add(1)
		log.add(1 + lossWindow)
		assert.False(t, log.has(1+lossWindow-1))
		assert.True(t, log.has(1+lossWindow))
	})

	t.Run("lost packets are packed into NACK pairs of a first one and the sixteen after it", func(t *testing.T) {
		assert.Equal(t, []rtcp.NackPair{{PacketID: 12, LostPackets: 0b110}, {PacketID: 40}}, pairs(nil, []uint16{12, 14, 15, 40}))
		assert.Equal(t, []rtcp.NackPair{{PacketID: 1, LostPackets: 1 << 15}, {PacketID: 18}}, pairs(nil, []uint16{1, 17, 18}))
	})
}

func TestLossTracker(t *testing.T) {
	made, err := newLossFactory().NewInterceptor("")
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

	t.Run("a packet whose header does not parse leaves nothing of the previous one", func(t *testing.T) {
		read(100)
		next = []byte{0x80, 96, 0, 101}
		_, attr, err := reader.Read(buf, nil)
		require.NoError(t, err)
		assert.NotContains(t, attr, headerKey)
		tracker.mu.Lock()
		log := tracker.streams[7]
		tracker.mu.Unlock()
		assert.Zero(t, log.header.SSRC)
		assert.Zero(t, log.header.SequenceNumber)
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
		quiet, _ := newLossFactory().NewInterceptor("")
		idle := quiet.(*lossTracker)
		idle.BindRTCPWriter(interceptor.RTCPWriterFunc(func([]rtcp.Packet, interceptor.Attributes) (int, error) { return 0, nil }))
		idle.BindRemoteStream(&interceptor.StreamInfo{SSRC: 3}, interceptor.RTPReaderFunc(func(b []byte, a interceptor.Attributes) (int, interceptor.Attributes, error) { return 0, a, nil }))
		idle.mu.Lock()
		joined := idle.joined
		idle.mu.Unlock()
		assert.False(t, joined)
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

func TestOneLossLoopForEveryConnection(t *testing.T) {
	factory := newLossFactory()
	var mu sync.Mutex
	asked := map[uint32]int{}
	buf := make([]byte, 1500)
	var trackers []*lossTracker
	for i := range 3 {
		made, err := factory.NewInterceptor("")
		require.NoError(t, err)
		tracker := made.(*lossTracker)
		trackers = append(trackers, tracker)
		tracker.BindRTCPWriter(interceptor.RTCPWriterFunc(func(packets []rtcp.Packet, _ interceptor.Attributes) (int, error) {
			mu.Lock()
			defer mu.Unlock()
			asked[packets[0].(*rtcp.TransportLayerNack).MediaSSRC]++
			return 0, nil
		}))
		var next []byte
		reader := tracker.BindRemoteStream(video(uint32(10+i), 96), interceptor.RTPReaderFunc(func(b []byte, a interceptor.Attributes) (int, interceptor.Attributes, error) {
			return copy(b, next), a, nil
		}))
		for _, seq := range []uint16{1, 3} {
			next = packet(seq)
			_, _, _ = reader.Read(buf, nil)
		}
	}
	require.Eventually(t, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return asked[10] > 0 && asked[11] > 0 && asked[12] > 0
	}, time.Second, 10*time.Millisecond)
	factory.loop.mu.Lock()
	assert.Len(t, factory.loop.trackers, 3)
	assert.True(t, factory.loop.running)
	factory.loop.mu.Unlock()
	for _, tracker := range trackers {
		require.NoError(t, tracker.Close())
	}
	require.Eventually(t, func() bool {
		factory.loop.mu.Lock()
		defer factory.loop.mu.Unlock()
		return !factory.loop.running
	}, time.Second, 10*time.Millisecond, "the loop stops once no connection needs it")
}

func BenchmarkLossLogJump(b *testing.B) {
	var log lossLog
	seq := uint16(0)
	for b.Loop() {
		seq += 32000
		log.add(seq)
	}
}
