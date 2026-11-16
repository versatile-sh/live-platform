package room

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/versatile-sh/live/server/internal/domain/shared"
)

var t0 = time.Date(2026, 11, 16, 12, 0, 0, 0, time.UTC)

func at(seconds float64) time.Time {
	return t0.Add(time.Duration(seconds * float64(time.Second)))
}

func secret(b byte) [32]byte { return [32]byte{b} }

func newRoom(t *testing.T) *Room {
	t.Helper()
	r, err := New("bk", DefaultConfig(), Settings{}, t0)
	require.NoError(t, err)
	return r
}

func joinActive(t *testing.T, r *Room, name string, owner bool) Participant {
	t.Helper()
	p, _, err := r.Join(t0, name, "", "", secret(byte(len(name))), owner)
	require.NoError(t, err)
	r.MediaUp(p.ID, p.Gen)
	return p
}

func state(r *Room, pid PID) State {
	for _, p := range r.Roster() {
		if p.ID == pid {
			return p.State
		}
	}
	return StateRemoved
}

func TestSlug(t *testing.T) {
	cases := map[string]bool{
		"bk": true, "daily-sync": true, "a1": true, "x": false, "-bk": false, "bk-": false,
		"b--k": false, "BK": false, "sala da ana": false, "api": false, "ws": false,
		"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa": false, "café": false,
	}
	for raw, ok := range cases {
		_, err := NewSlug(raw)
		assert.Equal(t, ok, err == nil, raw)
	}
}

func TestJoin(t *testing.T) {
	t.Run("admits in connecting with a deadline for media", func(t *testing.T) {
		r := newRoom(t)
		p, events, err := r.Join(t0, "  Ana  ", "", "", secret(1), false)
		require.NoError(t, err)
		assert.Equal(t, "Ana", p.Name)
		assert.Equal(t, StateConnecting, p.State)
		assert.Equal(t, []Event{{Kind: EventJoined, PID: p.ID, Version: 1}}, events)
		next, ok := r.NextDeadline()
		assert.True(t, ok)
		assert.Equal(t, at(15), next)
	})
	t.Run("rejects names that are empty, too long or carry control characters", func(t *testing.T) {
		r := newRoom(t)
		for _, name := range []string{"", "   ", "a‮b", "a\nb", string(make([]rune, 41))} {
			_, _, err := r.Join(t0, name, "", "", secret(1), false)
			assert.Equal(t, shared.ErrCodeInvalidArgument, shared.CodeOf(err), "%q", name)
		}
		assert.Zero(t, r.Count())
	})
	t.Run("refuses when the room is full and reuses the slot but never the id", func(t *testing.T) {
		cfg := DefaultConfig()
		cfg.Capacity = 2
		r, err := New("bk", cfg, Settings{}, t0)
		require.NoError(t, err)
		a, _, _ := r.Join(t0, "a", "", "", secret(1), false)
		_, _, _ = r.Join(t0, "b", "", "", secret(2), false)
		_, _, err = r.Join(t0, "c", "", "", secret(3), false)
		assert.Equal(t, shared.ErrCodeConflict, shared.CodeOf(err))
		r.Leave(t0, a.ID)
		c, _, err := r.Join(t0, "c", "", "", secret(3), false)
		require.NoError(t, err)
		assert.Equal(t, a.Slot, c.Slot)
		assert.NotEqual(t, a.ID, c.ID)
	})
}

