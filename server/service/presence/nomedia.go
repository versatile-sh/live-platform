package presence

import (
	"github.com/versatile-sh/live/server/core/room"
	"github.com/versatile-sh/live/server/port/outbound"
)

// WithoutMedia is the hub for a server that runs no media plane: a seated participant is active at once.
type WithoutMedia struct{ *Hub }

// Join seats a participant and marks it active, since no media path will ever report.
func (w WithoutMedia) Join(slug room.Slug, entry room.Entry, session outbound.Session) (room.Seat, error) {
	return w.activate(slug)(w.Hub.Join(slug, entry, session))
}

// Resume gives a participant its place back and marks it active.
func (w WithoutMedia) Resume(slug room.Slug, pid room.PID, secret [32]byte, session outbound.Session) (room.Seat, error) {
	return w.activate(slug)(w.Hub.Resume(slug, pid, secret, session))
}

func (w WithoutMedia) activate(slug room.Slug) func(room.Seat, error) (room.Seat, error) {
	return func(seat room.Seat, err error) (room.Seat, error) {
		if err == nil {
			w.MediaUp(slug, seat.PID, seat.Gen)
		}
		return seat, err
	}
}
