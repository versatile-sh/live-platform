package handoff

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
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

	t.Run("servers that find no salt at once all end with the one that won", func(t *testing.T) {
		shared := t.TempDir()
		const servers = 16
		salts := make([][]byte, servers)
		var wg sync.WaitGroup
		for i := range servers {
			dir, err := Open(shared, time.Now)
			require.NoError(t, err)
			wg.Add(1)
			go func() {
				defer wg.Done()
				salts[i], _ = dir.Salt()
			}()
		}
		wg.Wait()
		for _, salt := range salts {
			assert.Equal(t, salts[0], salt)
		}
		assert.Len(t, salts[0], 16)
		onDisk, err := os.ReadFile(filepath.Join(shared, saltName))
		require.NoError(t, err)
		assert.Equal(t, onDisk, salts[0])
	})

	t.Run("a salt file that is too short is an error, never re-rolled", func(t *testing.T) {
		shared := t.TempDir()
		dir, err := Open(shared, time.Now)
		require.NoError(t, err)
		require.NoError(t, os.WriteFile(filepath.Join(shared, saltName), []byte("short"), 0o600))
		_, err = dir.Salt()
		require.ErrorIs(t, err, errSaltLength)
		onDisk, err := os.ReadFile(filepath.Join(shared, saltName))
		require.NoError(t, err)
		assert.Equal(t, []byte("short"), onDisk)
	})

	t.Run("a salt file longer than the drawn length is kept as it is", func(t *testing.T) {
		shared := t.TempDir()
		dir, err := Open(shared, time.Now)
		require.NoError(t, err)
		long := []byte("0123456789abcdefXYZ")
		require.NoError(t, os.WriteFile(filepath.Join(shared, saltName), long, 0o600))
		salt, err := dir.Salt()
		require.NoError(t, err)
		assert.Equal(t, long, salt)
	})

	t.Run("servers leaving at once leave one whole note and no temporary file", func(t *testing.T) {
		shared := t.TempDir()
		big := make([]presence.HandedRoom, 200)
		for i := range big {
			big[i] = rooms[0]
		}
		var wg sync.WaitGroup
		for range 16 {
			dir, err := Open(shared, time.Now)
			require.NoError(t, err)
			wg.Add(1)
			go func() {
				defer wg.Done()
				assert.NoError(t, dir.Leave(big))
			}()
		}
		wg.Wait()
		taker, err := Open(shared, time.Now)
		require.NoError(t, err)
		var got []presence.HandedRoom
		require.True(t, taker.take(context.Background(), quiet, func(r []presence.HandedRoom) int { got = r; return len(r) }))
		assert.Len(t, got, len(big))
		left, err := filepath.Glob(filepath.Join(shared, "*.tmp"))
		require.NoError(t, err)
		assert.Empty(t, left)
	})

	t.Run("what one leaves, the other takes, once, and the one that left is told", func(t *testing.T) {
		ctx, stop := context.WithCancel(context.Background())
		defer stop()
		got := make(chan []presence.HandedRoom, 2)
		go next.Watch(ctx, quiet, func(r []presence.HandedRoom) int { got <- r; return len(r) })
		go old.Watch(ctx, quiet, func(r []presence.HandedRoom) int { t.Error("a server took back what it left"); return 0 })
		require.NoError(t, old.Leave(rooms))
		wait, cancel := context.WithTimeout(ctx, 2*time.Second)
		defer cancel()
		count, ok := old.Taken(wait)
		assert.True(t, ok)
		assert.Equal(t, 1, count)
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
		_, ok := lone.Taken(wait)
		assert.False(t, ok)
	})

	t.Run("an old note is set aside as bad, never adopted, and the one leaving is not told it was taken", func(t *testing.T) {
		dir := t.TempDir()
		writer, err := Open(dir, time.Now)
		require.NoError(t, err)
		reader, err := Open(dir, time.Now)
		require.NoError(t, err)
		require.NoError(t, writer.Leave(rooms))
		past := time.Now().Add(-5 * time.Minute)
		require.NoError(t, os.Chtimes(filepath.Join(dir, noteName), past, past))
		assert.False(t, reader.take(context.Background(), quiet, adoptNothing(t)))
		assert.FileExists(t, filepath.Join(dir, badName))
		assert.NoFileExists(t, filepath.Join(dir, noteName))
		assert.NoFileExists(t, filepath.Join(dir, takeName))
		wait, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
		defer cancel()
		_, ok := writer.Taken(wait)
		assert.False(t, ok)
	})

	t.Run("a broken note is set aside as bad, replacing an older one, and never adopted", func(t *testing.T) {
		dir := t.TempDir()
		reader, err := Open(dir, time.Now)
		require.NoError(t, err)
		require.NoError(t, os.WriteFile(filepath.Join(dir, badName), []byte("older"), 0o600))
		require.NoError(t, os.WriteFile(filepath.Join(dir, noteName), []byte("{broken"), 0o600))
		assert.False(t, reader.take(context.Background(), quiet, adoptNothing(t)))
		bad, err := os.ReadFile(filepath.Join(dir, badName))
		require.NoError(t, err)
		assert.Equal(t, []byte("{broken"), bad)
		assert.NoFileExists(t, filepath.Join(dir, noteName))
		assert.NoFileExists(t, filepath.Join(dir, takeName))
	})

	t.Run("the taker acknowledges after adopting, naming the leaver and the rooms taken", func(t *testing.T) {
		dir := t.TempDir()
		writer, err := Open(dir, time.Now)
		require.NoError(t, err)
		reader, err := Open(dir, time.Now)
		require.NoError(t, err)
		require.NoError(t, writer.Leave(rooms))
		adopted := false
		assert.True(t, reader.take(context.Background(), quiet, func(r []presence.HandedRoom) int {
			assert.NoFileExists(t, filepath.Join(dir, takeName))
			adopted = true
			return 1
		}))
		assert.True(t, adopted)
		assert.NoFileExists(t, filepath.Join(dir, noteName))
		data, err := os.ReadFile(filepath.Join(dir, takeName))
		require.NoError(t, err)
		assert.JSONEq(t, `{"from":"`+writer.id+`","rooms":1}`, string(data))
		wait, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		count, ok := writer.Taken(wait)
		assert.True(t, ok)
		assert.Equal(t, 1, count)
		assert.NoFileExists(t, filepath.Join(dir, takeName))
	})

	t.Run("a leaver of the old kind, that only waits for the note to go, sees it go", func(t *testing.T) {
		dir := t.TempDir()
		writer, err := Open(dir, time.Now)
		require.NoError(t, err)
		reader, err := Open(dir, time.Now)
		require.NoError(t, err)
		require.NoError(t, writer.Leave(rooms))
		require.True(t, reader.take(context.Background(), quiet, func(r []presence.HandedRoom) int { return len(r) }))
		_, err = os.Stat(filepath.Join(dir, noteName))
		assert.ErrorIs(t, err, os.ErrNotExist)
	})

	t.Run("an acknowledgement for another server is ignored and does not block", func(t *testing.T) {
		dir := t.TempDir()
		writer, err := Open(dir, time.Now)
		require.NoError(t, err)
		reader, err := Open(dir, time.Now)
		require.NoError(t, err)
		foreign := filepath.Join(dir, takeName)
		require.NoError(t, os.WriteFile(foreign, []byte(`{"from":"someone-else","rooms":3}`), 0o600))
		short, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
		defer cancel()
		_, ok := writer.Taken(short)
		assert.False(t, ok)
		assert.FileExists(t, foreign)
		require.NoError(t, writer.Leave(rooms))
		require.True(t, reader.take(context.Background(), quiet, func(r []presence.HandedRoom) int { return len(r) }))
		wait, stop := context.WithTimeout(context.Background(), time.Second)
		defer stop()
		_, ok = writer.Taken(wait)
		assert.True(t, ok)
	})
}

var quiet = slog.New(slog.DiscardHandler)

func adoptNothing(t *testing.T) func([]presence.HandedRoom) int {
	t.Helper()
	return func([]presence.HandedRoom) int {
		t.Error("a note that should not be adopted was adopted")
		return 0
	}
}
