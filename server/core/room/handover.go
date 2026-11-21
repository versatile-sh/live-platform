package room

import (
	"math/bits"
	"time"

	"github.com/versatile-sh/live/server/port"
)

// Kept is one participant as a room hands them to the server that takes over: who they are and the hash of the secret that lets them back in, never the secret.
type Kept struct {
	ID         PID      `json:"id"`
	Slot       uint8    `json:"slot"`
	Name       string   `json:"name"`
	Flags      Flags    `json:"flags"`
	Look       Look     `json:"look"`
	Face       string   `json:"face"`
	Gen        uint32   `json:"gen"`
	SecretHash [32]byte `json:"secret"`
	Origin     string   `json:"origin"`
}

// Handed is everything a room knows, in the form one server hands to the next so that the room outlives a deploy.
type Handed struct {
	Slug     Slug     `json:"slug"`
	Private  bool     `json:"private"`
	Listed   bool     `json:"listed"`
	Country  string   `json:"country"`
	Verifier [32]byte `json:"verifier"`
	NextPID  PID      `json:"next"`
	Version  uint64   `json:"version"`
	Quiet    bool     `json:"quiet"`
	Locked   bool     `json:"locked"`
	Banned   []string `json:"banned"`
	People   []Kept   `json:"people"`
}

// Export describes the room for the server that will take it over.
func (r *Room) Export() Handed {
	s := Handed{Slug: r.slug, Private: r.settings.Private, Listed: r.settings.Listed, Country: r.settings.Country, Verifier: r.settings.verifier, NextPID: r.nextPID, Version: r.version, Quiet: r.quiet, Locked: r.locked}
	for origin := range r.banned {
		s.Banned = append(s.Banned, origin)
	}
	for m := r.occupied; m != 0; m &= m - 1 {
		p := r.slots[bits.TrailingZeros64(m)]
		s.People = append(s.People, Kept{ID: p.ID, Slot: p.Slot, Name: p.Name, Flags: p.Flags, Look: p.Look, Face: p.Face, Gen: p.Gen, SecretHash: p.secretHash, Origin: p.origin})
	}
	return s
}

// Restore rebuilds a room another server handed over: everyone in it is held as reconnecting until hold has passed, and whoever returns with their secret takes their place again.
func Restore(s Handed, cfg Config, now time.Time, hold time.Duration) (*Room, error) {
	slug, err := NewSlug(string(s.Slug))
	if err != nil {
		return nil, err
	}
	r, err := New(slug, cfg, Settings{Private: s.Private, Listed: s.Listed, Country: s.Country, verifier: s.Verifier}, now)
	if err != nil {
		return nil, err
	}
	if len(s.People) == 0 || len(s.People) > cfg.Capacity || hold <= 0 {
		return nil, port.NewError(port.CodeInvalidArgument, "a room handed over has people in it, no more than fit")
	}
	r.nextPID, r.version, r.quiet, r.locked, r.emptyAt = s.NextPID, s.Version+1, s.Quiet, s.Locked, time.Time{}
	for _, origin := range s.Banned {
		if origin != "" && len(r.banned) < maxBanned {
			if r.banned == nil {
				r.banned = map[string]struct{}{}
			}
			r.banned[origin] = struct{}{}
		}
	}
	for _, k := range s.People {
		name, err := cleanName(k.Name)
		if err != nil || k.ID == 0 || k.ID > s.NextPID || int(k.Slot) >= cfg.Capacity || r.slots[k.Slot] != nil || r.find(k.ID) != nil {
			return nil, port.NewError(port.CodeInvalidArgument, "a room handed over must be one this server could have built")
		}
		face, _ := NewFace(k.Face)
		r.slots[k.Slot] = &Participant{
			ID: k.ID, Slot: k.Slot, Name: name, State: StateReconnecting, Flags: k.Flags &^ FlagUnstable, Look: NewLook(string(k.Look)), Face: face, Gen: k.Gen,
			secretHash: k.SecretHash, origin: k.Origin, outsideSince: now, deadline: now.Add(hold),
		}
		r.occupied |= 1 << k.Slot
	}
	return r, nil
}
