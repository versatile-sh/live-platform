package room

import (
	"bytes"
	"encoding/binary"
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/versatile-sh/live/server/port"
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
	gifMaxBytes   = 90 << 10
	gifMaxSide    = 512
	gifMaxFrames  = 120
)

var (
	jpegMagic = []byte{0xFF, 0xD8, 0xFF}
	jpegEnd   = []byte{0xFF, 0xD9}
	gif87     = []byte("GIF87a")
	gif89     = []byte("GIF89a")
	errPhoto  = port.NewError(port.CodeInvalidArgument, "a photo is a JPEG of at most 10 KiB or a GIF of at most 90 KiB")
)

// NewFace accepts the few characters a participant typed to stand for their face, or nothing at all.
func NewFace(raw string) (string, error) {
	face := strings.TrimSpace(raw)
	if utf8.RuneCountInString(face) > faceMaxRunes || !utf8.ValidString(face) {
		return "", port.NewError(port.CodeInvalidArgument, "a face has at most 12 characters")
	}
	for _, c := range face {
		if unicode.IsControl(c) || unicode.Is(unicode.Cf, c) || unicode.IsSpace(c) && c != ' ' {
			return "", port.NewError(port.CodeInvalidArgument, "a face must not contain control or invisible characters")
		}
	}
	return face, nil
}

// CheckPhoto accepts a small JPEG or a small, well-formed GIF to show in place of a face, or an empty one to take it away. The kind is read from the bytes, never from what the sender says it is.
func CheckPhoto(photo []byte) error {
	switch {
	case len(photo) == 0:
		return nil
	case bytes.HasPrefix(photo, jpegMagic):
		if len(photo) <= photoMaxBytes && bytes.HasSuffix(photo, jpegEnd) {
			return nil
		}
	case bytes.HasPrefix(photo, gif87) || bytes.HasPrefix(photo, gif89):
		if len(photo) <= gifMaxBytes && wellFormedGIF(photo) {
			return nil
		}
	}
	return errPhoto
}

func wellFormedGIF(b []byte) bool {
	if len(b) < 13 {
		return false
	}
	width, height := int(binary.LittleEndian.Uint16(b[6:])), int(binary.LittleEndian.Uint16(b[8:]))
	if width < 1 || height < 1 || width > gifMaxSide || height > gifMaxSide {
		return false
	}
	at := 13 + colourTable(b[10])
	skipBlocks := func() bool {
		for at < len(b) {
			n := int(b[at])
			at += 1 + n
			if n == 0 {
				return at <= len(b)
			}
		}
		return false
	}
	frames := 0
	for at < len(b) {
		switch b[at] {
		case 0x3B:
			return frames > 0 && at == len(b)-1
		case 0x21:
			at += 2
			if !skipBlocks() {
				return false
			}
		case 0x2C:
			if at+10 > len(b) {
				return false
			}
			x, y := int(binary.LittleEndian.Uint16(b[at+1:])), int(binary.LittleEndian.Uint16(b[at+3:]))
			w, h := int(binary.LittleEndian.Uint16(b[at+5:])), int(binary.LittleEndian.Uint16(b[at+7:]))
			frames++
			if w < 1 || h < 1 || x+w > width || y+h > height || frames > gifMaxFrames {
				return false
			}
			at += 10 + colourTable(b[at+9])
			if at >= len(b) || b[at] < 2 || b[at] > 8 {
				return false
			}
			at++
			if !skipBlocks() {
				return false
			}
		default:
			return false
		}
	}
	return false
}

func colourTable(flags byte) int {
	if flags&0x80 == 0 {
		return 0
	}
	return 3 << ((flags & 7) + 1)
}
