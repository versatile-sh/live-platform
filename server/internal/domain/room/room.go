// Package room is the single authority on who is present in a room.
package room

import (
	"crypto/subtle"
	"math/bits"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/versatile-sh/live/server/internal/domain/shared"
)

// MaxCapacity is the widest room the slot bitmap can hold.
const MaxCapacity = 64

const nameMaxRunes = 40

// PID identifies a participant inside one room and is never reused.
type PID uint32

// Config holds the capacity and the presence timers of a room.
type Config struct {
	Capacity       int
	ConnectTimeout time.Duration
	Grace          time.Duration
	UnhealthyCap   time.Duration
	EmptyRelease   time.Duration
	PasswordTries  int
	PasswordWindow time.Duration
}

// DefaultConfig returns the capacity and timers agreed in ADR 0003 and ADR 0005.
func DefaultConfig() Config {
	return Config{
		Capacity:       10,
		ConnectTimeout: 15 * time.Second,
		Grace:          4 * time.Second,
		UnhealthyCap:   8 * time.Second,
		EmptyRelease:   30 * time.Second,
		PasswordTries:  10,
		PasswordWindow: 5 * time.Minute,
	}
}

// Participant is one browser tab present in a room.
type Participant struct {
	ID    PID
	Slot  uint8
	Name  string
	State State
	Flags Flags
	Look  Look
	Face  string
	Gen   uint32

	secretHash   [32]byte
	origin       string
	deadline     time.Time
	outsideSince time.Time
}

// Room owns every participant's state; nothing outside it decides presence.
const maxBanned = 64

type Room struct {
	slug     Slug
	cfg      Config
	settings Settings
	tries    int
	triesEnd time.Time
	slots    [MaxCapacity]*Participant
	occupied uint64
	nextPID  PID
	version  uint64
	emptyAt  time.Time
	banned   map[string]struct{}
}

// New creates an empty room that is released if nobody joins within the empty-release time.
func New(slug Slug, cfg Config, settings Settings, now time.Time) (*Room, error) {
	if err := settings.validate(); err != nil {
		return nil, err
	}
	if cfg.Capacity < 1 || cfg.Capacity > MaxCapacity {
		return nil, shared.NewDomainError(shared.ErrCodeInvalidArgument, "capacity must be between 1 and 64", nil)
	}
	if cfg.ConnectTimeout <= 0 || cfg.Grace <= 0 || cfg.UnhealthyCap < cfg.Grace || cfg.EmptyRelease <= 0 {
		return nil, shared.NewDomainError(shared.ErrCodeInvalidArgument, "timers must be positive and the cap no shorter than the grace", nil)
	}
	if cfg.PasswordTries < 1 || cfg.PasswordWindow <= 0 {
		return nil, shared.NewDomainError(shared.ErrCodeInvalidArgument, "password attempts need a positive limit and window", nil)
	}
	return &Room{slug: slug, cfg: cfg, settings: settings, emptyAt: now}, nil
}

// Slug returns the room's address.
func (r *Room) Slug() Slug { return r.slug }

// Version returns the roster version, which grows with every visible change.
func (r *Room) Version() uint64 { return r.version }

// Count returns how many participants hold a slot.
func (r *Room) Count() int { return bits.OnesCount64(r.occupied) }

// Roster returns a copy of every present participant, in slot order.
func (r *Room) Roster() []Participant {
	out := make([]Participant, 0, r.Count())
	for m := r.occupied; m != 0; m &= m - 1 {
		out = append(out, *r.slots[bits.TrailingZeros64(m)])
	}
	return out
}

// Join admits a participant in the connecting state, or refuses when the room is full.
func (r *Room) Join(now time.Time, name string, look Look, face string, secretHash [32]byte, owner bool) (Participant, []Event, error) {
	clean, err := cleanName(name)
	if err != nil {
		return Participant{}, nil, err
	}
	if r.Count() >= r.cfg.Capacity {
		return Participant{}, nil, shared.NewDomainError(shared.ErrCodeConflict, "room is full", nil)
	}
	slot := uint8(bits.TrailingZeros64(^r.occupied))
	r.nextPID++
	p := &Participant{
		ID: r.nextPID, Slot: slot, Name: clean, Look: look, Face: face, State: StateConnecting, Gen: 1,
		secretHash: secretHash, deadline: now.Add(r.cfg.ConnectTimeout),
	}
	r.slots[slot] = p
	r.occupied |= 1 << slot
	r.emptyAt = time.Time{}
	events := []Event{r.emit(EventJoined, p.ID, "")}
	if owner {
		events = append(events, r.giveOwnership(p)...)
	}
	return *p, events, nil
}

// MediaUp marks a participant active once its media path is up; a stale generation is ignored.
func (r *Room) MediaUp(pid PID, gen uint32) []Event {
	p := r.current(pid, gen)
	if p == nil || p.State == StateActive {
		return nil
	}
	p.State = StateActive
	p.Flags &^= FlagUnstable
	p.deadline = time.Time{}
	p.outsideSince = time.Time{}
	return []Event{r.emit(EventChanged, pid, "")}
}

