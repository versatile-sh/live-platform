package room

import (
	"bytes"
	"image"
	"image/color"
	"image/gif"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func gifOf(t *testing.T, side, frames int) []byte {
	t.Helper()
	palette := color.Palette{color.Black, color.White}
	anim := &gif.GIF{}
	for range frames {
		anim.Image = append(anim.Image, image.NewPaletted(image.Rect(0, 0, side, side), palette))
		anim.Delay = append(anim.Delay, 5)
	}
	var out bytes.Buffer
	require.NoError(t, gif.EncodeAll(&out, anim))
	return out.Bytes()
}

func TestCheckPhotoGIF(t *testing.T) {
	good := gifOf(t, 64, 3)
	assert.NoError(t, CheckPhoto(good), "an animated GIF as an encoder writes it")
	assert.NoError(t, CheckPhoto(gifOf(t, 512, 1)))

	cut := func(n int) []byte { return good[:n] }
	changed := func(at int, to byte) []byte {
		b := bytes.Clone(good)
		b[at] = to
		return b
	}
	for name, bad := range map[string][]byte{
		"only the magic":                 []byte("GIF89a"),
		"cut in the middle":              cut(len(good) / 2),
		"no trailer":                     cut(len(good) - 1),
		"something after the trailer":    append(bytes.Clone(good), []byte("<script>alert(1)</script>")...),
		"a screen wider than allowed":    changed(7, 0x03),
		"a screen of no width":           append(append([]byte("GIF89a"), 0, 0, 1, 0, 0, 0, 0), 0x3B),
		"no frame at all":                append(append([]byte("GIF89a"), 1, 0, 1, 0, 0, 0, 0), 0x3B),
		"too many frames":                gifOf(t, 2, 121),
		"an unknown block":               append(append([]byte("GIF89a"), 1, 0, 1, 0, 0, 0, 0), 0x99, 0x3B),
		"a frame outside the screen":     append(append([]byte("GIF89a"), 1, 0, 1, 0, 0, 0, 0), 0x2C, 0, 0, 0, 0, 2, 0, 1, 0, 0, 2, 0, 0x3B),
		"markup that claims to be a GIF": []byte("GIF89a<svg onload=alert(1)>"),
		"over the size allowed":          append(bytes.Clone(good[:len(good)-1]), make([]byte, gifMaxBytes)...),
	} {
		assert.Error(t, CheckPhoto(bad), name)
	}
}

func FuzzCheckPhoto(f *testing.F) {
	f.Add([]byte("GIF89a"))
	f.Add([]byte{0xFF, 0xD8, 0xFF, 0xD9})
	f.Add(append(append([]byte("GIF89a"), 1, 0, 1, 0, 0x87, 0, 0), 0x2C, 0, 0, 0, 0, 1, 0, 1, 0, 0x80, 2, 0xFF))
	f.Fuzz(func(t *testing.T, b []byte) {
		_ = CheckPhoto(b)
	})
}
