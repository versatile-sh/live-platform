package presence

import (
	"crypto/rand"
	"crypto/sha256"
	"sync/atomic"
	"time"

	"github.com/versatile-sh/live/server/internal/domain/room"
	"github.com/versatile-sh/live/server/internal/domain/shared"
	"github.com/versatile-sh/live/server/internal/ports/outbound"
)

type seat struct {
	session  outbound.Session
	gen      uint32
	lastSeen time.Time
	online   bool
}

type actor struct {
	hub   *Hub
	room  *room.Room
	seats map[room.PID]*seat
	inbox chan func(*actor)
	gone  []room.Departure
	shots map[room.PID][]byte
	wires chan func()

	summary atomic.Pointer[room.Summary]
}

func newActor(h *Hub, r *room.Room) *actor {
	a := &actor{hub: h, room: r, seats: map[room.PID]*seat{}, shots: map[room.PID][]byte{}, inbox: make(chan func(*actor), inboxSize)}
	a.publish()
	if h.media != nil {
		a.wires = make(chan func(), inboxSize)
		go func() {
			for op := range a.wires {
				op()
			}
		}()
	}
	return a
}

func (a *actor) now() time.Time { return a.hub.now() }

func (a *actor) publish() {
	s := a.room.Summary()
	a.summary.Store(&s)
}

func (a *actor) run() {
	timer := time.NewTimer(time.Hour)
	defer timer.Stop()
	for {
		a.sweep()
		a.publish()
		if a.room.ReleaseDue(a.now()) && a.hub.release(a) {
			if a.wires != nil {
				close(a.wires)
			}
			return
		}
		timer.Reset(a.untilNextWake())
		select {
		case cmd := <-a.inbox:
			cmd(a)
		case <-timer.C:
		}
	}
}

func (a *actor) sweep() {
	now := a.now()
	for pid, s := range a.seats {
		if !s.online {
			continue
		}
		silent := now.Sub(s.lastSeen)
		switch {
		case silent >= a.hub.liveness.SuspectAfter:
			a.suspect(pid, s.gen, room.CloseSilent)
		case silent >= a.hub.liveness.UnstableAfter:
			a.apply(a.room.SetUnstable(pid, s.gen, true))
		}
	}
	a.apply(a.room.Expire(now))
}

func (a *actor) untilNextWake() time.Duration {
	now := a.now()
	wake, ok := a.room.NextDeadline()
	for _, s := range a.seats {
		if !s.online {
			continue
		}
		at := s.lastSeen.Add(a.hub.liveness.SuspectAfter)
		if unstable := s.lastSeen.Add(a.hub.liveness.UnstableAfter); unstable.After(now) {
			at = unstable
		}
		if !ok || at.Before(wake) {
			wake, ok = at, true
		}
	}
	if !ok {
		return time.Hour
	}
	return max(wake.Sub(now), time.Millisecond)
}

func (a *actor) join(entry room.Entry, session outbound.Session) (room.Seat, error) {
	if err := a.room.Authorize(a.now(), entry.Proof); err != nil {
		return room.Seat{}, err
	}
	secret, err := newSecret()
	if err != nil {
		return room.Seat{}, err
	}
	p, events, err := a.room.Join(a.now(), entry.Name, entry.Look, entry.Face, sha256.Sum256(secret[:]), a.room.Count() == 0)
	if err != nil {
		return room.Seat{}, err
	}
	a.seats[p.ID] = &seat{session: session, gen: p.Gen, lastSeen: a.now(), online: true}
	a.apply(events)
	a.showPhotos(session)
	a.wire(p.ID, p.Gen, session)
	return room.Seat{PID: p.ID, Gen: p.Gen, Secret: secret}, nil
}

func (a *actor) resume(pid room.PID, secret [32]byte, session outbound.Session) (room.Seat, error) {
	next, err := newSecret()
	if err != nil {
		return room.Seat{}, err
	}
	p, events, err := a.room.Resume(a.now(), pid, sha256.Sum256(secret[:]), sha256.Sum256(next[:]))
	if err != nil {
		return room.Seat{}, err
	}
	s := a.seats[pid]
	if s.online {
		s.session.Close(room.CloseSuperseded)
	}
	*s = seat{session: session, gen: p.Gen, lastSeen: a.now(), online: true}
	a.apply(events)
	a.showPhotos(session)
	a.wire(p.ID, p.Gen, session)
	return room.Seat{PID: p.ID, Gen: p.Gen, Secret: next}, nil
}

