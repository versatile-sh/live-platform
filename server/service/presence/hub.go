// Package presence runs one actor per room and routes every presence signal to it.
package presence

import (
	"cmp"
	"slices"
	"sync"
	"sync/atomic"
	"time"

	"github.com/versatile-sh/live/server/core/room"
	"github.com/versatile-sh/live/server/port"
	"github.com/versatile-sh/live/server/port/outbound"
)

const inboxSize = 256

// Liveness holds how long a participant may stay silent before being labelled and before being suspected.
type Liveness struct {
	UnstableAfter time.Duration
	SuspectAfter  time.Duration
}

// DefaultLiveness returns the silence thresholds the removal bound was measured with.
func DefaultLiveness() Liveness {
	return Liveness{UnstableAfter: 5 * time.Second, SuspectAfter: 12 * time.Second}
}

// Hub owns the set of live rooms; a slug is free whenever its room is not here.
type Hub struct {
	cfg      room.Config
	liveness Liveness
	now      func() time.Time
	media    outbound.MediaPlane
	audit    outbound.Audit
	joins    atomic.Uint64
	mu       sync.RWMutex
	actors   map[room.Slug]*actor
}

// NewHub builds a hub whose rooms share one configuration.
func NewHub(cfg room.Config, liveness Liveness, now func() time.Time) *Hub {
	return &Hub{cfg: cfg, liveness: liveness, now: now, audit: outbound.NoAudit{}, actors: map[room.Slug]*actor{}}
}

// UseAudit connects the audit trail; call it before the hub serves anyone. Without one, nothing is recorded.
func (h *Hub) UseAudit(audit outbound.Audit) { h.audit = audit }

// UseMedia connects the media plane; without one, participants never get a media path of their own.
func (h *Hub) UseMedia(plane outbound.MediaPlane) { h.media = plane }

// MediaSignal hands a participant's media signal to the media plane, which checks the connection it came from.
func (h *Hub) MediaSignal(slug room.Slug, pid room.PID, gen uint32, signal room.MediaSignal) {
	if h.media != nil {
		h.media.Signal(slug, pid, gen, signal)
	}
}

// Join seats a participant, creating the room when the slug is free; the first to arrive owns it.
func (h *Hub) Join(slug room.Slug, entry room.Entry, session outbound.Session) (room.Seat, error) {
	return ask(h, slug, &entry, func(a *actor) (room.Seat, error) { return a.join(entry, session) })
}

// Status returns what anyone may know about a room, or false and the room a claim would create when the slug is free.
func (h *Hub) Status(slug room.Slug) (room.Summary, bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	if a := h.actors[slug]; a != nil {
		return *a.summary.Load(), true
	}
	return room.Summary{Slug: slug, Capacity: h.cfg.Capacity}, false
}

// Lobby returns the listed rooms, fullest first.
func (h *Hub) Lobby() []room.Summary {
	h.mu.RLock()
	out := make([]room.Summary, 0, len(h.actors))
	for _, a := range h.actors {
		if s := *a.summary.Load(); s.Listed && s.Count > 0 {
			out = append(out, s)
		}
	}
	h.mu.RUnlock()
	slices.SortFunc(out, func(x, y room.Summary) int {
		return cmp.Or(cmp.Compare(y.Count, x.Count), cmp.Compare(x.Slug, y.Slug))
	})
	return out
}

// SetListed lets the owner show or hide a public room in the lobby.
func (h *Hub) SetListed(slug room.Slug, by room.PID, gen uint32, listed bool) error {
	return h.owner(slug, by, gen, func(a *actor) error {
		err := a.room.SetListed(by, listed)
		a.owned(err, by, "listed", nil)
		return err
	})
}

// SetPassword lets the owner make the room private with a new verifier, or public with none.
func (h *Hub) SetPassword(slug room.Slug, by room.PID, gen uint32, verifier *room.Verifier) error {
	return h.owner(slug, by, gen, func(a *actor) error {
		err := a.room.SetPassword(by, verifier)
		a.owned(err, by, "access", nil)
		return err
	})
}

func (h *Hub) owner(slug room.Slug, by room.PID, gen uint32, fn func(*actor) error) error {
	_, err := ask(h, slug, nil, func(a *actor) (struct{}, error) {
		if !a.holds(by, gen) {
			return struct{}{}, port.NewDomainError(port.ErrCodeNotFound, "participant not found", nil)
		}
		return struct{}{}, fn(a)
	})
	return err
}

// Resume gives a participant its place back on a new connection when the secret matches.
func (h *Hub) Resume(slug room.Slug, pid room.PID, secret [32]byte, session outbound.Session) (room.Seat, error) {
	return ask(h, slug, nil, func(a *actor) (room.Seat, error) { return a.resume(pid, secret, session) })
}

// Touch records that a participant's connection is alive.
func (h *Hub) Touch(slug room.Slug, pid room.PID, gen uint32) {
	h.tell(slug, func(a *actor) { a.touch(pid, gen) })
}

// Disconnected reports that a participant's connection ended without a leave.
func (h *Hub) Disconnected(slug room.Slug, pid room.PID, gen uint32) {
	h.tell(slug, func(a *actor) { a.suspect(pid, gen, "") })
}

// MediaUp reports that a participant's media path is established.
func (h *Hub) MediaUp(slug room.Slug, pid room.PID, gen uint32) {
	h.tell(slug, func(a *actor) { a.apply(a.room.MediaUp(pid, gen)) })
}

