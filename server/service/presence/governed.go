package presence

import (
	"github.com/versatile-sh/live/server/core/room"
	"github.com/versatile-sh/live/server/port"
	"github.com/versatile-sh/live/server/port/inbound"
	"github.com/versatile-sh/live/server/port/outbound"
)

const sources = room.FlagMicrophone | room.FlagCamera | room.FlagScreen | room.FlagScreenAudio

// Governed asks a policy before a room is created, someone is admitted or a source starts.
type Governed struct {
	inbound.Presence
	Rooms  inbound.Directory
	Policy outbound.Policy
}

// Join refuses with PERMISSION_DENIED and the policy's reason when creating or entering is not allowed.
func (g Governed) Join(slug room.Slug, entry room.Entry, session outbound.Session) (room.Seat, error) {
	if _, live := g.Rooms.Status(slug); !live {
		if v := g.Policy.Decide(outbound.Ask{Act: outbound.ActCreateRoom, Slug: slug}); !v.Allowed {
			return room.Seat{}, port.NewDomainError(port.ErrCodePermissionDenied, v.Reason, nil)
		}
	}
	if v := g.Policy.Decide(outbound.Ask{Act: outbound.ActAdmit, Slug: slug}); !v.Allowed {
		return room.Seat{}, port.NewDomainError(port.ErrCodePermissionDenied, v.Reason, nil)
	}
	return g.Presence.Join(slug, entry, session)
}

// SetMedia drops every source flag the policy does not allow and passes the rest on.
func (g Governed) SetMedia(slug room.Slug, pid room.PID, gen uint32, flags room.Flags) {
	for bit := room.Flags(1); bit != 0 && bit <= sources; bit <<= 1 {
		if flags&bit&sources != 0 && !g.Policy.Decide(outbound.Ask{Act: outbound.ActStartSource, Slug: slug, Source: bit}).Allowed {
			flags &^= bit
		}
	}
	g.Presence.SetMedia(slug, pid, gen, flags)
}