func (a *actor) touch(pid room.PID, gen uint32) {
	if !a.holds(pid, gen) {
		return
	}
	a.seats[pid].lastSeen = a.now()
	a.apply(a.room.SetUnstable(pid, gen, false))
}

func (a *actor) suspect(pid room.PID, gen uint32, closing room.CloseReason) {
	if !a.holds(pid, gen) {
		return
	}
	s := a.seats[pid]
	if s.online {
		s.online = false
		if closing != "" {
			s.session.Close(closing)
		}
	}
	a.apply(a.room.Suspect(a.now(), pid, gen))
}

func (a *actor) remove(by room.PID, gen uint32, target room.PID) error {
	if !a.holds(by, gen) {
		return shared.NewDomainError(shared.ErrCodeNotFound, "participant not found", nil)
	}
	events, err := a.room.Remove(a.now(), by, target)
	a.apply(events)
	return err
}

func (a *actor) transfer(by room.PID, gen uint32, target room.PID) error {
	if !a.holds(by, gen) {
		return shared.NewDomainError(shared.ErrCodeNotFound, "participant not found", nil)
	}
	events, err := a.room.Transfer(by, target)
	a.apply(events)
	return err
}

func (a *actor) chat(pid room.PID, gen uint32, text string) {
	if !a.holds(pid, gen) {
		return
	}
	message, ok := a.room.Say(a.now(), pid, text)
	if !ok {
		return
	}
	var slow []room.PID
	for id, s := range a.seats {
		if s.online && !s.session.Chat(message) {
			slow = append(slow, id)
		}
	}
	for _, id := range slow {
		a.suspect(id, a.seats[id].gen, room.CloseSlow)
	}
}

func (a *actor) wire(pid room.PID, gen uint32, session outbound.Session) {
	if a.wires == nil {
		return
	}
	slug, plane := a.room.Slug(), a.hub.media
	select {
	case a.wires <- func() { plane.Attach(slug, pid, gen, session.Media) }:
	default:
	}
}

func (a *actor) unwire(pid room.PID) {
	if a.wires == nil {
		return
	}
	slug, plane := a.room.Slug(), a.hub.media
	select {
	case a.wires <- func() { plane.Detach(slug, pid) }:
	default:
	}
}

func (a *actor) photo(pid room.PID, gen uint32, jpeg []byte) {
	if !a.holds(pid, gen) || room.CheckPhoto(jpeg) != nil {
		return
	}
	if len(jpeg) == 0 {
		delete(a.shots, pid)
	} else {
		a.shots[pid] = jpeg
	}
	for _, s := range a.seats {
		if s.online {
			s.session.Photo(pid, jpeg)
		}
	}
}

func (a *actor) showPhotos(session outbound.Session) {
	for pid, jpeg := range a.shots {
		session.Photo(pid, jpeg)
	}
}

func (a *actor) holds(pid room.PID, gen uint32) bool {
	s := a.seats[pid]
	return s != nil && s.gen == gen
}

func (a *actor) apply(events []room.Event) {
	if len(events) == 0 {
		return
	}
	for _, e := range events {
		if e.Kind != room.EventRemoved {
			continue
		}
		a.gone = append(a.gone, room.Departure{PID: e.PID, Reason: e.Reason})
		if s := a.seats[e.PID]; s != nil && s.online {
			switch e.Reason {
			case room.ReasonLeft:
			case room.ReasonRemoved:
				s.session.Close(room.CloseRemoved)
			default:
				s.session.Close(room.CloseSilent)
			}
		}
		delete(a.seats, e.PID)
		delete(a.shots, e.PID)
		a.unwire(e.PID)
	}
	a.broadcast()
}

func (a *actor) broadcast() {
	snapshot := room.Snapshot{Version: a.room.Version(), Participants: a.room.Roster(), Gone: a.gone}
	a.gone = nil
	var slow []room.PID
	for pid, s := range a.seats {
		if s.online && !s.session.Roster(snapshot) {
			slow = append(slow, pid)
		}
	}
	for _, pid := range slow {
		a.suspect(pid, a.seats[pid].gen, room.CloseSlow)
	}
}

func newSecret() ([32]byte, error) {
	var s [32]byte
	if _, err := rand.Read(s[:]); err != nil {
		return s, shared.NewDomainError(shared.ErrCodeInvariantViolation, "no entropy for a secret", err)
	}
	return s, nil
}
