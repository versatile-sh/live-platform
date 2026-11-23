package room

import (
	"crypto/sha256"
	"crypto/subtle"
	"time"

	"github.com/versatile-sh/live/server/port"
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
		return port.NewError(port.CodeInvalidArgument, "country is two capital letters or empty")
	}
	return nil
}

// Entry is what a person presents to enter a room, and what they ask for if the slug turns out to be free.
type Entry struct {
	Name    string
	Look    Look
	Face    string
	Proof   *Verifier
	Listed  bool
	Country string
	Origin  string
	Client  Client
	TraceID string
	SpanID  string
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

const (
	maxOrigins     = 1024
	overflowOrigin = "\x00overflow"
	roomTriesScale = 10
)

type tally struct {
	count int
	end   time.Time
}

// Authorize admits a holder of the password to a private room; wrong proofs count per origin and lock only that origin,
// while the whole room locks at ten times the limit in one window, and origins past a bounded table share one tally.
func (r *Room) Authorize(now time.Time, origin string, proof *Verifier) error {
	if !r.settings.Private {
		return nil
	}
	if !now.Before(r.triesEnd) {
		r.tries, r.triesEnd = 0, now.Add(r.cfg.PasswordWindow)
	}
	t := r.tallyOf(now, origin)
	if t.count >= r.cfg.PasswordTries || r.tries >= r.cfg.PasswordTries*roomTriesScale {
		return port.NewError(port.CodeRateLimited, "too many wrong passwords, try again later")
	}
	if proof != nil {
		hash := sha256.Sum256(proof[:])
		if subtle.ConstantTimeCompare(hash[:], r.settings.verifier[:]) == 1 {
			return nil
		}
		t.count++
		r.tries++
	}
	return port.NewError(port.CodePermissionDenied, "this room needs its password")
}

func (r *Room) tallyOf(now time.Time, origin string) *tally {
	if t, ok := r.origins[origin]; ok {
		if !now.Before(t.end) {
			t.count, t.end = 0, now.Add(r.cfg.PasswordWindow)
		}
		return t
	}
	if len(r.origins) >= maxOrigins {
		for key, t := range r.origins {
			if !now.Before(t.end) {
				delete(r.origins, key)
			}
		}
	}
	if len(r.origins) >= maxOrigins {
		origin = overflowOrigin
		if t, ok := r.origins[origin]; ok {
			if !now.Before(t.end) {
				t.count, t.end = 0, now.Add(r.cfg.PasswordWindow)
			}
			return t
		}
	}
	if r.origins == nil {
		r.origins = map[string]*tally{}
	}
	t := &tally{end: now.Add(r.cfg.PasswordWindow)}
	r.origins[origin] = t
	return t
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
	r.version++
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
	r.settings, r.tries, r.origins = next, 0, nil
	r.version++
	return nil
}

func (r *Room) ownerOnly(by PID) error {
	if p := r.find(by); p == nil || !p.Flags.Has(FlagOwner) || p.State != StateActive {
		return port.NewError(port.CodeInvariantViolation, "only the active owner may do this")
	}
	return nil
}
