package room

import "github.com/versatile-sh/live/server/port"

const (
	slugMinLen = 2
	slugMaxLen = 40
)

var reservedSlugs = map[string]struct{}{
	"api": {}, "ws": {}, "up": {}, "assets": {}, "lobby": {}, "static": {},
	"favicon.ico": {}, "robots.txt": {}, "new": {}, "about": {}, "docs": {}, "privacy": {},
}

// Slug is the name a person chooses for a room and its address.
type Slug string

// NewSlug accepts 2 to 40 lowercase letters, digits and inner hyphens that are not a reserved path.
func NewSlug(raw string) (Slug, error) {
	if len(raw) < slugMinLen || len(raw) > slugMaxLen {
		return "", port.NewError(port.CodeInvalidArgument, "slug must have 2 to 40 characters")
	}
	for i := 0; i < len(raw); i++ {
		c := raw[i]
		alnum := (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')
		inner := i > 0 && i < len(raw)-1
		if !alnum && !(c == '-' && inner && raw[i-1] != '-') {
			return "", port.NewError(port.CodeInvalidArgument, "slug allows lowercase letters, digits and single inner hyphens")
		}
	}
	if _, reserved := reservedSlugs[raw]; reserved {
		return "", port.NewError(port.CodeInvalidArgument, "slug is reserved")
	}
	return Slug(raw), nil
}
