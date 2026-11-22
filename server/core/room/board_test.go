package room

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBoard(t *testing.T) {
	for _, bad := range []string{"", "[]", "{", `"x"`, `{"a":"` + strings.Repeat("x", boardMaxBytes) + `"}`} {
		_, err := NewBoardData(bad)
		require.Error(t, err)
	}
	data, err := NewBoardData(`{"elements":[]}`)
	require.NoError(t, err)

	r := newRoom(t)
	ana := joinActive(t, r, "ana", false)
	bia := joinActive(t, r, "bia", false)
	toAll, ok := r.Draw(ana.ID, 0, data)
	require.True(t, ok)
	assert.Equal(t, BoardUpdate{From: ana.ID, Data: data}, toAll)
	toOne, ok := r.Draw(ana.ID, bia.ID, data)
	require.True(t, ok)
	assert.Equal(t, bia.ID, toOne.To)
	for _, pair := range [][2]PID{{ana.ID, ana.ID}, {ana.ID, 99}, {99, 0}} {
		_, ok := r.Draw(pair[0], pair[1], data)
		assert.False(t, ok)
	}
}

func TestViewOnlyParticipantsMayOnlyAskForTheBoard(t *testing.T) {
	r := newRoom(t)
	ana := joinActive(t, r, "ana", true)
	bia := joinActive(t, r, "bia", false)
	_, err := r.Quiet(DrawDeny, ana.ID, bia.ID)
	require.NoError(t, err)

	hello := `{"k":"hello"}`
	update, ok := r.Draw(bia.ID, 0, hello)
	require.True(t, ok)
	assert.Equal(t, BoardUpdate{From: bia.ID, Data: hello}, update)
	_, ok = r.Draw(bia.ID, ana.ID, hello)
	assert.False(t, ok, "the request is broadcast, never addressed")
	for _, other := range []string{`{"k":"els","els":[]}`, `{"k":"hello","els":[]}`, `{"k":"hello","x":1}`, `{"k":"hi"}`, `{"k":1}`, `{}`, `{"els":[]}`, `[]`, `x`} {
		_, ok = r.Draw(bia.ID, 0, other)
		assert.False(t, ok, other)
	}
}
