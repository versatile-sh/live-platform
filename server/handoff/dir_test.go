package handoff

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/versatile-sh/live/server/core/room"
	"github.com/versatile-sh/live/server/service/presence"
)

func TestDir(t *testing.T) {
	path := t.TempDir()
	old, err := Open(path, time.Now)
	require.NoError(t, err)
	next, err := Open(path, time.Now)
	require.NoError(t, err)
	rooms := []presence.HandedRoom{{Room: room.Handed{Slug: "bk", NextPID: 1, People: []room.Kept{{ID: 1, Name: "ana", Gen: 1}}}}}

	t.Run("both servers get the same salt, drawn once", func(t *testing.T) {
		a, err := old.Salt()
		require.NoError(t, err)
		b, err := next.Salt()
		require.NoError(t, err)
		assert.Equal(t, a, b)
		assert.Len(t, a, 16)
	})

	t.Run("what one leaves, the other takes, once, and the one that left is told", func(t *testing.T) {
		ctx, stop := context.WithCancel(context.Background())
		defer stop()
		got := make(chan []presence.HandedRoom, 2)
		go next.Watch(ctx, func(r []presence.HandedRoom) { got <- r })
		go old.Watch(ctx, func(r []presence.HandedRoom) { t.Error("a server took back what it left") })
		require.NoError(t, old.Leave(rooms))
		wait, cancel := context.WithTimeout(ctx, 2*time.Second)
		defer cancel()
		assert.True(t, old.Taken(wait))
		select {
		case taken := <-got:
			assert.Equal(t, room.Slug("bk"), taken[0].Room.Slug)
		case <-time.After(time.Second):
			t.Fatal("nothing was taken")
		}
		select {
		case <-got:
			t.Fatal("taken twice")
		case <-time.After(300 * time.Millisecond):
		}
	})

	t.Run("with nobody to take it, the one leaving stops waiting", func(t *testing.T) {
		lone, err := Open(t.TempDir(), time.Now)
		require.NoError(t, err)
		require.NoError(t, lone.Leave(rooms))
		wait, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
		defer cancel()
		assert.False(t, lone.Taken(wait))
	})

	t.Run("an old note and a broken one are thrown away, not adopted", func(t *testing.T) {
		dir := t.TempDir()
		writer, err := Open(dir, time.Now)
		require.NoError(t, err)
		reader, err := Open(dir, time.Now)
		require.NoError(t, err)
		require.NoError(t, writer.Leave(rooms))
		past := time.Now().Add(-5 * time.Minute)
		require.NoError(t, os.Chtimes(filepath.Join(dir, noteName), past, past))
		_, ok := reader.take()
		assert.False(t, ok)
		require.NoError(t, os.WriteFile(filepath.Join(dir, noteName), []byte("{broken"), 0o600))
		_, ok = reader.take()
		assert.False(t, ok)
		_, err = os.Stat(filepath.Join(dir, noteName))
		assert.ErrorIs(t, err, os.ErrNotExist)
	})
}