func TestRemovalBound(t *testing.T) {
	cases := []struct {
		name    string
		drive   func(r *Room, p Participant)
		alive   float64
		removed float64
		reason  Reason
	}{
		{
			name:  "never brings media up",
			drive: func(r *Room, p Participant) {},
			alive: 14.9, removed: 15, reason: ReasonMediaTimeout,
		},
		{
			name: "suspected and never resumes",
			drive: func(r *Room, p Participant) {
				r.MediaUp(p.ID, p.Gen)
				r.Suspect(at(10), p.ID, p.Gen)
			},
			alive: 13.9, removed: 14, reason: ReasonTimeout,
		},
		{
			name: "resumes over a live socket but media never returns",
			drive: func(r *Room, p Participant) {
				r.MediaUp(p.ID, p.Gen)
				r.Suspect(at(10), p.ID, p.Gen)
				for i, s := range []float64{11, 13, 15, 17} {
					q, _, err := r.Resume(at(s), p.ID, secret(byte(1+i)), secret(byte(2+i)))
					if err != nil {
						return
					}
					r.Suspect(at(s+1), q.ID, q.Gen)
				}
			},
			alive: 17.9, removed: 18, reason: ReasonUnhealthyCap,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := newRoom(t)
			p, _, err := r.Join(t0, "ana", "", "", secret(1), false)
			require.NoError(t, err)
			c.drive(r, p)
			assert.Empty(t, r.Expire(at(c.alive)))
			events := r.Expire(at(c.removed))
			require.Len(t, events, 1)
			assert.Equal(t, EventRemoved, events[0].Kind)
			assert.Equal(t, c.reason, events[0].Reason)
			assert.Zero(t, r.Count())
		})
	}
}

func TestResume(t *testing.T) {
	t.Run("returns to active within the grace under a new generation", func(t *testing.T) {
		r := newRoom(t)
		p := joinActive(t, r, "ana", false)
		r.Suspect(at(10), p.ID, p.Gen)
		q, _, err := r.Resume(at(12), p.ID, secret(3), secret(9))
		require.NoError(t, err)
		assert.Equal(t, p.Gen+1, q.Gen)
		r.MediaUp(q.ID, q.Gen)
		assert.Equal(t, StateActive, state(r, p.ID))
		assert.Empty(t, r.Expire(at(3600)))
	})
	t.Run("ignores signals from the generation it replaced", func(t *testing.T) {
		r := newRoom(t)
		p := joinActive(t, r, "ana", false)
		q, _, err := r.Resume(at(1), p.ID, secret(3), secret(9))
		require.NoError(t, err)
		r.MediaUp(q.ID, q.Gen)
		assert.Empty(t, r.Suspect(at(2), p.ID, p.Gen))
		assert.Empty(t, r.SetUnstable(p.ID, p.Gen, true))
		assert.Equal(t, StateActive, state(r, p.ID))
	})
	t.Run("refuses a wrong secret, a rotated secret and a removed participant", func(t *testing.T) {
		r := newRoom(t)
		p := joinActive(t, r, "ana", false)
		_, _, err := r.Resume(at(1), p.ID, secret(7), secret(9))
		assert.Equal(t, shared.ErrCodeNotFound, shared.CodeOf(err))
		_, _, err = r.Resume(at(1), p.ID, secret(3), secret(9))
		require.NoError(t, err)
		_, _, err = r.Resume(at(2), p.ID, secret(3), secret(9))
		assert.Equal(t, shared.ErrCodeNotFound, shared.CodeOf(err))
		r.Leave(at(3), p.ID)
		_, _, err = r.Resume(at(4), p.ID, secret(9), secret(9))
		assert.Equal(t, shared.ErrCodeNotFound, shared.CodeOf(err))
	})
}

func TestFlags(t *testing.T) {
	r := newRoom(t)
	p := joinActive(t, r, "ana", true)
	assert.Len(t, r.SetMedia(p.ID, FlagMicrophone|FlagScreen|FlagOwner|FlagUnstable), 1)
	got := r.Roster()[0].Flags
	assert.True(t, got.Has(FlagMicrophone|FlagScreen|FlagOwner))
	assert.False(t, got.Has(FlagUnstable), "a participant cannot label itself")
	assert.Empty(t, r.SetMedia(p.ID, FlagMicrophone|FlagScreen), "no event without a change")
	assert.Len(t, r.SetMedia(p.ID, 0), 1)
	assert.True(t, r.Roster()[0].Flags.Has(FlagOwner), "clearing media keeps ownership")
	assert.Len(t, r.SetUnstable(p.ID, p.Gen, true), 1)
	assert.Empty(t, r.SetUnstable(p.ID, p.Gen, true))
	r.Suspect(at(1), p.ID, p.Gen)
	q, _, _ := r.Resume(at(2), p.ID, secret(3), secret(9))
	r.MediaUp(q.ID, q.Gen)
	assert.False(t, r.Roster()[0].Flags.Has(FlagUnstable), "returning to active clears the label")
}

