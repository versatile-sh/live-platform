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
		assert.Error(t, err)
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
