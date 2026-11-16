package room

import (
	"bytes"
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/versatile-sh/live/server/internal/domain/shared"
)

var lookShape = regexp.MustCompile(`^[0-9a-f]{6}-[0-9a-f]{6}-(\d{1,3})$`)

// Look is how a participant chose to appear when no camera shows them: the colour of the disc, the colour of the face on it, and its turn in degrees, as "rrggbb-rrggbb-deg".
type Look string

// NewLook keeps a look in the form "rrggbb-rrggbb-deg" with a turn below 360, and answers the plain one for anything else.
func NewLook(raw string) Look {
	m := lookShape.FindStringSubmatch(raw)
	if m == nil {
		return ""
	}
	if deg, err := strconv.Atoi(m[1]); err != nil || deg >= 360 {
		return ""
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