func TestOwnership(t *testing.T) {
	t.Run("passes to the longest-present active participant when the owner goes", func(t *testing.T) {
		r := newRoom(t)
		owner := joinActive(t, r, "o", true)
		stuck, _, _ := r.Join(t0, "st", "", "", secret(2), false)
		heir := joinActive(t, r, "hei", false)
		joinActive(t, r, "late", false)
		r.Leave(at(1), owner.ID)
		for _, p := range r.Roster() {
			assert.Equal(t, p.ID == heir.ID, p.Flags.Has(FlagOwner), p.Name)
		}
		assert.NotEqual(t, stuck.ID, heir.ID)
	})
	t.Run("only the active owner removes and transfers", func(t *testing.T) {
		r := newRoom(t)
		owner := joinActive(t, r, "o", true)
		guest := joinActive(t, r, "gu", false)
		_, err := r.Remove(at(1), guest.ID, owner.ID)
		assert.Equal(t, shared.ErrCodeInvariantViolation, shared.CodeOf(err))
		_, err = r.Remove(at(1), owner.ID, owner.ID)
		assert.Equal(t, shared.ErrCodeInvalidArgument, shared.CodeOf(err))
		_, err = r.Remove(at(1), owner.ID, 99)
		assert.Equal(t, shared.ErrCodeNotFound, shared.CodeOf(err))
		_, err = r.Transfer(owner.ID, guest.ID)
		require.NoError(t, err)
		_, err = r.Transfer(owner.ID, guest.ID)
		assert.Equal(t, shared.ErrCodeInvariantViolation, shared.CodeOf(err))
		events, err := r.Remove(at(1), guest.ID, owner.ID)
		require.NoError(t, err)
		assert.Equal(t, ReasonRemoved, events[0].Reason)
	})
}

func TestRelease(t *testing.T) {
	r := newRoom(t)
	assert.False(t, r.ReleaseDue(at(29.9)))
	assert.True(t, r.ReleaseDue(at(30)), "a room nobody entered is released too")
	p := joinActive(t, r, "ana", false)
	assert.False(t, r.ReleaseDue(at(3600)))
	_, ok := r.NextDeadline()
	assert.False(t, ok, "an occupied healthy room has nothing pending")
	r.Leave(at(100), p.ID)
	next, ok := r.NextDeadline()
	assert.True(t, ok)
	assert.Equal(t, at(130), next)
	assert.False(t, r.ReleaseDue(at(129.9)))
	assert.True(t, r.ReleaseDue(at(130)))
}

func TestRosterVersionGrowsByOnePerEvent(t *testing.T) {
	r := newRoom(t)
	var all []Event
	a, e, _ := r.Join(t0, "a", "", "", secret(1), true)
	all = append(all, e...)
	all = append(all, r.MediaUp(a.ID, a.Gen)...)
	b, e, _ := r.Join(t0, "b", "", "", secret(2), false)
	all = append(all, e...)
	all = append(all, r.Suspect(at(1), b.ID, b.Gen)...)
	all = append(all, r.Leave(at(2), a.ID)...)
	all = append(all, r.Expire(at(60))...)
	for i, ev := range all {
		assert.Equal(t, uint64(i+1), ev.Version)
	}
	assert.Equal(t, uint64(len(all)), r.Version())
}

