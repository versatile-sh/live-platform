package presence

import (
	"time"

	"github.com/versatile-sh/live/server/internal/domain/room"
)

// HandedRoom is one room on its way from a server that is stopping to the one taking over, with the photos its people were showing.
type HandedRoom struct {
	Room   room.Handed         `json:"room"`
	Photos map[room.PID][]byte `json:"photos,omitempty"`
}

// Export describes every room that has people in it, for the server that takes over; a room too busy to answer in time is left out.
func (h *Hub) Export() []HandedRoom {
	h.mu.RLock()
	actors := make([]*actor, 0, len(h.actors))
	for _, a := range h.actors {
		actors = append(actors, a)
	}
	h.mu.RUnlock()
	var out []HandedRoom
	for _, a := range actors {
		reply := make(chan HandedRoom, 1)
		select {
		case a.inbox <- func(a *actor) { reply <- HandedRoom{Room: a.room.Export(), Photos: a.shots} }:
		default:
			continue
		}
		select {
		case handed := <-reply:
			if len(handed.Room.People) > 0 {
				out = append(out, handed)
			}
		case <-time.After(time.Second):
		}
	}
	return out
}

// Adopt takes over rooms another server handed on and holds each person's place for hold; a room whose name is already taken here, or that this server could not have built, is left out. It answers how many it took.
func (h *Hub) Adopt(rooms []HandedRoom, hold time.Duration) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	taken := 0
	now := h.now()
	for _, handed := range rooms {
		if h.actors[handed.Room.Slug] != nil {
			continue
		}
		r, err := room.Restore(handed.Room, h.cfg, now, hold)
		if err != nil {
			continue
		}
		a := newActor(h, r)
		a.founded = true
		for _, p := range r.Roster() {
			a.seats[p.ID] = &seat{gen: p.Gen, lastSeen: now, name: p.Name, joined: now}
			if photo := handed.Photos[p.ID]; room.CheckPhoto(photo) == nil && len(photo) > 0 {
				a.shots[p.ID] = photo
			}
		}
		h.actors[r.Slug()] = a
		go a.run()
		taken++
	}
	return taken
}
