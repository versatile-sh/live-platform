package signal

import (
	"sync"

	"github.com/versatile-sh/live/server/core/room"
)

// memo keeps the last frame encoded for one kind of broadcast, so a room sending one value to everyone encodes it once and every connection queues the same bytes.
// It holds the value it was built from, so the memory a key points at cannot be reused for something else while the key is kept.
type memo[K comparable, H any] struct {
	mu    sync.Mutex
	key   K
	hold  H
	frame []byte
}

func (m *memo[K, H]) get(key K, hold H, build func() []byte) []byte {
	m.mu.Lock()
	if m.frame != nil && m.key == key {
		frame := m.frame
		m.mu.Unlock()
		return frame
	}
	m.mu.Unlock()
	frame := build()
	m.mu.Lock()
	m.key, m.hold, m.frame = key, hold, frame
	m.mu.Unlock()
	return frame
}

type rosterKey struct {
	version uint64
	people  *room.Participant
	count   int
	gone    *room.Departure
	left    int
	quiet   bool
	locked  bool
}

type chatKey struct {
	from, to   room.PID
	at         int64
	name, text string
	image      *byte
	size       int
}

type boardKey struct {
	from room.PID
	data string
}

type photoKey struct {
	pid  room.PID
	jpeg *byte
	size int
}

// frames holds one memo per kind of broadcast the rooms send.
type frames struct {
	roster memo[rosterKey, room.Snapshot]
	chat   memo[chatKey, []byte]
	board  memo[boardKey, struct{}]
	photo  memo[photoKey, []byte]
}

func first[T any](s []T) *T {
	if len(s) == 0 {
		return nil
	}
	return &s[0]
}

func (f *frames) rosterFrame(s room.Snapshot) []byte {
	key := rosterKey{version: s.Version, people: first(s.Participants), count: len(s.Participants), gone: first(s.Gone), left: len(s.Gone), quiet: s.Quiet, locked: s.Locked}
	return f.roster.get(key, s, func() []byte { return textFrame(encodeRoster(s)) })
}

func (f *frames) chatFrame(m room.ChatMessage) []byte {
	key := chatKey{from: m.From, to: m.To, at: m.At.UnixNano(), name: m.Name, text: m.Text, image: first(m.Image), size: len(m.Image)}
	return f.chat.get(key, m.Image, func() []byte { return textFrame(encodeChat(m)) })
}

func (f *frames) boardFrame(u room.BoardUpdate) []byte {
	return f.board.get(boardKey{from: u.From, data: u.Data}, struct{}{}, func() []byte { return boardText(u) })
}

func (f *frames) photoFrame(pid room.PID, jpeg []byte) []byte {
	return f.photo.get(photoKey{pid: pid, jpeg: first(jpeg), size: len(jpeg)}, jpeg, func() []byte { return photoText(pid, jpeg) })
}
