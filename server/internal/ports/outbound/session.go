// Package outbound holds the contracts the application needs from the outside.
package outbound

import "github.com/versatile-sh/live/server/internal/domain/room"

// Session is one participant's connection as the room sees it.
type Session interface {
	// Roster queues a snapshot without blocking and reports false when the connection cannot keep up.
	Roster(snapshot room.Snapshot) bool
	// Chat queues a message without blocking and reports false when the connection cannot keep up.
	Chat(message room.ChatMessage) bool
	// Photo queues a participant's photo, or its removal when empty, without blocking.
	Photo(pid room.PID, jpeg []byte)
	// Media queues a media signal without blocking; one that cannot be queued is dropped and the media path will time out.
	Media(signal room.MediaSignal)
	// Close ends the connection with the reason the participant is shown.
	Close(reason room.CloseReason)
}
