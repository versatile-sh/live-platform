package room

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func flagsOf(r *Room, pid PID) Flags {
	for _, p := range r.Roster() {
		if p.ID == pid {
			return p.Flags
		}
	}
	return 0
}

func TestMuteAll(t *testing.T) {
	r := newRoom(t)
	ana := joinActive(t, r, "ana", true)
	bia := joinActive(t, r, "bia", false)
	r.SetMedia(ana.ID, FlagMicrophone)
	r.SetMedia(bia.ID, FlagMicrophone|FlagCamera)

	_, err := r.MuteAll(bia.ID)
	assert.Error(t, err, "only the owner mutes the room")
	events, err := r.MuteAll(ana.ID)
	require.NoError(t, err)
	assert.Len(t, events, 1)
	assert.True(t, flagsOf(r, ana.ID).Has(FlagMicrophone), "the owner keeps the microphone")
	assert.Equal(t, FlagCamera|FlagMuted, flagsOf(r, bia.ID), "the others lose the microphone and nothing else")
	assert.Equal(t, []PID{bia.ID}, r.Silenced())

	r.SetMedia(bia.ID, FlagMicrophone|FlagHand)
	assert.Equal(t, FlagHand|FlagMuted, flagsOf(r, bia.ID), "a muted participant cannot turn the microphone on, but can raise a hand")

	caio := joinActive(t, r, "caio", false)
	assert.True(t, flagsOf(r, caio.ID).Has(FlagMuted), "whoever arrives later arrives muted")

	_, err = r.Allow(ana.ID, bia.ID)
	require.NoError(t, err)
	assert.Equal(t, Flags(0), flagsOf(r, bia.ID), "being let speak lowers the hand and turns nothing on")
	r.SetMedia(bia.ID, FlagMicrophone)
	assert.True(t, flagsOf(r, bia.ID).Has(FlagMicrophone))

	_, err = r.Mute(ana.ID, bia.ID)
	require.NoError(t, err)
	assert.Equal(t, FlagMuted, flagsOf(r, bia.ID))
	_, err = r.Mute(ana.ID, ana.ID)
	assert.Error(t, err)

	_, err = r.UnmuteAll(ana.ID)
	require.NoError(t, err)
	assert.Empty(t, r.Silenced())
	dani := joinActive(t, r, "dani", false)
	assert.False(t, flagsOf(r, dani.ID).Has(FlagMuted))
}

func TestOwnershipClearsMute(t *testing.T) {
	r := newRoom(t)
	ana := joinActive(t, r, "ana", true)
	bia := joinActive(t, r, "bia", false)
	_, err := r.MuteAll(ana.ID)
	require.NoError(t, err)
	_, err = r.Transfer(ana.ID, bia.ID)
	require.NoError(t, err)
	assert.Equal(t, FlagOwner, flagsOf(r, bia.ID), "a new owner is not muted by the room")
}

func TestMuteAllAlone(t *testing.T) {
	r := newRoom(t)
	ana := joinActive(t, r, "ana", true)
	events, err := r.MuteAll(ana.ID)
	require.NoError(t, err)
	assert.Len(t, events, 1, "the room is told even with nobody else to mute")
	assert.True(t, r.Hushed())
	again, err := r.MuteAll(ana.ID)
	require.NoError(t, err)
	assert.Empty(t, again)
	bia := joinActive(t, r, "bia", false)
	assert.True(t, flagsOf(r, bia.ID).Has(FlagMuted))
	events, err = r.UnmuteAll(ana.ID)
	require.NoError(t, err)
	assert.Len(t, events, 1)
	assert.False(t, r.Hushed())
}

func TestLockedBoard(t *testing.T) {
	r := newRoom(t)
	ana := joinActive(t, r, "ana", true)
	bia := joinActive(t, r, "bia", false)
	data := `{"k":"els","els":[]}`
	_, ok := r.Draw(bia.ID, 0, data)
	require.True(t, ok, "everyone draws until the owner says otherwise")

	_, err := r.Quiet(DrawLock, bia.ID, 0)
	assert.Error(t, err, "only the owner locks the board")
	_, err = r.Quiet(DrawLock, ana.ID, 0)
	require.NoError(t, err)
	assert.True(t, r.Locked())
	_, ok = r.Draw(bia.ID, 0, data)
	assert.False(t, ok, "a locked board takes nothing from the others")
	_, ok = r.Draw(ana.ID, 0, data)
	assert.True(t, ok, "the owner always draws")
	caio := joinActive(t, r, "caio", false)
	assert.True(t, flagsOf(r, caio.ID).Has(FlagNoDraw), "whoever arrives later cannot draw either")

	_, err = r.Quiet(DrawAllow, ana.ID, bia.ID)
	require.NoError(t, err)
	_, ok = r.Draw(bia.ID, 0, data)
	assert.True(t, ok, "whoever the owner lets may draw")
	_, ok = r.Draw(caio.ID, 0, data)
	assert.False(t, ok)
	_, err = r.Quiet(DrawDeny, ana.ID, bia.ID)
	require.NoError(t, err)
	_, ok = r.Draw(bia.ID, 0, data)
	assert.False(t, ok)

	_, err = r.Quiet(DrawFree, ana.ID, 0)
	require.NoError(t, err)
	assert.False(t, r.Locked())
	_, ok = r.Draw(caio.ID, 0, data)
	assert.True(t, ok)
}
