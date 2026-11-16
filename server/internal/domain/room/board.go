package room

import (
	"encoding/json"

	"github.com/versatile-sh/live/server/internal/domain/shared"
)

const boardMaxBytes = 48 << 10

// BoardUpdate is a piece of the shared whiteboard as one participant's browser wrote it; the server relays it unread and keeps nothing.
type BoardUpdate struct {
	From PID
	To   PID
	Data string
}

// NewBoardData accepts a JSON object of at most 48 KiB as a piece of the whiteboard.
func NewBoardData(raw string) (string, error) {
	if len(raw) < 2 || len(raw) > boardMaxBytes || raw[0] != '{' || !json.Valid([]byte(raw)) {
		return "", shared.NewDomainError(shared.ErrCodeInvalidArgument, "a whiteboard update is a JSON object of at most 48 KiB", nil)
	}
	return raw, nil
}

// Draw addresses a whiteboard update from a participant who is in the room, to everyone else or to one other who is in it too; anything else reports false.
func (r *Room) Draw(from, to PID, data string) (BoardUpdate, bool) {
	if r.find(from) == nil || to == from || (to != 0 && r.find(to) == nil) {
		return BoardUpdate{}, false
	}
	return BoardUpdate{From: from, To: to, Data: data}, true
}