func TestPrivateRoom(t *testing.T) {
	right, wrong := Verifier{1}, Verifier{2}
	settings, err := NewSettings(&right, false, "BR")
	require.NoError(t, err)
	r, err := New("bk", DefaultConfig(), settings, t0)
	require.NoError(t, err)

	t.Run("admits only the holder of the password", func(t *testing.T) {
		assert.NoError(t, r.Authorize(t0, &right))
		assert.Equal(t, shared.ErrCodePermissionDenied, shared.CodeOf(r.Authorize(t0, nil)))
		assert.Equal(t, shared.ErrCodePermissionDenied, shared.CodeOf(r.Authorize(t0, &wrong)))
	})
	t.Run("locks after ten wrong proofs, even for the right one, until the window ends", func(t *testing.T) {
		for i := 0; i < 9; i++ {
			_ = r.Authorize(at(1), &wrong)
		}
		assert.Equal(t, shared.ErrCodeRateLimited, shared.CodeOf(r.Authorize(at(2), &right)))
		assert.Equal(t, shared.ErrCodeRateLimited, shared.CodeOf(r.Authorize(at(299), &wrong)))
		assert.NoError(t, r.Authorize(at(300), &right))
	})
	t.Run("asking without a proof does not spend an attempt", func(t *testing.T) {
		for i := 0; i < 50; i++ {
			_ = r.Authorize(at(600), nil)
		}
		assert.NoError(t, r.Authorize(at(601), &right))
	})
}

func TestSettings(t *testing.T) {
	v := Verifier{1}
	listedPrivate, err := NewSettings(&v, true, "")
	require.NoError(t, err, "a private room may be listed")
	assert.True(t, listedPrivate.Private && listedPrivate.Listed)
	for country, ok := range map[string]bool{"": true, "BR": true, "br": false, "BRA": false, "B1": false} {
		_, err := NewSettings(nil, true, country)
		assert.Equal(t, ok, err == nil, country)
	}

	settings, _ := NewSettings(nil, true, "BR")
	r, err := New("bk", DefaultConfig(), settings, t0)
	require.NoError(t, err)
	owner := joinActive(t, r, "o", true)
	guest := joinActive(t, r, "gu", false)
	assert.Equal(t, Summary{Slug: "bk", Listed: true, Country: "BR", Count: 2, Capacity: 10}, r.Summary())
	assert.Equal(t, shared.ErrCodeInvariantViolation, shared.CodeOf(r.SetListed(guest.ID, false)))
	assert.Equal(t, shared.ErrCodeInvariantViolation, shared.CodeOf(r.SetPassword(guest.ID, &v)))
	require.NoError(t, r.SetPassword(owner.ID, &v))
	assert.True(t, r.Summary().Private)
	assert.True(t, r.Summary().Listed, "a password does not change whether the room is listed")
	require.NoError(t, r.SetListed(owner.ID, false))
	assert.False(t, r.Summary().Listed)
	require.NoError(t, r.SetPassword(owner.ID, nil))
	require.NoError(t, r.SetListed(owner.ID, true))
	assert.Equal(t, Summary{Slug: "bk", Listed: true, Country: "BR", Count: 2, Capacity: 10}, r.Summary())
}

func TestLook(t *testing.T) {
	for raw, want := range map[string]Look{"c6f432-0e1116-45": "c6f432-0e1116-45", "ffffff-000000-359": "ffffff-000000-359", "c6f432-0e1116-360": "", "C6F432-0e1116-0": "", "red-blue-0": "", "": "", "c6f432-0e1116-45;x": ""} {
		assert.Equal(t, want, NewLook(raw), raw)
	}
	r := newRoom(t)
	p, _, err := r.Join(t0, "ana", NewLook("c6f432-0e1116-45"), "(•‿•)", secret(1), false)
	require.NoError(t, err)
	assert.Equal(t, "(•‿•)", r.Roster()[0].Face)
	assert.Len(t, r.SetLook(p.ID, NewLook("ffffff-000000-90"), "^_^"), 1)
	assert.Empty(t, r.SetLook(p.ID, NewLook("ffffff-000000-90"), "^_^"), "no event without a change")
	assert.Equal(t, Look("ffffff-000000-90"), r.Roster()[0].Look)
}