// Suspect starts the grace of a participant whose connection looks lost; a stale generation is ignored.
func (r *Room) Suspect(now time.Time, pid PID, gen uint32) []Event {
	p := r.current(pid, gen)
	if p == nil || p.State == StateReconnecting {
		return nil
	}
	if p.outsideSince.IsZero() {
		p.outsideSince = now
	}
	p.State = StateReconnecting
	p.deadline = earliest(now.Add(r.cfg.Grace), p.outsideSince.Add(r.cfg.UnhealthyCap))
	return []Event{r.emit(EventChanged, pid, "")}
}

// Resume moves a participant to a new generation when the secret matches, without extending the unhealthy cap.
func (r *Room) Resume(now time.Time, pid PID, secretHash, nextSecretHash [32]byte) (Participant, []Event, error) {
	p := r.find(pid)
	if p == nil || subtle.ConstantTimeCompare(p.secretHash[:], secretHash[:]) != 1 {
		return Participant{}, nil, shared.NewDomainError(shared.ErrCodeNotFound, "participant not found", nil)
	}
	if p.outsideSince.IsZero() {
		p.outsideSince = now
	}
	p.Gen++
	p.secretHash = nextSecretHash
	p.State = StateConnecting
	p.deadline = earliest(now.Add(r.cfg.ConnectTimeout), p.outsideSince.Add(r.cfg.UnhealthyCap))
	return *p, []Event{r.emit(EventChanged, pid, "")}, nil
}

// SetMedia replaces the bits a participant controls about themselves.
func (r *Room) SetMedia(pid PID, flags Flags) []Event {
	p := r.find(pid)
	if p == nil {
		return nil
	}
	next := p.Flags&^MediaFlags | flags&MediaFlags
	if next == p.Flags {
		return nil
	}
	p.Flags = next
	return []Event{r.emit(EventChanged, pid, "")}
}

// SetLook changes how a participant appears: the colour and tilt, and the characters of their face.
func (r *Room) SetLook(pid PID, look Look, face string) []Event {
	p := r.find(pid)
	if p == nil || (p.Look == look && p.Face == face) {
		return nil
	}
	p.Look, p.Face = look, face
	return []Event{r.emit(EventChanged, pid, "")}
}

// SetUnstable labels an active participant whose first liveness signal was missed; a stale generation is ignored.
func (r *Room) SetUnstable(pid PID, gen uint32, unstable bool) []Event {
	p := r.current(pid, gen)
	if p == nil || p.State != StateActive || p.Flags.Has(FlagUnstable) == unstable {
		return nil
	}
	p.Flags ^= FlagUnstable
	return []Event{r.emit(EventChanged, pid, "")}
}

// Leave removes a participant at once, by their own will.
func (r *Room) Leave(now time.Time, pid PID) []Event {
	p := r.find(pid)
	if p == nil {
		return nil
	}
	return r.remove(now, p, ReasonLeft)
}

// Remove lets the owner remove another participant.
func (r *Room) Remove(now time.Time, by, target PID) ([]Event, error) {
	owner, p, err := r.ownerAnd(by, target)
	if err != nil {
		return nil, err
	}
	if owner == p {
		return nil, shared.NewDomainError(shared.ErrCodeInvalidArgument, "the owner leaves instead of removing themselves", nil)
	}
	return r.remove(now, p, ReasonRemoved), nil
}

// Ban lets the owner remove a participant and keep where they came from out of the room for as long as it exists; an origin the owner shares is only removed, so the owner is never locked out.
func (r *Room) Ban(now time.Time, by, target PID) ([]Event, error) {
	owner, p, err := r.ownerAnd(by, target)
	if err != nil {
		return nil, err
	}
	if owner == p {
		return nil, shared.NewDomainError(shared.ErrCodeInvalidArgument, "the owner leaves instead of banning themselves", nil)
	}
	if p.origin != "" && p.origin != owner.origin && len(r.banned) < maxBanned {
		if r.banned == nil {
			r.banned = map[string]struct{}{}
		}
		r.banned[p.origin] = struct{}{}
	}
	return r.remove(now, p, ReasonBanned), nil
}

// Admit refuses an origin the owner banned; an unknown origin is never refused.
func (r *Room) Admit(origin string) error {
	if _, banned := r.banned[origin]; banned && origin != "" {
		return shared.NewDomainError(shared.ErrCodeBanned, "the owner banned you from this room", nil)
	}
	return nil
}

// From records where a participant came from, so a ban can keep that origin out.
func (r *Room) From(pid PID, origin string) {
	if p := r.find(pid); p != nil {
		p.origin = origin
	}
}

