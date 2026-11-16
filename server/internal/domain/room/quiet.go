package room

import (
	"math/bits"

	"github.com/versatile-sh/live/server/internal/domain/shared"
)

// QuietOp names what the owner decides about who may speak and who may draw.
type QuietOp string

// The ways the owner mutes and gives the microphone back.
const (
	QuietAll   QuietOp = "mute-all"
	QuietNone  QuietOp = "unmute-all"
	QuietOne   QuietOp = "mute"
	QuietAllow QuietOp = "allow"
	DrawLock   QuietOp = "lock-board"
	DrawFree   QuietOp = "unlock-board"
	DrawDeny   QuietOp = "draw-deny"
	DrawAllow  QuietOp = "draw-allow"
)

// Quiet applies one of the owner's microphone decisions.
func (r *Room) Quiet(op QuietOp, by, target PID) ([]Event, error) {
	switch op {
	case QuietAll:
		return r.MuteAll(by)
	case QuietNone:
		return r.UnmuteAll(by)
	case QuietOne:
		return r.Mute(by, target)
	case QuietAllow:
		return r.Allow(by, target)
	case DrawLock, DrawFree:
		return r.lockBoard(by, op == DrawLock)
	case DrawDeny, DrawAllow:
		return r.letDraw(by, target, op == DrawAllow)
	}
	return nil, shared.NewDomainError(shared.ErrCodeInvalidArgument, "unknown microphone decision", nil)
}

// MuteAll lets the owner silence everyone else: their microphones go off and stay off until the owner lets each one speak, and whoever arrives later arrives muted.
func (r *Room) MuteAll(by PID) ([]Event, error) {
	if err := r.ownerOnly(by); err != nil {
		return nil, err
	}
	events := r.each(func(p *Participant) Flags {
		if p.Flags.Has(FlagOwner) {
			return p.Flags
		}
		return p.Flags&^FlagMicrophone | FlagMuted
	})
	return r.hush(true, by, events), nil
}

// UnmuteAll lets the owner give the microphone back to everyone; nobody's microphone is turned on for them.
func (r *Room) UnmuteAll(by PID) ([]Event, error) {
	if err := r.ownerOnly(by); err != nil {
		return nil, err
	}
	return r.hush(false, by, r.each(func(p *Participant) Flags { return p.Flags &^ FlagMuted })), nil
}

// Mute lets the owner silence one participant.
func (r *Room) Mute(by, target PID) ([]Event, error) {
	owner, p, err := r.ownerAnd(by, target)
	if err != nil {
		return nil, err
	}
	if owner == p {
		return nil, shared.NewDomainError(shared.ErrCodeInvalidArgument, "the owner is not muted by the room", nil)
	}
	return r.reflag(p, p.Flags&^FlagMicrophone|FlagMuted), nil
}

// Allow lets the owner give one participant the microphone back and lowers the hand they asked with.
func (r *Room) Allow(by, target PID) ([]Event, error) {
	_, p, err := r.ownerAnd(by, target)
	if err != nil {
		return nil, err
	}
	return r.reflag(p, p.Flags&^(FlagMuted|FlagHand)), nil
}

// Hushed reports whether the owner muted the room, so that whoever arrives is muted too.
func (r *Room) Hushed() bool { return r.quiet }

func (r *Room) hush(quiet bool, by PID, events []Event) []Event {
	if r.quiet != quiet && len(events) == 0 {
		events = append(events, r.emit(EventChanged, by, ""))
	}
	r.quiet = quiet
	return events
}

// Locked reports whether the owner kept the whiteboard to themselves and to those they let draw.
func (r *Room) Locked() bool { return r.locked }

func (r *Room) lockBoard(by PID, locked bool) ([]Event, error) {
	if err := r.ownerOnly(by); err != nil {
		return nil, err
	}
	events := r.each(func(p *Participant) Flags {
		if locked && !p.Flags.Has(FlagOwner) {
			return p.Flags | FlagNoDraw
		}
		return p.Flags &^ FlagNoDraw
	})
	if r.locked != locked && len(events) == 0 {
		events = append(events, r.emit(EventChanged, by, ""))
	}
	r.locked = locked
	return events, nil
}

func (r *Room) letDraw(by, target PID, allowed bool) ([]Event, error) {
	owner, p, err := r.ownerAnd(by, target)
	if err != nil {
		return nil, err
	}
	if owner == p {
		return nil, shared.NewDomainError(shared.ErrCodeInvalidArgument, "the owner always draws", nil)
	}
	if allowed {
		return r.reflag(p, p.Flags&^FlagNoDraw), nil
	}
	return r.reflag(p, p.Flags|FlagNoDraw), nil
}

// Silenced lists the participants whose microphone the room does not carry.
func (r *Room) Silenced() []PID {
	var out []PID
	for m := r.occupied; m != 0; m &= m - 1 {
		if p := r.slots[bits.TrailingZeros64(m)]; p.Flags.Has(FlagMuted) {
			out = append(out, p.ID)
		}
	}
	return out
}

func (r *Room) each(change func(*Participant) Flags) []Event {
	var events []Event
	for m := r.occupied; m != 0; m &= m - 1 {
		p := r.slots[bits.TrailingZeros64(m)]
		events = append(events, r.reflag(p, change(p))...)
	}
	return events
}

func (r *Room) reflag(p *Participant, next Flags) []Event {
	if next == p.Flags {
		return nil
	}
	p.Flags = next
	return []Event{r.emit(EventChanged, p.ID, "")}
}
