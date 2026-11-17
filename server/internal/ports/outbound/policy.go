package outbound

import "github.com/versatile-sh/live/server/internal/domain/room"

// Act names the moment a policy is asked about.
type Act uint8

// Acts the core asks about; a ceiling is asked separately through Ceiling.
const (
	ActCreateRoom Act = iota + 1
	ActAdmit
	ActStartSource
)

// Ask is one question to a policy: who, where and what; Identity is the opaque subject an identity port vouched for, or empty.
type Ask struct {
	Act      Act
	Slug     room.Slug
	Identity string
	Source   room.Flags
}

// Verdict is a policy's answer; Reason is a neutral code shown to the participant when Allowed is false.
type Verdict struct {
	Allowed bool
	Reason  string
}

// Ceiling caps media a participant may send; zero means no cap.
type Ceiling struct {
	MaxHeight     uint16
	MaxFPS        uint8
	MaxBitrateBPS uint32
}

// Policy decides what the core lets happen; the core names no plan, price or customer.
type Policy interface {
	Decide(ask Ask) Verdict
	Ceiling(slug room.Slug, identity string) Ceiling
}

// AllowAll is the default policy: everything is allowed and nothing is capped.
type AllowAll struct{}

// Decide allows every act.
func (AllowAll) Decide(Ask) Verdict { return Verdict{Allowed: true} }

// Ceiling caps nothing.
func (AllowAll) Ceiling(room.Slug, string) Ceiling { return Ceiling{} }
