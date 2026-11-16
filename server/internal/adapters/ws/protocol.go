// Package ws carries the signalling protocol lv.1 over WebSocket.
package ws

import (
	"encoding/base64"
	"encoding/json"
	"errors"

	"github.com/coder/websocket"

	"github.com/versatile-sh/live/server/internal/domain/room"
	"github.com/versatile-sh/live/server/internal/domain/shared"
)

// Subprotocol is the only signalling protocol version this server speaks.
const Subprotocol = "lv.1"

// Close codes of lv.1, in the range WebSocket leaves to applications.
const (
	CloseSuperseded websocket.StatusCode = 4001
	CloseBadFrame   websocket.StatusCode = 4400
	CloseNoHello    websocket.StatusCode = 4401
	CloseRemoved    websocket.StatusCode = 4403
	CloseSilent     websocket.StatusCode = 4408
	CloseSlow       websocket.StatusCode = 4409
	CloseFlood      websocket.StatusCode = 4429
)

type clientFrame struct {
	T      string `json:"t"`
	Slug   string `json:"slug"`
	Name   string `json:"name"`
	PID    uint32 `json:"pid"`
	Secret string `json:"secret"`
	Flags  uint16 `json:"flags"`
	Op     string `json:"op"`
}

type person struct {
	PID   uint32 `json:"pid"`
	Slot  uint8  `json:"slot"`
	Name  string `json:"name"`
	State string `json:"state"`
	Flags uint16 `json:"flags"`
}

type departure struct {
	PID    uint32 `json:"pid"`
	Reason string `json:"reason"`
}

type rosterFrame struct {
	T      string      `json:"t"`
	V      uint64      `json:"v"`
	People []person    `json:"people"`
	Gone   []departure `json:"gone,omitempty"`
}

type joinedFrame struct {
	T      string `json:"t"`
	PID    uint32 `json:"pid"`
	Gen    uint32 `json:"gen"`
	Secret string `json:"secret"`
}

type errorFrame struct {
	T       string `json:"t"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

func encodeRoster(s room.Snapshot) []byte {
	f := rosterFrame{T: "roster", V: s.Version, People: make([]person, len(s.Participants))}
	for i, p := range s.Participants {
		f.People[i] = person{PID: uint32(p.ID), Slot: p.Slot, Name: p.Name, State: p.State.String(), Flags: uint16(p.Flags)}
	}
	for _, d := range s.Gone {
		f.Gone = append(f.Gone, departure{PID: uint32(d.PID), Reason: string(d.Reason)})
	}
	return mustJSON(f)
}

func encodeJoined(seat room.Seat) []byte {
	return mustJSON(joinedFrame{T: "joined", PID: uint32(seat.PID), Gen: seat.Gen, Secret: base64.RawURLEncoding.EncodeToString(seat.Secret[:])})
}

func encodeError(err error) []byte {
	code := shared.CodeOf(err)
	if code == "" {
		return mustJSON(errorFrame{T: "error", Code: "INTERNAL", Message: "internal error"})
	}
	var de *shared.DomainError
	errors.As(err, &de)
	return mustJSON(errorFrame{T: "error", Code: code, Message: de.Message})
}

func decodeSecret(raw string) ([32]byte, bool) {
	var out [32]byte
	b, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil || len(b) != len(out) {
		return out, false
	}
	copy(out[:], b)
	return out, true
}

func closeCode(reason room.CloseReason) websocket.StatusCode {
	switch reason {
	case room.CloseSuperseded:
		return CloseSuperseded
	case room.CloseSilent:
		return CloseSilent
	case room.CloseSlow:
		return CloseSlow
	case room.CloseRemoved:
		return CloseRemoved
	}
	return websocket.StatusNormalClosure
}

func mustJSON(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}