func TestSay(t *testing.T) {
	r := newRoom(t)
	ana := joinActive(t, r, "ana", false)
	bia := joinActive(t, r, "bia", false)
	toAll, ok := r.Say(t0, ana.ID, 0, "hi", nil)
	require.True(t, ok)
	assert.Zero(t, toAll.To)
	private, ok := r.Say(t0, ana.ID, bia.ID, "psst", nil)
	require.True(t, ok)
	assert.Equal(t, bia.ID, private.To)
	for _, to := range []PID{ana.ID, 99} {
		_, ok := r.Say(t0, ana.ID, to, "x", nil)
		assert.False(t, ok)
	}
	_, ok = r.Say(t0, 99, 0, "x", nil)
	assert.False(t, ok)
	_, ok = r.Say(t0, ana.ID, 0, "", nil)
	assert.False(t, ok, "nothing to say and nothing to show is no message")
	shown, ok := r.Say(t0, ana.ID, 0, "", []byte("GIF89a"))
	require.True(t, ok, "a picture alone is a message")
	assert.Equal(t, []byte("GIF89a"), shown.Image)
}

func TestFaceAndPhoto(t *testing.T) {
	for raw, want := range map[string]string{"  (•‿•) ": "(•‿•)", "": "", "¯\\_(ツ)_/¯": "¯\\_(ツ)_/¯", "ಠ_ಠ": "ಠ_ಠ"} {
		got, err := NewFace(raw)
		require.NoError(t, err, raw)
		assert.Equal(t, want, got)
	}
	for _, raw := range []string{"thirteen chars", "a\nb", "a\u202eb", "tab\there"} {
		_, err := NewFace(raw)
		assert.Error(t, err, "%q", raw)
	}
	assert.NoError(t, CheckPhoto(nil))
	assert.NoError(t, CheckPhoto([]byte{0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 0xFF, 0xD9}))
	assert.Error(t, CheckPhoto([]byte{0xFF, 0xD8, 0xFF, 0xE0, 1, 2}), "a JPEG that does not end as one")
	assert.Error(t, CheckPhoto([]byte("<svg onload=alert(1)>")))
	assert.Error(t, CheckPhoto(append([]byte{0xFF, 0xD8, 0xFF}, make([]byte, 10<<10)...)))
}

func TestBan(t *testing.T) {
	r := newRoom(t)
	ana := joinActive(t, r, "ana", true)
	bia := joinActive(t, r, "bia", false)
	caio := joinActive(t, r, "caio", false)
	r.From(bia.ID, "office")
	_, err := r.Ban(t0, bia.ID, caio.ID)
	assert.Error(t, err, "only the owner bans")
	_, err = r.Ban(t0, ana.ID, ana.ID)
	assert.Error(t, err, "the owner cannot ban themselves")
	events, err := r.Ban(t0, ana.ID, bia.ID)
	require.NoError(t, err)
	require.Len(t, events, 1)
	assert.Equal(t, ReasonBanned, events[0].Reason)
	assert.Error(t, r.Admit("office"))
	assert.NoError(t, r.Admit("home"))
	assert.NoError(t, r.Admit(""), "an unknown origin is never refused")
	_, err = r.Ban(t0, ana.ID, caio.ID)
	require.NoError(t, err, "someone of unknown origin is removed all the same")
	dani := joinActive(t, r, "dani", false)
	r.From(ana.ID, "home")
	r.From(dani.ID, "home")
	_, err = r.Ban(t0, ana.ID, dani.ID)
	require.NoError(t, err)
	assert.NoError(t, r.Admit("home"), "an origin shared with the owner is never barred")
	assert.NoError(t, r.Admit(""))
}

func TestBoardFlag(t *testing.T) {
	r := newRoom(t)
	ana := joinActive(t, r, "ana", true)
	require.Len(t, r.SetMedia(ana.ID, FlagBoard|FlagOwner|FlagUnstable), 1)
	got := r.Roster()[0].Flags
	assert.True(t, got.Has(FlagBoard), "a participant says they opened the whiteboard")
	assert.Equal(t, Flags(128), FlagBoard)
	assert.False(t, got.Has(FlagUnstable), "and still cannot set what only the server sets")
}
