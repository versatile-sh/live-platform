//go:build public

package integration

import (
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/pion/webrtc/v4"
	"github.com/stretchr/testify/require"
)

// TestPublicCall is the smoke test of a deployed server (`go test -tags public`): set LIVE_PUBLIC_WS to its signalling address and two stand-in browsers must reach it, become active over the real media port and hear each other.
func TestPublicCall(t *testing.T) {
	url := os.Getenv("LIVE_PUBLIC_WS")
	if url == "" {
		t.Fatal("LIVE_PUBLIC_WS is not set")
	}
	ana := open(t, webrtc.NewAPI(), url, "ana")
	bia := open(t, webrtc.NewAPI(), url, "bia")
	require.Eventually(t, func() bool { return ana.state(1) == "active" && ana.state(2) == "active" && bia.state(1) == "active" }, 4*wait, 50*time.Millisecond)
	ana.publish("microphone")
	require.Eventually(t, func() bool { return bia.hears("1:microphone") }, 4*wait, 50*time.Millisecond)
}

// TestPublicStay keeps two stand-in browsers in a call on a deployed server for LIVE_STAY_SECONDS and fails if either is dropped: run it while publishing the client to see that nobody is touched.
func TestPublicStay(t *testing.T) {
	url := os.Getenv("LIVE_PUBLIC_WS")
	stay, err := strconv.Atoi(os.Getenv("LIVE_STAY_SECONDS"))
	if url == "" || err != nil || stay <= 0 {
		t.Fatal("LIVE_PUBLIC_WS and LIVE_STAY_SECONDS are not set")
	}
	ana := open(t, webrtc.NewAPI(), url, "ana")
	bia := open(t, webrtc.NewAPI(), url, "bia")
	require.Eventually(t, func() bool { return ana.state(1) == "active" && ana.state(2) == "active" && bia.state(1) == "active" }, 4*wait, 50*time.Millisecond)
	ana.publish("microphone")
	require.Eventually(t, func() bool { return bia.hears("1:microphone") }, 4*wait, 50*time.Millisecond)
	for range stay {
		time.Sleep(time.Second)
		ana.send(map[string]string{"t": "hb"})
		bia.send(map[string]string{"t": "hb"})
		require.Equal(t, "active", ana.state(2), "bia was dropped")
		require.Equal(t, "active", bia.state(1), "ana was dropped")
	}
}