// Transfer lets the owner hand the room to another participant.
func (r *Room) Transfer(by, target PID) ([]Event, error) {
	_, p, err := r.ownerAnd(by, target)
	if err != nil {
		return nil, err
	}
	return r.giveOwnership(p), nil
}

// Expire removes every participant whose deadline has passed.
func (r *Room) Expire(now time.Time) []Event {
	var events []Event
	for m := r.occupied; m != 0; m &= m - 1 {
		p := r.slots[bits.TrailingZeros64(m)]
		if p.deadline.IsZero() || now.Before(p.deadline) {
			continue
		}
		events = append(events, r.remove(now, p, r.expiryReason(now, p))...)
	}
	return events
}

// NextDeadline returns the earliest instant at which Expire or ReleaseDue changes its answer.
func (r *Room) NextDeadline() (time.Time, bool) {
	var next time.Time
	if !r.emptyAt.IsZero() {
		next = r.emptyAt.Add(r.cfg.EmptyRelease)
	}
	for m := r.occupied; m != 0; m &= m - 1 {
		d := r.slots[bits.TrailingZeros64(m)].deadline
		if !d.IsZero() && (next.IsZero() || d.Before(next)) {
			next = d
		}
	}
	return next, !next.IsZero()
}

// ReleaseDue reports whether the room stayed empty long enough to cease to exist.
func (r *Room) ReleaseDue(now time.Time) bool {
	return !r.emptyAt.IsZero() && !now.Before(r.emptyAt.Add(r.cfg.EmptyRelease))
}

func (r *Room) expiryReason(now time.Time, p *Participant) Reason {
	switch {
	case p.outsideSince.IsZero():
		return ReasonMediaTimeout
	case !now.Before(p.outsideSince.Add(r.cfg.UnhealthyCap)):
		return ReasonUnhealthyCap
	}
	return ReasonTimeout
}

func (r *Room) remove(now time.Time, p *Participant, reason Reason) []Event {
	wasOwner := p.Flags.Has(FlagOwner)
	r.slots[p.Slot] = nil
	r.occupied &^= 1 << p.Slot
	p.State = StateRemoved
	events := []Event{r.emit(EventRemoved, p.ID, reason)}
	if r.occupied == 0 {
		r.emptyAt = now
		return events
	}
	if wasOwner {
		events = append(events, r.giveOwnership(r.heir())...)
	}
	return events
}

func (r *Room) heir() *Participant {
	var heir *Participant
	for m := r.occupied; m != 0; m &= m - 1 {
		p := r.slots[bits.TrailingZeros64(m)]
		if heir == nil || rank(p) < rank(heir) {
			heir = p
		}
	}
	return heir
}

func rank(p *Participant) uint64 {
	inactive := uint64(1)
	if p.State == StateActive {
		inactive = 0
	}
	return inactive<<32 | uint64(p.ID)
}

func (r *Room) giveOwnership(to *Participant) []Event {
	var events []Event
	for m := r.occupied; m != 0; m &= m - 1 {
		p := r.slots[bits.TrailingZeros64(m)]
		if p != to && p.Flags.Has(FlagOwner) {
			p.Flags &^= FlagOwner
			events = append(events, r.emit(EventChanged, p.ID, ""))
		}
	}
	if !to.Flags.Has(FlagOwner) {
		to.Flags |= FlagOwner
		events = append(events, r.emit(EventChanged, to.ID, ""))
	}
	return events
}

func (r *Room) ownerAnd(by, target PID) (*Participant, *Participant, error) {
	if err := r.ownerOnly(by); err != nil {
		return nil, nil, err
	}
	owner := r.find(by)
	p := r.find(target)
	if p == nil {
		return nil, nil, shared.NewDomainError(shared.ErrCodeNotFound, "participant not found", nil)
	}
	return owner, p, nil
}

func (r *Room) find(pid PID) *Participant {
	for m := r.occupied; m != 0; m &= m - 1 {
		if p := r.slots[bits.TrailingZeros64(m)]; p.ID == pid {
			return p
		}
	}
	return nil
}

func (r *Room) current(pid PID, gen uint32) *Participant {
	if p := r.find(pid); p != nil && p.Gen == gen {
		return p
	}
	return nil
}

func (r *Room) emit(kind EventKind, pid PID, reason Reason) Event {
	r.version++
	return Event{Kind: kind, PID: pid, Version: r.version, Reason: reason}
}

func earliest(a, b time.Time) time.Time {
	if b.Before(a) {
		return b
	}
	return a
}

func cleanName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	n := utf8.RuneCountInString(name)
	if n < 1 || n > nameMaxRunes || !utf8.ValidString(name) {
		return "", shared.NewDomainError(shared.ErrCodeInvalidArgument, "name must have 1 to 40 characters", nil)
	}
	for _, c := range name {
		if unicode.IsControl(c) || unicode.Is(unicode.Cf, c) {
			return "", shared.NewDomainError(shared.ErrCodeInvalidArgument, "name must not contain control or invisible characters", nil)
		}
	}
	return name, nil
}
