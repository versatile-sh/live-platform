package room

import (
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/versatile-sh/live/server/port"
)

const chatMaxRunes = 500

// ChatMessage is one line a participant said to the room; the server relays it and keeps nothing.
type ChatMessage struct {
	From PID
	To   PID
	Name string
	Text string
	// Image is a small picture sent in place of, or with, the words: a GIF or a JPEG the room checked.
	Image []byte
	At    time.Time
}

// NewChatText accepts 1 to 500 characters of text, with line breaks but no other control or invisible character.
func NewChatText(raw string) (string, error) {
	text := strings.TrimSpace(raw)
	n := utf8.RuneCountInString(text)
	if n < 1 || n > chatMaxRunes || !utf8.ValidString(text) {
		return "", port.NewDomainError(port.ErrCodeInvalidArgument, "a message has 1 to 500 characters", nil)
	}
	for _, c := range text {
		if c != '\n' && (unicode.IsControl(c) || unicode.Is(unicode.Cf, c)) {
			return "", port.NewDomainError(port.ErrCodeInvalidArgument, "a message must not contain control or invisible characters", nil)
		}
	}
	return text, nil
}

// Say stamps a message from a participant who is in the room, to everyone or to one other participant who is in it too; anything else reports false.
func (r *Room) Say(now time.Time, from, to PID, text string, image []byte) (ChatMessage, bool) {
	p := r.find(from)
	if p == nil || to == from || (to != 0 && r.find(to) == nil) {
		return ChatMessage{}, false
	}
	if text == "" && len(image) == 0 {
		return ChatMessage{}, false
	}
	return ChatMessage{From: p.ID, To: to, Name: p.Name, Text: text, Image: image, At: now}, true
}
