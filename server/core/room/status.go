package room

// State is where a participant stands in the presence state machine.
type State uint8

// Presence states; Removed is terminal and a removed id is never reused.
const (
	StateConnecting State = iota + 1
	StateActive
	StateReconnecting
	StateRemoved
)

// String names the state as it travels on the wire.
func (s State) String() string {
	switch s {
	case StateConnecting:
		return "connecting"
	case StateActive:
		return "active"
	case StateReconnecting:
		return "reconnecting"
	case StateRemoved:
		return "removed"
	}
	return "unknown"
}

// Flags packs what a participant is doing into one word, sent whole in every roster entry.
type Flags uint16

// Flag bits; owner, unstable, muted and no-draw are set only by the server, the others by the participant.
const (
	FlagMicrophone Flags = 1 << iota
	FlagCamera
	FlagScreen
	FlagScreenAudio
	FlagHand
	FlagOwner
	FlagUnstable
	FlagBoard
	FlagMuted
	FlagNoDraw
)

// MediaFlags is the mask of bits a participant may set about themselves.
const MediaFlags = FlagMicrophone | FlagCamera | FlagScreen | FlagScreenAudio | FlagHand | FlagBoard

const knownFlags = MediaFlags | FlagOwner | FlagUnstable | FlagMuted | FlagNoDraw

// Has reports whether every bit of mask is set.
func (f Flags) Has(mask Flags) bool { return f&mask == mask }

// Reason says why a participant was removed.
type Reason string

// Removal reasons, as shown to the people who remain.
const (
	ReasonLeft         Reason = "left"
	ReasonRemoved      Reason = "removed-by-owner"
	ReasonBanned       Reason = "banned-by-owner"
	ReasonTimeout      Reason = "timeout"
	ReasonMediaTimeout Reason = "media-timeout"
	ReasonUnhealthyCap Reason = "unhealthy-cap"
)
