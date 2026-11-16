package room

import (
	"bytes"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/versatile-sh/live/server/internal/domain/shared"
)

const (
	lookFaces   = 16
	lookColours = 8
	lookTurns   = 5
)

// Look is how a participant chose to appear when no camera shows them: a face, a colour and a tilt, packed in one word.
type Look uint16

// NewLook keeps a look whose face, colour and tilt all exist, and answers the plain one for anything else.
func NewLook(raw uint16) Look {
	face, colour, turn := raw&0xF, raw>>4&0x7, raw>>7
	if face >= lookFaces || colour >= lookColours || turn >= lookTurns {
		return 0
	}
	return Look(raw)
}

const (
	faceMaxRunes  = 12
	photoMaxBytes = 10 << 10
)

var jpegMagic = []byte{0xFF, 0xD8, 0xFF}

// NewFace accepts the few characters a participant typed to stand for their face, or nothing at all.
func NewFace(raw string) (string, error) {
	face := strings.TrimSpace(raw)
	if utf8.RuneCountInString(face) > faceMaxRunes || !utf8.ValidString(face) {
		return "", shared.NewDomainError(shared.ErrCodeInvalidArgument, "a face has at most 12 characters", nil)
	}
	for _, c := range face {
		if unicode.IsControl(c) || unicode.Is(unicode.Cf, c) || unicode.IsSpace(c) && c != ' ' {
			return "", shared.NewDomainError(shared.ErrCodeInvalidArgument, "a face must not contain control or invisible characters", nil)
		}
	}
	return face, nil
}

// CheckPhoto accepts a small JPEG to show in place of a face, or an empty one to take it away.
func CheckPhoto(jpeg []byte) error {
	if len(jpeg) == 0 {
		return nil
	}
	if len(jpeg) > photoMaxBytes || !bytes.HasPrefix(jpeg, jpegMagic) {
		return shared.NewDomainError(shared.ErrCodeInvalidArgument, "a photo is a JPEG of at most 10 KiB", nil)
	}
	return nil
}
