package sfu

import (
	"sync"
	"testing"
	"time"

	"github.com/pion/interceptor"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
	"github.com/stretchr/testify/require"

	"github.com/versatile-sh/live/server/core/room"
)

type dropper struct {
	interceptor.NoOp
	mu      sync.Mutex
	dropped map[uint16]bool
}

func (d *dropper) NewInterceptor(string) (interceptor.Interceptor, error) { return d, nil }

func (d *dropper) BindRemoteStream(_ *interceptor.StreamInfo, reader interceptor.RTPReader) interceptor.RTPReader {
	return interceptor.RTPReaderFunc(func(b []byte, a interceptor.Attributes) (int, interceptor.Attributes, error) {
		for {
			n, attr, err := reader.Read(b, a)
			if err != nil || n < 4 {
				return n, attr, err
			}
			seq := uint16(b[2])<<8 | uint16(b[3])
			d.mu.Lock()
			drop := seq%10 == 3 && !d.dropped[seq]
			if drop {
				d.dropped[seq] = true
			}
			d.mu.Unlock()
			if !drop {
				return n, attr, err
			}
		}
	})
}

func TestLostPacketsAreSentAgain(t *testing.T) {
	engine, err := New(Config{Loopback: true}, &reports{up: map[room.PID]bool{}})
	require.NoError(t, err)
	media := &webrtc.MediaEngine{}
	require.NoError(t, media.RegisterDefaultCodecs())
	registry := &interceptor.Registry{}
	drops := &dropper{dropped: map[uint16]bool{}}
	registry.Add(drops)
	require.NoError(t, webrtc.ConfigureNack(media, registry))
	settings := webrtc.SettingEngine{}
	Loopback(&settings)
	lossy := webrtc.NewAPI(webrtc.WithMediaEngine(media), webrtc.WithInterceptorRegistry(registry), webrtc.WithSettingEngine(settings))

	ana := enter(t, engine, 1)
	bia := enterWith(t, engine, 2, lossy)
	var mu sync.Mutex
	got := map[uint16]bool{}
	bia.sub.OnTrack(func(remote *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		for {
			packet, _, err := remote.ReadRTP()
			if err != nil {
				return
			}
			mu.Lock()
			got[packet.SequenceNumber] = true
			mu.Unlock()
		}
	})
	track, err := webrtc.NewTrackLocalStaticRTP(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8}, "track-camera", "stream-camera")
	require.NoError(t, err)
	_, err = ana.pub.AddTrack(track)
	require.NoError(t, err)
	ana.declare(map[string]string{"stream-camera": "camera"})
	seq := uint16(0)
	send := func() {
		seq++
		_ = track.WriteRTP(&rtp.Packet{Header: rtp.Header{Version: 2, SequenceNumber: seq, Timestamp: uint32(seq) * 3000}, Payload: []byte{0x10, byte(seq)}})
	}
	require.Eventually(t, func() bool {
		send()
		mu.Lock()
		defer mu.Unlock()
		return len(got) > 5
	}, wait, 10*time.Millisecond)
	mu.Lock()
	first := uint16(0)
	for s := range got {
		if first == 0 || s < first {
			first = s
		}
	}
	mu.Unlock()
	for range 300 {
		send()
		time.Sleep(5 * time.Millisecond)
	}
	last := seq - 20
	require.Eventually(t, func() bool {
		mu.Lock()
		defer mu.Unlock()
		for s := first; s <= last; s++ {
			if !got[s] {
				return false
			}
		}
		return true
	}, wait, 50*time.Millisecond, "every packet the subscriber lost arrives again")
	drops.mu.Lock()
	defer drops.mu.Unlock()
	require.Greater(t, len(drops.dropped), 20)
}
