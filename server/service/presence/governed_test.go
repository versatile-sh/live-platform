package presence

import (
	"testing"

	"github.com/versatile-sh/live/server/core/room"
	"github.com/versatile-sh/live/server/port"
	"github.com/versatile-sh/live/server/port/inbound"
	"github.com/versatile-sh/live/server/port/outbound"
)

type denyPolicy struct {
	outbound.AllowAll
	act    outbound.Act
	source room.Flags
}

func (d denyPolicy) Decide(a outbound.Ask) outbound.Verdict {
	if a.Act == d.act && (d.source == 0 || a.Source == d.source) {
		return outbound.Verdict{Reason: "limit.reached"}
	}
	return outbound.Verdict{Allowed: true}
}

type recorder struct {
	inbound.Presence
	joined int
	flags  room.Flags
}

func (r *recorder) Join(room.Slug, room.Entry, outbound.Session) (room.Seat, error) {
	r.joined++
	return room.Seat{}, nil
}

func (r *recorder) SetMedia(_ room.Slug, _ room.PID, _ uint32, f room.Flags) { r.flags = f }

type liveness bool

func (l liveness) Status(s room.Slug) (room.Summary, bool) { return room.Summary{Slug: s}, bool(l) }
func (liveness) Lobby() []room.Summary                     { return nil }

func TestGovernedJoin(t *testing.T) {
	cases := []struct {
		name   string
		live   bool
		deny   outbound.Act
		joined int
	}{
		{"allow all creates", false, 0, 1},
		{"create denied on a free slug", false, outbound.ActCreateRoom, 0},
		{"create rule ignored for a live room", true, outbound.ActCreateRoom, 1},
		{"admit denied", true, outbound.ActAdmit, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := &recorder{}
			g := Governed{Presence: rec, Rooms: liveness(c.live), Policy: denyPolicy{act: c.deny}}
			_, err := g.Join("demo", room.Entry{}, nil)
			if rec.joined != c.joined {
				t.Fatalf("joined %d, want %d", rec.joined, c.joined)
			}
			if c.joined == 0 && port.CodeOf(err) != port.ErrCodePermissionDenied {
				t.Fatalf("error %v, want PERMISSION_DENIED", err)
			}
		})
	}
}

func TestGovernedSetMediaDropsDeniedSource(t *testing.T) {
	rec := &recorder{}
	g := Governed{Presence: rec, Rooms: liveness(true), Policy: denyPolicy{act: outbound.ActStartSource, source: room.FlagScreen}}
	g.SetMedia("demo", 1, 1, room.FlagMicrophone|room.FlagScreen|room.FlagHand)
	if want := room.FlagMicrophone | room.FlagHand; rec.flags != want {
		t.Fatalf("flags %b, want %b", rec.flags, want)
	}
}
