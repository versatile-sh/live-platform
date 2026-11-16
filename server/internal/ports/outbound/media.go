package outbound

import "github.com/versatile-sh/live/server/internal/domain/room"

// MediaPlane carries the participants' audio and video; the room only tells it who is present.
type MediaPlane interface {
	// Attach gives a participant its media connections, replacing any it had; send delivers signals to it.
	Attach(slug room.Slug, pid room.PID, gen uint32, send func(room.MediaSignal))
	// Detach closes a participant's media.
	Detach(slug room.Slug, pid room.PID)
	// Signal applies a description or a candidate a participant sent.
	Signal(slug room.Slug, pid room.PID, gen uint32, signal room.MediaSignal)
	// Silence stops, or resumes, carrying a participant's microphone to the others.
	Silence(slug room.Slug, pid room.PID, silent bool)
}
