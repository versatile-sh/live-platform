// Package inbound holds the contracts the adapters call.
package inbound

import (
	"github.com/versatile-sh/live/server/internal/domain/room"
	"github.com/versatile-sh/live/server/internal/ports/outbound"
)

// Presence is everything a transport may ask of the rooms.
type Presence interface {
	Join(slug room.Slug, entry room.Entry, session outbound.Session) (room.Seat, error)
	Resume(slug room.Slug, pid room.PID, secret [32]byte, session outbound.Session) (room.Seat, error)
	Touch(slug room.Slug, pid room.PID, gen uint32)
	Disconnected(slug room.Slug, pid room.PID, gen uint32)
	SetMedia(slug room.Slug, pid room.PID, gen uint32, flags room.Flags)
	SetLook(slug room.Slug, pid room.PID, gen uint32, look room.Look, face string)
	SetPhoto(slug room.Slug, pid room.PID, gen uint32, jpeg []byte)
	MediaSignal(slug room.Slug, pid room.PID, gen uint32, signal room.MediaSignal)
	Chat(slug room.Slug, pid room.PID, gen uint32, to room.PID, text string, image []byte)
	Board(slug room.Slug, pid room.PID, gen uint32, to room.PID, data string)
	Leave(slug room.Slug, pid room.PID, gen uint32)
	Remove(slug room.Slug, by room.PID, gen uint32, target room.PID) error
	Ban(slug room.Slug, by room.PID, gen uint32, target room.PID) error
	Quiet(slug room.Slug, by room.PID, gen uint32, op room.QuietOp, target room.PID) error
	Transfer(slug room.Slug, by room.PID, gen uint32, target room.PID) error
	SetListed(slug room.Slug, by room.PID, gen uint32, listed bool) error
	SetPassword(slug room.Slug, by room.PID, gen uint32, verifier *room.Verifier) error
}

// Directory answers what anyone may know about rooms without entering them.
type Directory interface {
	Status(slug room.Slug) (room.Summary, bool)
	Lobby() []room.Summary
}
