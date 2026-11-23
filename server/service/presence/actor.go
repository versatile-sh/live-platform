package presence

import (
	"crypto/rand"
	"crypto/sha256"
	"strings"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/versatile-sh/live/server/core/room"
	"github.com/versatile-sh/live/server/port"
	"github.com/versatile-sh/live/server/port/outbound"
)

const (
	pictureEvery   = 2 * time.Second
	wireBacklogMax = 1024
	wireRetryEvery = 100 * time.Millisecond
	troubleBurst   = 5
	troubleRate    = 0.2
	troubleDetail  = 256
	boardRate      = 256 << 10
	boardBurst     = 1 << 20
)

type seat struct {
	session  outbound.Session
	gen      uint32
	lastSeen time.Time
	online   bool
	name     string
	joined   time.Time
	traceID  string
	spanID   string
	board    bucket
	troubles bucket
}

type actor struct {
	hub      *Hub
	room     *room.Room
	seats    map[room.PID]*seat
	inbox    chan func(*actor)
	gone     []room.Departure
	shots    map[room.PID][]byte
	wires    chan func()
	backlog  []wireOp
	retry    bool
	silent   map[room.PID]bool
	pictured map[room.PID]time.Time
	born     time.Time
	founded  bool

	summary atomic.Pointer[room.Summary]
}

type wireOp struct {
	run    func()
	detach bool
}

