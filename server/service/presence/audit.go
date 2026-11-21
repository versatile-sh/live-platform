package presence

import (
	"slices"
	"unicode/utf8"

	"github.com/versatile-sh/live/server/core/room"
	"github.com/versatile-sh/live/server/port/outbound"
)

func (a *actor) record(e outbound.AuditEvent) {
	summary := a.room.Summary()
	e.At = a.now().UTC()
	e.Room = string(summary.Slug)
	e.Private = summary.Private
	if e.Kind == outbound.AuditRoomCreated || e.Op == "listed" {
		listed := summary.Listed
		e.Listed = &listed
	}
	if e.Private {
		e.Text = ""
	}
	a.hub.audit.Record(e)
}

func (a *actor) recordChat(m room.ChatMessage) {
	e := outbound.AuditEvent{Kind: outbound.AuditChat, Actor: a.person(m.From), Length: utf8.RuneCountInString(m.Text), Text: m.Text, ImageBytes: len(m.Image)}
	if m.To != 0 {
		e.Target = a.person(m.To)
	}
	a.record(e)
}

func (a *actor) owned(err error, by room.PID, op string, target *outbound.AuditPerson) {
	if err != nil {
		return
	}
	a.record(outbound.AuditEvent{Kind: outbound.AuditOwner, Op: op, Actor: a.person(by), Target: target})
}

func (a *actor) target(pid room.PID) *outbound.AuditPerson {
	if pid == 0 {
		return nil
	}
	return a.person(pid)
}

func (a *actor) person(pid room.PID) *outbound.AuditPerson {
	person := outbound.AuditPerson{PID: uint32(pid)}
	if s := a.seats[pid]; s != nil {
		person.Name = s.name
	}
	return &person
}

func (a *actor) people() []outbound.AuditPerson {
	out := make([]outbound.AuditPerson, 0, len(a.seats))
	for pid, s := range a.seats {
		out = append(out, outbound.AuditPerson{PID: uint32(pid), Name: s.name})
	}
	slices.SortFunc(out, func(x, y outbound.AuditPerson) int { return int(x.PID) - int(y.PID) })
	return out
}
