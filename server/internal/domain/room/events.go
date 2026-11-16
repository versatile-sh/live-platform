package room

// EventKind classifies a change the other participants must see.
type EventKind uint8

// Kinds of roster change.
const (
	EventJoined EventKind = iota + 1
	EventChanged
	EventRemoved
)

// Event is one roster change, stamped with the roster version it produced.
type Event struct {
	Kind    EventKind
	PID     PID
	Version uint64
	Reason  Reason
}
