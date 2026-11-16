package room

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
