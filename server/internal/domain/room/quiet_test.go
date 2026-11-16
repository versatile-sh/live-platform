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
