// Package presence runs one actor per room and routes every presence signal to it.
package presence

import (
	"sync"
	"time"

	"github.com/versatile-sh/live/server/internal/domain/room"
	"github.com/versatile-sh/live/server/internal/domain/shared"
	"github.com/versatile-sh/live/server/internal/ports/outbound"
)

const inboxSize = 256

// Liveness holds how long a participant may stay silent before being labelled and before being suspected.
type Liveness struct {
	UnstableAfter time.Duration
	SuspectAfter  time.Duration
}

// DefaultLiveness returns the silence thresholds measured in spike S1.
func DefaultLiveness() Liveness {
	return Liveness{UnstableAfter: 5 * time.Second, SuspectAfter: 12 * time.Second}
}

// Hub owns the set of live rooms; a slug is free whenever its room is not here.
type Hub struct {
	cfg      room.Config
	liveness Liveness
	now      func() time.Time
	mu       sync.RWMutex
	actors   map[room.Slug]*actor
}

// NewHub builds a hub whose rooms share one configuration.
func NewHub(cfg room.Config, liveness Liveness, now func() time.Time) *Hub {
	return &Hub{cfg: cfg, liveness: liveness, now: now, actors: map[room.Slug]*actor{}}
}

// Join seats a participant, creating the room when the slug is free; the first to arrive owns it.
func (h *Hub) Join(slug room.Slug, name string, session outbound.Session) (room.Seat, error) {
	return ask(h, slug, true, func(a *actor) (room.Seat, error) { return a.join(name, session) })
}

// Resume gives a participant its place back on a new connection when the secret matches.
func (h *Hub) Resume(slug room.Slug, pid room.PID, secret [32]byte, session outbound.Session) (room.Seat, error) {
	return ask(h, slug, false, func(a *actor) (room.Seat, error) { return a.resume(pid, secret, session) })
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
	_, err := ask(h, slug, false, func(a *actor) (struct{}, error) { return struct{}{}, a.remove(by, gen, target) })
	return err
}

// Transfer lets the owner hand the room to another participant.
func (h *Hub) Transfer(slug room.Slug, by room.PID, gen uint32, target room.PID) error {
	_, err := ask(h, slug, false, func(a *actor) (struct{}, error) { return struct{}{}, a.transfer(by, gen, target) })
	return err
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

func ask[T any](h *Hub, slug room.Slug, create bool, fn func(*actor) (T, error)) (T, error) {
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
		if !create {
			return zero, shared.NewDomainError(shared.ErrCodeNotFound, "room not found or busy", nil)
		}
		if err := h.open(slug, cmd); err != nil {
			return zero, err
		}
	}
	r := <-out
	return r.value, r.err
}

func (h *Hub) open(slug room.Slug, first func(*actor)) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	a := h.actors[slug]
	if a == nil {
		r, err := room.New(slug, h.cfg, h.now())
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
		return shared.NewDomainError(shared.ErrCodeConflict, "room is busy", nil)
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
