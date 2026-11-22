// Package signal carries the signalling protocol lv.1 over WebSocket on a gnet event loop.
package signal

import (
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"strconv"

	"github.com/gobwas/ws"

	"github.com/versatile-sh/live/server/core/room"
	"github.com/versatile-sh/live/server/port"
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
	Code      string            `json:"code"`
}

const (
	troublesPerSec = 0.1
	troubleBurst   = 5
)

type mediaFrame struct {
	T         string `json:"t"`
	Role      string `json:"role"`
	Kind      string `json:"kind"`
	SDP       string `json:"sdp,omitempty"`
	Candidate string `json:"candidate,omitempty"`
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
	Pass   string `json:"pass,omitempty"`
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

func encodeChat(m room.ChatMessage) []byte {
	return mustJSON(chatFrame{T: "chat", PID: uint32(m.From), To: uint32(m.To), Name: m.Name, Text: m.Text, Img: base64.StdEncoding.EncodeToString(m.Image), At: m.At.UnixMilli()})
}

func encodeJoined(seat room.Seat, pass string) []byte {
	return mustJSON(joinedFrame{T: "joined", PID: uint32(seat.PID), Gen: seat.Gen, Secret: base64.RawURLEncoding.EncodeToString(seat.Secret[:]), Pass: pass})
}

func encodeError(err error) []byte {
	coded := port.Classify(err)
	return mustJSON(errorFrame{T: "error", Code: coded.Code, Message: coded.Detail})
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
	frame, at := textFrameOf(len(payload))
	copy(frame[at:], payload)
	return frame
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

func textFrameOf(n int) ([]byte, int) {
	switch {
	case n >= 0 && n <= 125:
		frame := make([]byte, 2+n)
		frame[0], frame[1] = 0x81, byte(n)
		return frame, 2
	case n > 125 && n <= 0xffff:
		frame := make([]byte, 4+n)
		frame[0], frame[1] = 0x81, 126
		binary.BigEndian.PutUint16(frame[2:], uint16(n))
		return frame, 4
	default:
		frame := make([]byte, 10+n)
		frame[0], frame[1] = 0x81, 127
		binary.BigEndian.PutUint64(frame[2:], uint64(max(n, 0)))
		return frame, 10
	}
}

func boardText(u room.BoardUpdate) []byte {
	var digits [10]byte
	pid := strconv.AppendUint(digits[:0], uint64(u.From), 10)
	const open, mid = `{"t":"board","pid":`, `,"data":`
	frame, at := textFrameOf(len(open) + len(pid) + len(mid) + len(u.Data) + 1)
	w := append(frame[at:at], open...)
	w = append(w, pid...)
	w = append(w, mid...)
	w = append(w, u.Data...)
	_ = append(w, '}')
	return frame
}

func photoText(pid room.PID, jpeg []byte) []byte {
	var digits [10]byte
	id := strconv.AppendUint(digits[:0], uint64(pid), 10)
	const open, mid, end = `{"t":"photo","pid":`, `,"data":"`, `"}`
	size := base64.StdEncoding.EncodedLen(len(jpeg))
	frame, at := textFrameOf(len(open) + len(id) + len(mid) + size + len(end))
	w := append(frame[at:at], open...)
	w = append(w, id...)
	w = append(w, mid...)
	base64.StdEncoding.Encode(w[len(w):len(w)+size], jpeg)
	_ = append(w[:len(w)+size], end...)
	return frame
}