func newActor(h *Hub, r *room.Room) *actor {
	a := &actor{hub: h, room: r, seats: map[room.PID]*seat{}, shots: map[room.PID][]byte{}, inbox: make(chan func(*actor), inboxSize), born: h.now()}
	a.publish()
	if h.media != nil {
		wires := make(chan func(), inboxSize)
		a.wires = wires
		go func() {
			for op := range wires {
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
		a.mend()
		a.publish()
		if a.room.ReleaseDue(a.now()) && a.hub.release(a) {
			a.record(outbound.AuditEvent{Kind: outbound.AuditRoomEnded, DurationMS: a.now().Sub(a.born).Milliseconds()})
			if a.wires != nil {
				for _, op := range a.backlog {
					a.wires <- op.run
				}
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
	if a.retry || len(a.backlog) > 0 {
		if retry := now.Add(wireRetryEvery); !ok || retry.Before(wake) {
			wake, ok = retry, true
		}
	}
	if !ok {
		return time.Hour
	}
	return max(wake.Sub(now), time.Millisecond)
}

func (a *actor) join(entry room.Entry, session outbound.Session) (room.Seat, error) {
	if err := a.room.Admit(entry.Origin); err != nil {
		return room.Seat{}, err
	}
	if err := a.room.Authorize(a.now(), entry.Origin, entry.Proof); err != nil {
		return room.Seat{}, err
	}
	secret, err := newSecret()
	if err != nil {
		return room.Seat{}, err
	}
	present := a.people()
	p, events, err := a.room.Join(a.now(), entry.Name, entry.Look, entry.Face, sha256.Sum256(secret[:]), a.room.Count() == 0)
	if err != nil {
		return room.Seat{}, err
	}
	a.room.From(p.ID, entry.Origin)
	a.seats[p.ID] = &seat{session: session, gen: p.Gen, lastSeen: a.now(), online: true, name: p.Name, joined: a.now(), traceID: entry.TraceID, spanID: entry.SpanID}
	a.hub.joins.Add(1)
	client := entry.Client
	who := &outbound.AuditPerson{PID: uint32(p.ID), Name: p.Name}
	if !a.founded {
		a.founded = true
		a.record(outbound.AuditEvent{Kind: outbound.AuditRoomCreated, Actor: who, Client: &client, TraceID: entry.TraceID, SpanID: entry.SpanID})
	}
	a.record(outbound.AuditEvent{Kind: outbound.AuditJoin, Actor: who, Client: &client, Look: string(entry.Look), Present: present, TraceID: entry.TraceID, SpanID: entry.SpanID})
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
	s.session, s.gen, s.lastSeen, s.online = session, p.Gen, a.now(), true
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
		return port.NewError(port.CodeNotFound, "participant not found")
	}
	named := a.target(target)
	events, err := a.room.Remove(a.now(), by, target)
	a.apply(events)
	a.owned(err, by, "remove", named)
	return err
}

func (a *actor) ban(by room.PID, gen uint32, target room.PID) error {
	if !a.holds(by, gen) {
		return port.NewError(port.CodeNotFound, "participant not found")
	}
	named := a.target(target)
	events, kept, err := a.room.Ban(a.now(), by, target)
	a.apply(events)
	a.owned(err, by, "ban", named)
	if err == nil && !kept {
		return port.NewError(CodeBanNotKept, "the participant was removed but the ban could not be kept, so they can come back")
	}
	return err
}

func (a *actor) quiet(by room.PID, gen uint32, op room.QuietOp, target room.PID) error {
	if !a.holds(by, gen) {
		return port.NewError(port.CodeNotFound, "participant not found")
	}
	named := a.target(target)
	events, err := a.room.Quiet(op, by, target)
	a.apply(events)
	a.owned(err, by, string(op), named)
	return err
}

func (a *actor) hush() {
	if a.wires == nil {
		return
	}
	now := map[room.PID]bool{}
	for _, pid := range a.room.Silenced() {
		now[pid] = true
	}
	if a.silent == nil {
		a.silent = map[room.PID]bool{}
	}
	slug, plane := a.room.Slug(), a.hub.media
	a.retry = false
	for pid := range a.seats {
		if now[pid] == a.silent[pid] {
			continue
		}
		silent := now[pid]
		if a.enqueue(wireOp{run: func() { plane.Silence(slug, pid, silent) }}) {
			a.silent[pid] = silent
		} else {
			a.retry = true
		}
	}
	for pid := range a.silent {
		if a.seats[pid] == nil {
			delete(a.silent, pid)
		}
	}
}

func (a *actor) mend() {
	if a.wires == nil {
		return
	}
	a.flush()
	if a.retry {
		a.hush()
	}
}

func (a *actor) flush() {
	for len(a.backlog) > 0 {
		select {
		case a.wires <- a.backlog[0].run:
			a.backlog[0] = wireOp{}
			a.backlog = a.backlog[1:]
		default:
			return
		}
	}
	a.backlog = nil
}

func (a *actor) enqueue(op wireOp) bool {
	if len(a.backlog) == 0 {
		select {
		case a.wires <- op.run:
			return true
		default:
		}
	}
	if len(a.backlog) >= wireBacklogMax && !op.detach {
		a.hub.mediaDrops.Add(1)
		return false
	}
	a.backlog = append(a.backlog, op)
	return true
}

func (a *actor) transfer(by room.PID, gen uint32, target room.PID) error {
	if !a.holds(by, gen) {
		return port.NewError(port.CodeNotFound, "participant not found")
	}
	named := a.target(target)
	events, err := a.room.Transfer(by, target)
	a.apply(events)
	a.owned(err, by, "transfer", named)
	return err
}

func (a *actor) chat(pid room.PID, gen uint32, to room.PID, text string, image []byte) {
	if !a.holds(pid, gen) {
		return
	}
	if len(image) > 0 {
		if room.CheckPhoto(image) != nil || a.now().Sub(a.pictured[pid]) < pictureEvery {
			return
		}
		if a.pictured == nil {
			a.pictured = map[room.PID]time.Time{}
		}
		a.pictured[pid] = a.now()
	}
	message, ok := a.room.Say(a.now(), pid, to, text, image)
	if !ok {
		return
	}
	a.recordChat(message)
	var slow []room.PID
	for id, s := range a.seats {
		if to != 0 && id != to && id != pid {
			continue
		}
		if s.online && !s.session.Chat(message) {
			slow = append(slow, id)
		}
	}
	for _, id := range slow {
		a.suspect(id, a.seats[id].gen, room.CloseSlow)
	}
}

func (a *actor) board(pid room.PID, gen uint32, to room.PID, data string) {
	if !a.holds(pid, gen) {
		return
	}
	update, ok := a.room.Draw(pid, to, data)
	if !ok || !a.seats[pid].board.take(a.now(), float64(len(data)), boardRate, boardBurst) {
		return
	}
	for id, s := range a.seats {
		if id == pid || (to != 0 && id != to) {
			continue
		}
		if s.online {
			s.session.Board(update)
		}
	}
}

func (a *actor) wire(pid room.PID, gen uint32, session outbound.Session) {
	if a.wires == nil {
		return
	}
	slug, plane, silent := a.room.Slug(), a.hub.media, a.silent[pid]
	a.enqueue(wireOp{run: func() {
		plane.Attach(slug, pid, gen, session.Media)
		plane.Silence(slug, pid, silent)
	}})
}

func (a *actor) unwire(pid room.PID) {
	if a.wires == nil {
		return
	}
	slug, plane := a.room.Slug(), a.hub.media
	a.enqueue(wireOp{run: func() { plane.Detach(slug, pid) }, detach: true})
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

func (a *actor) trouble(pid room.PID, gen uint32, trouble room.MediaTrouble, browser bool, detail string) {
	s := a.seats[pid]
	if s == nil || s.gen != gen {
		return
	}
	if !s.troubles.take(a.now(), 1, troubleRate, troubleBurst) {
		return
	}
	a.hub.troubles.Report(outbound.MediaTroubleEvent{At: a.now(), Room: string(a.room.Slug()), PID: uint32(pid), Trouble: string(trouble), Browser: browser, Detail: clip(detail, troubleDetail), TraceID: s.traceID, SpanID: s.spanID})
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
		if s := a.seats[e.PID]; s != nil {
			a.record(outbound.AuditEvent{Kind: outbound.AuditLeave, Actor: &outbound.AuditPerson{PID: uint32(e.PID), Name: s.name}, Reason: string(e.Reason), DurationMS: a.now().Sub(s.joined).Milliseconds(), TraceID: s.traceID, SpanID: s.spanID})
		}
		if s := a.seats[e.PID]; s != nil && s.online {
			switch e.Reason {
			case room.ReasonLeft:
			case room.ReasonRemoved:
				s.session.Close(room.CloseRemoved)
			case room.ReasonBanned:
				s.session.Close(room.CloseBanned)
			default:
				s.session.Close(room.CloseSilent)
			}
		}
		delete(a.seats, e.PID)
		delete(a.shots, e.PID)
		delete(a.pictured, e.PID)
		a.unwire(e.PID)
	}
	a.broadcast()
}

func (a *actor) broadcast() {
	a.hush()
	summary := a.room.Summary()
	snapshot := room.Snapshot{Version: a.room.Version(), Participants: a.room.Roster(), Gone: a.gone, Quiet: a.room.Hushed(), Locked: a.room.Locked(), Private: summary.Private, Listed: summary.Listed}
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
		return s, port.WrapError(port.CodeInvariantViolation, "no entropy for a secret", err)
	}
	return s, nil
}

func clip(text string, limit int) string {
	if len(text) <= limit {
		return text
	}
	cut := text[:limit]
	for !utf8.ValidString(cut) && len(cut) > 0 {
		cut = cut[:len(cut)-1]
	}
	return strings.TrimSpace(cut)
}
