package room

// Departure tells the people who remain that a participant is gone, and why.
type Departure struct {
	PID    PID
	Reason Reason
}

// Snapshot is the whole roster at one version; a client keeps only the highest version it has seen.
type Snapshot struct {
	Version      uint64
	Participants []Participant
	Gone         []Departure
	Quiet        bool
	Locked       bool
	Private      bool
	Listed       bool
}

// CloseReason says why the server ended a participant's connection.
type CloseReason string

// Reasons a connection is closed by the server.
const (
	CloseSuperseded CloseReason = "superseded"
	CloseSilent     CloseReason = "silent"
	CloseSlow       CloseReason = "slow"
	CloseRemoved    CloseReason = "removed"
	CloseBanned     CloseReason = "banned"
)

// Seat is what a participant needs to keep or recover its place.
type Seat struct {
	PID    PID
	Gen    uint32
	Secret [32]byte
}
