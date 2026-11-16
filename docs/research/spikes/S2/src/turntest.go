package main

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/pion/turn/v5"
)

func restCreds() (user, pass string) {
	user = strconv.FormatInt(time.Now().Add(600*time.Second).Unix(), 10) + ":s2"
	m := hmac.New(sha1.New, []byte(os.Getenv("TURN_SECRET")))
	m.Write([]byte(user))
	return user, base64.StdEncoding.EncodeToString(m.Sum(nil))
}

func getStats(url string) map[string]any {
	r, err := http.Get(url)
	if err != nil {
		return nil
	}
	defer r.Body.Close()
	b, _ := io.ReadAll(r.Body)
	var m map[string]any
	json.Unmarshal(b, &m)
	return m
}

func runTurnTest() {
	bind := flag.String("bind", "127.0.0.1", "")
	flag.Parse()
	user, pass := restCreds()
	conn, err := net.ListenPacket("udp4", "0.0.0.0:0")
	if err != nil {
		panic(err)
	}
	cl, err := turn.NewClient(&turn.ClientConfig{TURNServerAddr: *bind + ":3478", Username: user, Password: pass, Realm: "live", Conn: conn})
	if err != nil {
		panic(err)
	}
	defer cl.Close()
	if err := cl.Listen(); err != nil {
		panic(err)
	}
	relay, err := cl.Allocate()
	if err != nil {
		fmt.Println(`{"allocate":"FAILED","err":"` + err.Error() + `"}`)
		return
	}
	defer relay.Close()
	fmt.Println(`{"allocate":"ok","relay":"` + relay.LocalAddr().String() + `"}`)
	targets := []struct {
		name, ip string
		port     int
	}{
		{"127.0.0.1:7882 (loopback, mux port)", "127.0.0.1", 7882},
		{"::ffff:127.0.0.1:7882 (v4-mapped loopback)", "::ffff:127.0.0.1", 7882},
		{"::1:7882 (v6 loopback)", "::1", 7882},
		{"10.0.0.1:7882 (RFC1918 other)", "10.0.0.1", 7882},
		{"172.31.0.99:7882 (another bridge host)", "172.31.0.99", 7882},
		{*bind + ":7999 (SFU IP, non-mux port, decoy listener)", *bind, 7999},
		{*bind + ":7882 (SFU IP, mux port)", *bind, 7882},
	}
	before := getStats("http://" + *bind + ":8080/stats")
	for _, t := range targets {
		ip := net.ParseIP(t.ip)
		_, err := relay.WriteTo([]byte("probe "+t.name), &net.UDPAddr{IP: ip, Port: t.port})
		res := "permission+send accepted"
		if err != nil {
			res = "REFUSED: " + err.Error()
		}
		fmt.Printf("RESULT target=%q -> %s\n", t.name, res)
		time.Sleep(300 * time.Millisecond)
	}
	time.Sleep(time.Second)
	after := getStats("http://" + *bind + ":8080/stats")
	fmt.Printf("RESULT decoy_rx before=%v after=%v from=%v\n", before["decoy_rx"], after["decoy_rx"], after["decoy_from"])
}
