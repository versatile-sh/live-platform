package room

import (
	"crypto/sha256"
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHandover(t *testing.T) {
	verifier := Verifier{1, 2, 3}
	settings, err := NewSettings(&verifier, true, "BR")
	require.NoError(t, err)
	old, err := New("bk", DefaultConfig(), settings, t0)
	require.NoError(t, err)
	anaSecret, biaSecret := sha256.Sum256([]byte("ana")), sha256.Sum256([]byte("bia"))
	ana, _, err := old.Join(t0, "ana", NewLook("c6f432-0e1116-45"), "^_^", anaSecret, true)
	require.NoError(t, err)
	old.MediaUp(ana.ID, ana.Gen)
	bia, _, err := old.Join(t0, "bia", "", "", biaSecret, false)
	require.NoError(t, err)
	old.MediaUp(bia.ID, bia.Gen)
	caio, _, err := old.Join(t0, "caio", "", "", sha256.Sum256([]byte("caio")), false)
	require.NoError(t, err)
	old.MediaUp(caio.ID, caio.Gen)
	old.From(caio.ID, "office")
	_, err = old.Ban(t0, ana.ID, caio.ID)
	require.NoError(t, err)
	_, err = old.MuteAll(ana.ID)
	require.NoError(t, err)

	wire, err := json.Marshal(old.Export())
	require.NoError(t, err)
	var state Handed
	require.NoError(t, json.Unmarshal(wire, &state))

	later := t0.Add(time.Second)
	next, err := Restore(state, DefaultConfig(), later, 10*time.Second)
	require.NoError(t, err)
	people := next.Roster()
	require.Len(t, people, 2)
	assert.Equal(t, StateReconnecting, people[0].State, "everyone is held as reconnecting")
	assert.True(t, people[0].Flags.Has(FlagOwner))
	assert.Equal(t, Look("c6f432-0e1116-45"), people[0].Look)
	assert.True(t, people[1].Flags.Has(FlagMuted), "the room is still muted")
	assert.True(t, next.Hushed())
	assert.Greater(t, next.Version(), old.Version())
	require.Error(t, next.Admit("office"), "a ban outlives the handover")
	require.Error(t, next.Authorize(later, nil), "and so does the room code")
	require.NoError(t, next.Authorize(later, &verifier))

	_, _, err = next.Resume(later, bia.ID, sha256.Sum256([]byte("wrong")), biaSecret)
	require.Error(t, err, "only the holder of the secret comes back")
	back, _, err := next.Resume(later, bia.ID, biaSecret, sha256.Sum256([]byte("bia2")))
	require.NoError(t, err)
	assert.Equal(t, bia.Gen+1, back.Gen)

	gone := next.Expire(later.Add(11 * time.Second))
	require.NotEmpty(t, gone, "whoever does not return within the hold is removed")
	assert.Equal(t, ana.ID, gone[0].PID)

	dana, _, err := next.Join(later, "dana", "", "", sha256.Sum256([]byte("dana")), false)
	require.NoError(t, err)
	assert.Greater(t, dana.ID, caio.ID, "ids are never given twice")
}

func TestRestoreRefusesWhatItCouldNotHaveBuilt(t *testing.T) {
	good := Handed{Slug: "bk", NextPID: 2, People: []Kept{{ID: 1, Slot: 0, Name: "ana", Gen: 1}, {ID: 2, Slot: 1, Name: "bia", Gen: 1}}}
	_, err := Restore(good, DefaultConfig(), t0, time.Second)
	require.NoError(t, err)
	for name, change := range map[string]func(*Handed){
		"a slug the site keeps":      func(s *Handed) { s.Slug = "api" },
		"nobody in it":               func(s *Handed) { s.People = nil },
		"two in one slot":            func(s *Handed) { s.People[1].Slot = 0 },
		"the same id twice":          func(s *Handed) { s.People[1].ID = 1 },
		"an id never handed out":     func(s *Handed) { s.People[1].ID = 9 },
		"a slot beyond the capacity": func(s *Handed) { s.People[1].Slot = 63 },
		"a name the room refuses":    func(s *Handed) { s.People[1].Name = "" },
	} {
		s := Handed{Slug: good.Slug, NextPID: good.NextPID, People: append([]Kept(nil), good.People...)}
		change(&s)
		_, err := Restore(s, DefaultConfig(), t0, time.Second)
		assert.Error(t, err, name)
	}
}