// MediaDown reports that a participant's media path failed.
func (h *Hub) MediaDown(slug room.Slug, pid room.PID, gen uint32) {
	h.tell(slug, func(a *actor) { a.suspect(pid, gen, "") })
}

// SetMedia records what a participant says it is sending.
func (h *Hub) SetMedia(slug room.Slug, pid room.PID, gen uint32, flags room.Flags) {
	h.tell(slug, func(a *actor) {
		if a.holds(pid, gen) {
			a.apply(a.room.SetMedia(pid, flags))
		}
	})
}

// SetLook changes how a participant appears to the room.
func (h *Hub) SetLook(slug room.Slug, pid room.PID, gen uint32, look room.Look, face string) {
	h.tell(slug, func(a *actor) {
		if a.holds(pid, gen) {
			a.apply(a.room.SetLook(pid, look, face))
		}
	})
}

// Board relays a piece of the whiteboard to everyone else in the room, or to one participant.
func (h *Hub) Board(slug room.Slug, pid room.PID, gen uint32, to room.PID, data string) {
	h.tell(slug, func(a *actor) { a.board(pid, gen, to, data) })
}

// SetPhoto shows a participant's photo to the room for as long as they are in it, or takes it away when empty.
func (h *Hub) SetPhoto(slug room.Slug, pid room.PID, gen uint32, jpeg []byte) {
	h.tell(slug, func(a *actor) { a.photo(pid, gen, jpeg) })
}

// Chat relays a line or a small picture a participant sent: to everyone in the room, or to one participant and back to the speaker.
func (h *Hub) Chat(slug room.Slug, pid room.PID, gen uint32, to room.PID, text string, image []byte) {
	h.tell(slug, func(a *actor) { a.chat(pid, gen, to, text, image) })
}

// Leave removes a participant at once.
func (h *Hub) Leave(slug room.Slug, pid room.PID, gen uint32) {
	h.tell(slug, func(a *actor) {
		if a.holds(pid, gen) {
			a.apply(a.room.Leave(a.now(), pid))
		}
	})
}

// Remove lets the owner remove another participant.
func (h *Hub) Remove(slug room.Slug, by room.PID, gen uint32, target room.PID) error {
	_, err := ask(h, slug, nil, func(a *actor) (struct{}, error) { return struct{}{}, a.remove(by, gen, target) })
	return err
}

// Ban lets the owner remove another participant and keep where they came from out of the room.
func (h *Hub) Ban(slug room.Slug, by room.PID, gen uint32, target room.PID) error {
	_, err := ask(h, slug, nil, func(a *actor) (struct{}, error) { return struct{}{}, a.ban(by, gen, target) })
	return err
}

// Quiet applies one of the owner's microphone decisions: mute everyone, give it back to everyone, mute one, or let one speak.
func (h *Hub) Quiet(slug room.Slug, by room.PID, gen uint32, op room.QuietOp, target room.PID) error {
	_, err := ask(h, slug, nil, func(a *actor) (struct{}, error) { return struct{}{}, a.quiet(by, gen, op, target) })
	return err
}

// Transfer lets the owner hand the room to another participant.
func (h *Hub) Transfer(slug room.Slug, by room.PID, gen uint32, target room.PID) error {
	_, err := ask(h, slug, nil, func(a *actor) (struct{}, error) { return struct{}{}, a.transfer(by, gen, target) })
	return err
}

// Stats counts the rooms, the people in them and every join since the hub started.
func (h *Hub) Stats() (rooms, people int, joins uint64) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, a := range h.actors {
		people += a.summary.Load().Count
	}
	return len(h.actors), people, h.joins.Load()
}

// Rooms returns how many rooms exist.
func (h *Hub) Rooms() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.actors)
}

func (h *Hub) tell(slug room.Slug, fn func(*actor)) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	a := h.actors[slug]
	if a == nil {
		return false
	}
	select {
	case a.inbox <- fn:
		return true
	default:
		return false
	}
}

func ask[T any](h *Hub, slug room.Slug, create *room.Entry, fn func(*actor) (T, error)) (T, error) {
	type reply struct {
		value T
		err   error
	}
	var zero T
	out := make(chan reply, 1)
	cmd := func(a *actor) {
		v, err := fn(a)
		out <- reply{v, err}
	}
	if !h.tell(slug, cmd) {
		if create == nil {
			return zero, port.NewDomainError(port.ErrCodeNotFound, "room not found or busy", nil)
		}
		if err := h.open(slug, *create, cmd); err != nil {
			return zero, err
		}
	}
	r := <-out
	return r.value, r.err
}

func (h *Hub) open(slug room.Slug, entry room.Entry, first func(*actor)) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	a := h.actors[slug]
	if a == nil {
		settings, err := entry.Settings()
		if err != nil {
			return err
		}
		r, err := room.New(slug, h.cfg, settings, h.now())
		if err != nil {
			return err
		}
		a = newActor(h, r)
		h.actors[slug] = a
		go a.run()
	}
	select {
	case a.inbox <- first:
		return nil
	default:
		return port.NewDomainError(port.ErrCodeConflict, "room is busy", nil)
	}
}

func (h *Hub) release(a *actor) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(a.inbox) > 0 {
		return false
	}
	delete(h.actors, a.room.Slug())
	return true
}
