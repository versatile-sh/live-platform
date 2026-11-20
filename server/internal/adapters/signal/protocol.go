// Package signal carries the signalling protocol lv.1 over WebSocket on a gnet event loop.
package signal

import (
	"encoding/base64"
	"encoding/json"
	"errors"

	"github.com/gobwas/ws"

	"github.com/versatile-sh/live/server/internal/domain/room"
	"github.com/versatile-sh/live/server/internal/domain/shared"
)

// Subprotocol is the only signalling protocol version this server speaks.
const Subprotocol = "lv.1"

// Close codes of lv.1, in the range WebSocket leaves to applications.
const (
	CloseSuperseded ws.StatusCode = 4001
	CloseBadFrame   ws.StatusCode = 4400
	CloseNoHello    ws.StatusCode = 4401
	CloseRemoved    ws.StatusCode = 4403
	CloseBanned     ws.StatusCode = 4404
	CloseRestarting ws.StatusCode = 4012
	CloseSilent     ws.StatusCode = 4408
	CloseSlow       ws.StatusCode = 4409
	CloseFlood      ws.StatusCode = 4429
)

type clientFrame struct {
	T         string            `json:"t"`
	Pass      string            `json:"pass"`
	Slug      string            `json:"slug"`
	Name      string            `json:"name"`
	PID       uint32            `json:"pid"`
	Secret    string            `json:"secret"`
	Flags     uint16            `json:"flags"`
	Op        string            `json:"op"`
	Verifier  string            `json:"verifier"`
	Listed    bool              `json:"listed"`
	Text      string            `json:"text"`
	Look      string            `json:"look"`
	To        uint32            `json:"to"`
	Face      string            `json:"face"`
	Data      string            `json:"data"`
	Board     string            `json:"board"`
	Role      string            `json:"role"`
	Kind      string            `json:"kind"`
	SDP       string            `json:"sdp"`
	Candidate string            `json:"candidate"`
	Sources   map[string]string `json:"sources"`
}

type mediaFrame struct {
	T         string `json:"t"`
	Role      string `json:"role"`
	Kind      string `json:"kind"`
	SDP       string `json:"sdp,omitempty"`
	Candidate string `json:"candidate,omitempty"`
}

type photoFrame struct {
	T    string `json:"t"`
	PID  uint32 `json:"pid"`
	Data string `json:"data"`
}

type boardFrame struct {
	T    string          `json:"t"`
	PID  uint32          `json:"pid"`
	Data json.RawMessage `json:"data"`
}

type chatFrame struct {
	T    string `json:"t"`
	PID  uint32 `json:"pid"`
	To   uint32 `json:"to,omitempty"`
	Name string `json:"name"`
	Text string `json:"text"`
	Img  string `json:"img,omitempty"`
	At   int64  `json:"at"`
}

type person struct {
	PID   uint32 `json:"pid"`
	Slot  uint8  `json:"slot"`
	Name  string `json:"name"`
	State string `json:"state"`
	Flags uint16 `json:"flags"`
	Look  string `json:"look,omitempty"`
	Face  string `json:"face,omitempty"`
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
	Quiet  bool        `json:"quiet,omitempty"`
	Locked bool        `json:"locked,omitempty"`
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
	f := rosterFrame{T: "roster", V: s.Version, People: make([]person, len(s.Participants)), Quiet: s.Quiet, Locked: s.Locked}
	for i, p := range s.Participants {
		f.People[i] = person{PID: uint32(p.ID), Slot: p.Slot, Name: p.Name, State: p.State.String(), Flags: uint16(p.Flags), Look: string(p.Look), Face: p.Face}
	}
	for _, d := range s.Gone {
		f.Gone = append(f.Gone, departure{PID: uint32(d.PID), Reason: string(d.Reason)})
	}
	return mustJSON(f)
}

func encodeMedia(s room.MediaSignal) []byte {
	return mustJSON(mediaFrame{T: "rtc", Role: s.Role, Kind: s.Kind, SDP: s.SDP, Candidate: s.Candidate})
}

func encodePhoto(pid room.PID, jpeg []byte) []byte {
	return mustJSON(photoFrame{T: "photo", PID: uint32(pid), Data: base64.StdEncoding.EncodeToString(jpeg)})
}

func encodeBoard(u room.BoardUpdate) []byte {
	return mustJSON(boardFrame{T: "board", PID: uint32(u.From), Data: json.RawMessage(u.Data)})
}

func encodeChat(m room.ChatMessage) []byte {
	return mustJSON(chatFrame{T: "chat", PID: uint32(m.From), To: uint32(m.To), Name: m.Name, Text: m.Text, Img: base64.StdEncoding.EncodeToString(m.Image), At: m.At.UnixMilli()})
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

func decodeVerifier(raw string) (*room.Verifier, bool) {
	if raw == "" {
		return nil, true
	}
	v, ok := decodeSecret(raw)
	return (*room.Verifier)(&v), ok
}

func closeCode(reason room.CloseReason) ws.StatusCode {
	switch reason {
	case room.CloseSuperseded:
		return CloseSuperseded
	case room.CloseSilent:
		return CloseSilent
	case room.CloseSlow:
		return CloseSlow
	case room.CloseRemoved:
		return CloseRemoved
	case room.CloseBanned:
		return CloseBanned
	}
	return ws.StatusNormalClosure
}

func textFrame(payload []byte) []byte {
	return ws.MustCompileFrame(ws.NewTextFrame(payload))
}

func closeFrame(code ws.StatusCode, reason string) []byte {
	return ws.MustCompileFrame(ws.NewCloseFrame(ws.NewCloseFrameBody(code, reason)))
}

func mustJSON(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}
