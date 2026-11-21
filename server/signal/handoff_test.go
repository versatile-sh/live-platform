package signal

import (
	"context"
	"net"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/versatile-sh/live/server/core/room"
	"github.com/versatile-sh/live/server/service/presence"
)

func serve(t *testing.T) (*presence.Hub, *Server, string) {
	t.Helper()
	cfg := room.DefaultConfig()
	hub := presence.NewHub(cfg, presence.DefaultLiveness(), time.Now)
	probe, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	addr := probe.Addr().String()
	require.NoError(t, probe.Close())
	srv := NewServer(presence.WithoutMedia{Hub: hub}, DefaultConfig(nil))
	go func() { _ = srv.Run(addr) }()
	<-srv.Ready()
	t.Cleanup(func() {
		ctx, stop := context.WithTimeout(context.Background(), 2*time.Second)
		defer stop()
		_ = srv.Stop(ctx)
	})
	return hub, srv, "ws://" + addr + path
}

func TestRoomsOutliveAServer(t *testing.T) {
	oldHub, oldServer, oldURL := serve(t)
	newHub, _, newURL := serve(t)

	ana, bia := dial(t, oldURL), dial(t, oldURL)
	ana.join("ana")
	bia.join("bia")
	ana.until(func(f serverFrame) bool { return f.T == "roster" && has(f, 2, "active") })
	ana.send(`{"t":"owner","op":"mute-all"}`)
	ana.until(func(f serverFrame) bool { return f.T == "roster" && len(f.People) == 2 && f.People[1].Flags&256 != 0 })

	handed := oldHub.Export()
	require.Len(t, handed, 1)
	require.Equal(t, 1, newHub.Adopt(handed, 5*time.Second))
	oldServer.Handoff()
	assert.Equal(t, CloseRestarting, ana.closeCode(), "the old server sends everyone straight back")

	t.Run("whoever returns with their secret has the same place, role and room on the new server", func(t *testing.T) {
		back := dial(t, newURL)
		back.send(`{"t":"resume","slug":"bk","pid":1,"secret":"` + ana.me.Secret + `"}`)
		joined, err := back.next()
		require.NoError(t, err)
		require.Equal(t, "joined", joined.T)
		assert.Equal(t, uint32(1), joined.PID)
		roster := back.until(func(f serverFrame) bool { return f.T == "roster" && has(f, 1, "active") })
		require.Len(t, roster.People, 2)
		assert.NotZero(t, roster.People[0].Flags&32, "still the owner")
		assert.Equal(t, "reconnecting", roster.People[1].State, "the other is held until they return")
		assert.NotZero(t, roster.People[1].Flags&256, "and the room is still muted")

		other := dial(t, newURL)
		other.send(`{"t":"resume","slug":"bk","pid":2,"secret":"` + bia.me.Secret + `"}`)
		joined, err = other.next()
		require.NoError(t, err)
		assert.Equal(t, uint32(2), joined.PID)
		back.until(func(f serverFrame) bool { return f.T == "roster" && has(f, 2, "active") })
	})

	t.Run("a secret that is not theirs opens nothing", func(t *testing.T) {
		thief := dial(t, newURL)
		thief.send(`{"t":"resume","slug":"bk","pid":1,"secret":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}`)
		refused := thief.until(func(f serverFrame) bool { return f.T == "error" })
		assert.Equal(t, "NOT_FOUND", refused.Code)
	})

	t.Run("a name already taken on the new server is not overwritten", func(t *testing.T) {
		assert.Zero(t, newHub.Adopt(handed, 5*time.Second))
	})
}
