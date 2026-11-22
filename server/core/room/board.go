package room

import (
	"encoding/json"

	"github.com/versatile-sh/live/server/port"
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
		return "", port.NewError(port.CodeInvalidArgument, "a whiteboard update is a JSON object of at most 48 KiB")
	}
	return raw, nil
}

// Draw addresses a whiteboard update from a participant who is in the room and may draw, to everyone else or to one other who is in it too;
// a participant who may not draw can still send the bare request for the current board, `{"k":"hello"}`, to everyone; anything else reports false.
func (r *Room) Draw(from, to PID, data string) (BoardUpdate, bool) {
	author := r.find(from)
	if author == nil || to == from || (to != 0 && r.find(to) == nil) {
		return BoardUpdate{}, false
	}
	if author.Flags.Has(FlagNoDraw) && (to != 0 || !isBoardHello(data)) {
		return BoardUpdate{}, false
	}
	return BoardUpdate{From: from, To: to, Data: data}, true
}

func isBoardHello(data string) bool {
	var fields map[string]json.RawMessage
	if json.Unmarshal([]byte(data), &fields) != nil || len(fields) != 1 {
		return false
	}
	var kind string
	return json.Unmarshal(fields["k"], &kind) == nil && kind == "hello"
}
