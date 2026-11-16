package room

import (
	"crypto/sha256"
	"crypto/subtle"
	"time"

	"github.com/versatile-sh/live/server/internal/domain/shared"
)

// Verifier is what a browser derives from a room password to prove it knows it; the password itself never arrives.
type Verifier [32]byte

// Settings is what the owner chose for a room when claiming its slug.
type Settings struct {
	Private  bool
	Listed   bool
	Country  string
	verifier [32]byte
}

// NewSettings builds the settings of a public room, or of a private one when a verifier is given.
func NewSettings(verifier *Verifier, listed bool, country string) (Settings, error) {
	s := Settings{Listed: listed, Country: country}
	if verifier != nil {
		s.Private = true
		s.verifier = sha256.Sum256(verifier[:])
	}
	return s, s.validate()
}

func (s Settings) validate() error {
	if len(s.Country) != 0 && (len(s.Country) != 2 || s.Country[0] < 'A' || s.Country[0] > 'Z' || s.Country[1] < 'A' || s.Country[1] > 'Z') {
		return shared.NewDomainError(shared.ErrCodeInvalidArgument, "country is two capital letters or empty", nil)
	}
	return nil
}

// Entry is what a person presents to enter a room, and what they ask for if the slug turns out to be free.
type Entry struct {
	Name    string
	Proof   *Verifier
	Listed  bool
	Country string
}

// Settings returns the room this entry creates when its slug is free.
func (e Entry) Settings() (Settings, error) {
	return NewSettings(e.Proof, e.Listed, e.Country)
}

// Summary is what anyone may know about a room without entering it.
type Summary struct {
	Slug     Slug
	Private  bool
	Listed   bool
	Country  string
	Count    int
	Capacity int
}

// Summary returns the public description of the room.
func (r *Room) Summary() Summary {
	return Summary{Slug: r.slug, Private: r.settings.Private, Listed: r.settings.Listed, Country: r.settings.Country, Count: r.Count(), Capacity: r.cfg.Capacity}
}

// Authorize admits a holder of the password to a private room, and locks the room after too many wrong proofs.
func (r *Room) Authorize(now time.Time, proof *Verifier) error {
	if !r.settings.Private {
		return nil
	}
	if !now.Before(r.triesEnd) {
		r.tries, r.triesEnd = 0, now.Add(r.cfg.PasswordWindow)
	}
	if r.tries >= r.cfg.PasswordTries {
		return shared.NewDomainError(shared.ErrCodeRateLimited, "too many wrong passwords, try again later", nil)
	}
	if proof != nil {
		hash := sha256.Sum256(proof[:])
		if subtle.ConstantTimeCompare(hash[:], r.settings.verifier[:]) == 1 {
			return nil
		}
		r.tries++
	}
	return shared.NewDomainError(shared.ErrCodePermissionDenied, "this room needs its password", nil)
}

// SetListed lets the owner show or hide the room in the lobby.
func (r *Room) SetListed(by PID, listed bool) error {
	if err := r.ownerOnly(by); err != nil {
		return err
	}
	next := r.settings
	next.Listed = listed
	if err := next.validate(); err != nil {
		return err
	}
	r.settings = next
	return nil
}

// SetPassword lets the owner make the room private with a new verifier, or public with none; listing is untouched.
func (r *Room) SetPassword(by PID, verifier *Verifier) error {
	if err := r.ownerOnly(by); err != nil {
		return err
	}
	next, err := NewSettings(verifier, r.settings.Listed, r.settings.Country)
	if err != nil {
		return err
	}
	r.settings, r.tries = next, 0
	return nil
}

func (r *Room) ownerOnly(by PID) error {
	if p := r.find(by); p == nil || !p.Flags.Has(FlagOwner) || p.State != StateActive {
		return shared.NewDomainError(shared.ErrCodeInvariantViolation, "only the active owner may do this", nil)
	}
	return nil
}
