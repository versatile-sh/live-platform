package main

import (
	"fmt"
	"net"
	"os"
	"sync/atomic"
	"time"

	"github.com/pion/turn/v5"
)

var droppedByPortFilter atomic.Int64

// portFilterGen wraps a relay generator so the relay socket refuses to send to any peer port
// other than allowPort. This is the port-level control that PermissionHandler cannot express.
type portFilterGen struct {
	inner     turn.RelayAddressGenerator
	allowPort int
}

func (g *portFilterGen) Validate() error { return g.inner.Validate() }
func (g *portFilterGen) AllocatePacketConn(c turn.AllocateListenerConfig) (net.PacketConn, net.Addr, error) {
	pc, a, err := g.inner.AllocatePacketConn(c)
	if err != nil {
		return nil, nil, err
	}
	return &portFilterConn{PacketConn: pc, allow: g.allowPort}, a, nil
}
func (g *portFilterGen) AllocateListener(c turn.AllocateListenerConfig) (net.Listener, net.Addr, error) {
	return g.inner.AllocateListener(c)
}
func (g *portFilterGen) AllocateConn(c turn.AllocateConnConfig) (net.Conn, error) {
	return g.inner.AllocateConn(c)
}

type portFilterConn struct {
	net.PacketConn
	allow int
}

func (c *portFilterConn) WriteTo(p []byte, a net.Addr) (int, error) {
	if u, ok := a.(*net.UDPAddr); ok && u.Port != c.allow {
		droppedByPortFilter.Add(1)
		fmt.Println("turn relay: dropped write to", a)
		return len(p), nil
	}
	return c.PacketConn.WriteTo(p, a)
}

func startTurn(bind string, muxPort int, mode string) {
	secret := os.Getenv("TURN_SECRET")
	udp, err := net.ListenPacket("udp4", bind+":3478")
	if err != nil {
		panic(err)
	}
	allowed := net.ParseIP(bind)
	var ph turn.PermissionHandler
	if mode != "default" {
		ph = func(client net.Addr, peer net.IP) bool {
			ok := peer.Equal(allowed)
			fmt.Printf("turn permission client=%v peer=%v allow=%v\n", client, peer, ok)
			return ok
		}
	}
	var gen turn.RelayAddressGenerator = &turn.RelayAddressGeneratorPortRange{
		RelayAddress: net.ParseIP(bind), Address: bind, MinPort: 49160, MaxPort: 49200}
	if mode == "ipport" {
		gen = &portFilterGen{inner: gen, allowPort: muxPort}
	}
	_, err = turn.NewServer(turn.ServerConfig{
		Realm:             "live",
		AuthHandler:       turn.LongTermTURNRESTAuthHandler(secret, nil),
		PacketConnConfigs: []turn.PacketConnConfig{{PacketConn: udp, RelayAddressGenerator: gen, PermissionHandler: ph}},
	})
	if err != nil {
		panic(err)
	}
	fmt.Println("turn listening", bind+":3478", "mode", mode)
	_ = time.Second
}
