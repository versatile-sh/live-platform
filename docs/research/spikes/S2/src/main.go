// S2: synthetic SFU forwarding cost + TURN allow-list test. Subcommands: sfu, load, turntest, relaytest.
package main

import (
	"fmt"
	"os"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Println("usage: s2 sfu|load|turntest|relaytest [flags]")
		os.Exit(2)
	}
	cmd := os.Args[1]
	os.Args = append(os.Args[:1], os.Args[2:]...)
	switch cmd {
	case "sfu":
		runSFU()
	case "load":
		runLoad()
	case "turntest":
		runTurnTest()
	case "relaytest":
		runRelayTest()
	}
}
