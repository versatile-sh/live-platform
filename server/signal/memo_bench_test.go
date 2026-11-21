package signal

import (
	"strings"
	"testing"

	"github.com/versatile-sh/live/server/core/room"
)

const roomSize = 10

func BenchmarkBroadcastBoard(b *testing.B) {
	update := room.BoardUpdate{From: 1, Data: `{"d":"` + strings.Repeat("x", 8<<10) + `"}`}
	b.Run("each", func(b *testing.B) {
		b.ReportAllocs()
		for b.Loop() {
			for range roomSize {
				_ = textFrame(encodeBoard(update))
			}
		}
	})
	b.Run("once", func(b *testing.B) {
		var f frames
		pieces := [2]room.BoardUpdate{update, {From: 1, Data: `{"e":"` + strings.Repeat("x", 8<<10) + `"}`}}
		i := 0
		b.ReportAllocs()
		for b.Loop() {
			i ^= 1
			for range roomSize {
				_ = f.boardFrame(pieces[i])
			}
		}
	})
}

func BenchmarkBroadcastPhoto(b *testing.B) {
	jpeg := make([]byte, 48<<10)
	b.Run("each", func(b *testing.B) {
		b.ReportAllocs()
		for b.Loop() {
			for range roomSize {
				_ = textFrame(encodePhoto(1, jpeg))
			}
		}
	})
	b.Run("once", func(b *testing.B) {
		var f frames
		b.ReportAllocs()
		for b.Loop() {
			fresh := append([]byte(nil), jpeg...)
			for range roomSize {
				_ = f.photoFrame(1, fresh)
			}
		}
	})
}

func BenchmarkBroadcastRoster(b *testing.B) {
	people := make([]room.Participant, roomSize)
	for i := range people {
		people[i] = room.Participant{ID: room.PID(i + 1), Name: "Pessoa"}
	}
	b.Run("each", func(b *testing.B) {
		b.ReportAllocs()
		for b.Loop() {
			s := room.Snapshot{Version: 1, Participants: people}
			for range roomSize {
				_ = textFrame(encodeRoster(s))
			}
		}
	})
	b.Run("once", func(b *testing.B) {
		var f frames
		b.ReportAllocs()
		v := uint64(0)
		for b.Loop() {
			v++
			s := room.Snapshot{Version: v, Participants: people}
			for range roomSize {
				_ = f.rosterFrame(s)
			}
		}
	})
}
