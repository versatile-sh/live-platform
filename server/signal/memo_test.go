package signal

import (
	"bytes"
	"strings"
	"testing"
	"time"

	"github.com/gobwas/ws"
	"github.com/stretchr/testify/assert"

	"github.com/versatile-sh/live/server/core/room"
)

func TestFrames(t *testing.T) {
	t.Run("one value sent to everyone is encoded once and shared, and a new value is encoded again", func(t *testing.T) {
		var f frames
		update := room.BoardUpdate{From: 1, Data: `{"a":1}`}
		once := f.boardFrame(update)
		assert.Same(t, &once[0], &f.boardFrame(update)[0])
		assert.Equal(t, textFrame(encodeBoard(update)), once)
		other := f.boardFrame(room.BoardUpdate{From: 1, Data: `{"a":2}`})
		assert.Equal(t, textFrame(encodeBoard(room.BoardUpdate{From: 1, Data: `{"a":2}`})), other)
		assert.Zero(t, testing.AllocsPerRun(100, func() { f.boardFrame(room.BoardUpdate{From: 1, Data: `{"a":2}`}) }))
	})

	t.Run("the board and photo frames written in place match what encoding them as JSON gives, at every frame length", func(t *testing.T) {
		for _, size := range []int{1, 90, 200, 70000} {
			data := `{"d":"` + strings.Repeat("x", size) + `"}`
			assert.Equal(t, textFrame(encodeBoard(room.BoardUpdate{From: 42, Data: data})), boardText(room.BoardUpdate{From: 42, Data: data}))
			jpeg := bytes.Repeat([]byte{0xfb, 0x01}, size)
			assert.Equal(t, textFrame(encodePhoto(4294967295, jpeg)), photoText(4294967295, jpeg))
		}
		assert.Equal(t, textFrame(encodePhoto(1, nil)), photoText(1, nil))
		assert.InDelta(t, 1.0, testing.AllocsPerRun(50, func() { photoText(1, make([]byte, 0)) }), 0)
	})

	t.Run("a text frame is what the WebSocket library compiles, in one allocation", func(t *testing.T) {
		for _, size := range []int{0, 125, 126, 65535, 65536} {
			payload := bytes.Repeat([]byte{'x'}, size)
			assert.Equal(t, ws.MustCompileFrame(ws.NewTextFrame(payload)), textFrame(payload))
		}
		payload := make([]byte, 300)
		assert.InDelta(t, 1.0, testing.AllocsPerRun(50, func() { textFrame(payload) }), 0)
	})

	t.Run("sharing a frame allocates nothing, for every kind of broadcast", func(t *testing.T) {
		var f frames
		snapshot := room.Snapshot{Version: 9, Participants: []room.Participant{{ID: 1, Name: "Ana"}}}
		message := room.ChatMessage{From: 1, Name: "Ana", Text: "oi", Image: []byte{1}, At: time.UnixMilli(5)}
		jpeg := []byte{0xff, 0xd8}
		f.rosterFrame(snapshot)
		f.chatFrame(message)
		f.photoFrame(1, jpeg)
		assert.Zero(t, testing.AllocsPerRun(100, func() {
			f.rosterFrame(snapshot)
			f.chatFrame(message)
			f.photoFrame(1, jpeg)
		}))
	})

	t.Run("a roster, a chat message and a photo are shared the same way", func(t *testing.T) {
		var f frames
		snapshot := room.Snapshot{Version: 3, Participants: []room.Participant{{ID: 1, Name: "Ana"}}}
		roster := f.rosterFrame(snapshot)
		assert.Same(t, &roster[0], &f.rosterFrame(snapshot)[0])
		assert.Equal(t, textFrame(encodeRoster(snapshot)), f.rosterFrame(snapshot))
		changed := room.Snapshot{Version: 4, Participants: []room.Participant{{ID: 1, Name: "Ana"}}}
		assert.Equal(t, textFrame(encodeRoster(changed)), f.rosterFrame(changed))

		message := room.ChatMessage{From: 1, Name: "Ana", Text: "oi", At: time.UnixMilli(5)}
		chat := f.chatFrame(message)
		assert.Same(t, &chat[0], &f.chatFrame(message)[0])
		again := message
		again.Text = "tchau"
		assert.Equal(t, textFrame(encodeChat(again)), f.chatFrame(again))

		jpeg := []byte{0xff, 0xd8, 0xff}
		photo := f.photoFrame(1, jpeg)
		assert.Same(t, &photo[0], &f.photoFrame(1, jpeg)[0])
		assert.Equal(t, textFrame(encodePhoto(2, jpeg)), f.photoFrame(2, jpeg))
	})
}

func TestRosterText(t *testing.T) {
	hard := []string{"", "Ana", "a\"b\\c", "\b\f\n\r\t\x01\x1f\x7f", "<script>&amp;", "line para ", "bad\xff\xfeutf8", "é😀中文", strings.Repeat("x", 300)}
	for _, name := range hard {
		for _, snapshot := range []room.Snapshot{
			{Version: 0},
			{Version: 18446744073709551615, Participants: []room.Participant{{ID: 4294967295, Slot: 255, Name: name, Flags: 65535, Look: room.Look(name), Face: name}}, Quiet: true, Locked: true, Private: true, Listed: true},
			{Version: 7, Participants: []room.Participant{{ID: 1, Name: name}, {ID: 2, Name: "Bia", State: room.StateActive}}, Gone: []room.Departure{{PID: 3, Reason: room.Reason(name)}, {PID: 9, Reason: room.ReasonLeft}}},
		} {
			assert.Equal(t, string(textFrame(encodeRoster(snapshot))), string(rosterText(snapshot)), "%q", name)
		}
	}
	snapshot := room.Snapshot{Version: 3, Participants: []room.Participant{{ID: 1, Name: "Ana <&>"}, {ID: 2, Name: "Bia"}}}
	assert.InDelta(t, 1.0, testing.AllocsPerRun(100, func() { rosterText(snapshot) }), 0)
}
