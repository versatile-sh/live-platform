package outbound

import "time"

// MediaTroubleEvent is one trouble on a participant's media path, tied to their stay; it names no person and carries no address.
type MediaTroubleEvent struct {
	At      time.Time
	Room    string
	PID     uint32
	Trouble string
	// Browser tells a trouble the participant's browser reported from one the server saw.
	Browser bool
	// Detail is the server's own error text, never anything a browser sent.
	Detail  string
	TraceID string
	SpanID  string
}

// MediaTroubles hears troubles on participants' media paths, so a lost picture in production can be found again.
type MediaTroubles interface {
	Report(e MediaTroubleEvent)
}

// NoTroubles drops every trouble.
type NoTroubles struct{}

// Report does nothing.
func (NoTroubles) Report(MediaTroubleEvent) {}
