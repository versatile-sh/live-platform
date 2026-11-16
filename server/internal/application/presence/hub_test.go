package presence

import (
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/versatile-sh/live/server/internal/domain/room"
	"github.com/versatile-sh/live/server/internal/domain/shared"
)

const (
	wait = 2 * time.Second
	tick = 2 * time.Millisecond
)

type fakeSession struct {
	mu     sync.Mutex
	last   room.Snapshot
	gone   []room.Departure
	closed room.CloseReason
	stuck  bool
}

func (f *fakeSession) Roster(s room.Snapshot) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.stuck {
		return false
	}
	if s.Version > f.last.Version {
		f.last = s
	}
	f.gone = append(f.gone, s.Gone...)
	return true
}

func (f *fakeSession) Close(reason room.CloseReason) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.closed = reason
}

func (f *fakeSession) sees(pid room.PID) (room.Participant, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, p := range f.last.Participants {
		if p.ID == pid {
			return p, true
		}
	}
	return room.Participant{}, false
}

func (f *fakeSession) reasonFor(pid room.PID) room.Reason {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, d := range f.gone {
		if d.PID == pid {
			return d.Reason
		}
	}
	return ""
}

func (f *fakeSession) closedWith() room.CloseReason {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.closed
}

func newHub() *Hub {
	cfg := room.Config{
		Capacity:       10,
		ConnectTimeout: 400 * time.Millisecond,
		Grace:          80 * time.Millisecond,
		UnhealthyCap:   160 * time.Millisecond,
		EmptyRelease:   100 * time.Millisecond,
	}
	return NewHub(cfg, Liveness{UnstableAfter: 60 * time.Millisecond, SuspectAfter: 150 * time.Millisecond}, time.Now)
}

func keepAlive(t *testing.T, h *Hub, seat *room.Seat) {
	t.Helper()
	stop := make(chan struct{})
	t.Cleanup(func() { close(stop) })
	go func() {
		for {
			select {
			case <-stop:
				return
			case <-time.After(10 * time.Millisecond):
				h.Touch("bk", seat.PID, seat.Gen)
			}
		}
	}()
}

func enter(t *testing.T, h *Hub, name string) (*room.Seat, *fakeSession) {
	t.Helper()
	session := &fakeSession{}
	seat, err := h.Join("bk", name, session)
	require.NoError(t, err)
	h.MediaUp("bk", seat.PID, seat.Gen)
	return &seat, session
}

func TestHub(t *testing.T) {
	t.Run("the first to open a free slug owns the room and everyone sees everyone", func(t *testing.T) {
		h := newHub()
		ana, anaSession := enter(t, h, "ana")
		bia, biaSession := enter(t, h, "bia")
		keepAlive(t, h, ana)
		keepAlive(t, h, bia)
		require.Eventually(t, func() bool {
			p, ok := biaSession.sees(ana.PID)
			q, ok2 := anaSession.sees(bia.PID)
			return ok && ok2 && p.Flags.Has(room.FlagOwner) && !q.Flags.Has(room.FlagOwner) &&
				p.State == room.StateActive && q.State == room.StateActive
		}, wait, tick)
	})

	t.Run("a participant whose connection ends leaves everyone's view after the grace", func(t *testing.T) {
		h := newHub()
		ana, anaSession := enter(t, h, "ana")
		bia, _ := enter(t, h, "bia")
		keepAlive(t, h, ana)
		h.Disconnected("bk", bia.PID, bia.Gen)
		require.Eventually(t, func() bool {
			p, ok := anaSession.sees(bia.PID)
			return ok && p.State == room.StateReconnecting
		}, wait, tick)
		require.Eventually(t, func() bool {
			_, ok := anaSession.sees(bia.PID)
			return !ok && anaSession.reasonFor(bia.PID) == room.ReasonTimeout
		}, wait, tick)
	})

	t.Run("a silent participant is labelled unstable, then suspected, then removed", func(t *testing.T) {
		h := newHub()
		ana, anaSession := enter(t, h, "ana")
		bia, biaSession := enter(t, h, "bia")
		keepAlive(t, h, ana)
		require.Eventually(t, func() bool {
			p, ok := anaSession.sees(bia.PID)
			return ok && p.Flags.Has(room.FlagUnstable)
		}, wait, tick)
		require.Eventually(t, func() bool {
			_, ok := anaSession.sees(bia.PID)
			return !ok
		}, wait, tick)
		assert.Equal(t, room.CloseSilent, biaSession.closedWith())
	})

	t.Run("a resume keeps the place, replaces the connection and rotates the secret", func(t *testing.T) {
		h := newHub()
		ana, anaSession := enter(t, h, "ana")
		bia, old := enter(t, h, "bia")
		keepAlive(t, h, ana)
		fresh := &fakeSession{}
		resumed, err := h.Resume("bk", bia.PID, bia.Secret, fresh)
		require.NoError(t, err)
		assert.Equal(t, room.CloseSuperseded, old.closedWith())
		assert.Equal(t, bia.Gen+1, resumed.Gen)
		assert.NotEqual(t, bia.Secret, resumed.Secret)
		h.MediaUp("bk", resumed.PID, resumed.Gen)
		keepAlive(t, h, &resumed)
		_, err = h.Resume("bk", bia.PID, bia.Secret, &fakeSession{})
		assert.Equal(t, shared.ErrCodeNotFound, shared.CodeOf(err))
		time.Sleep(300 * time.Millisecond)
		p, ok := anaSession.sees(bia.PID)
		assert.True(t, ok)
		assert.Equal(t, room.StateActive, p.State)
	})

	t.Run("a connection that cannot keep up is closed and suspected", func(t *testing.T) {
		h := newHub()
		ana, anaSession := enter(t, h, "ana")
		keepAlive(t, h, ana)
		bia, biaSession := enter(t, h, "bia")
		keepAlive(t, h, bia)
		biaSession.mu.Lock()
		biaSession.stuck = true
		biaSession.mu.Unlock()
		h.SetMedia("bk", ana.PID, ana.Gen, room.FlagMicrophone)
		require.Eventually(t, func() bool { return biaSession.closedWith() == room.CloseSlow }, wait, tick)
		require.Eventually(t, func() bool {
			_, ok := anaSession.sees(bia.PID)
			return !ok
		}, wait, tick)
	})

	t.Run("an empty room is released and its slug is free for a new owner", func(t *testing.T) {
		h := newHub()
		ana, _ := enter(t, h, "ana")
		h.Leave("bk", ana.PID, ana.Gen)
		require.Eventually(t, func() bool { return h.Rooms() == 0 }, wait, tick)
		_, err := h.Resume("bk", ana.PID, ana.Secret, &fakeSession{})
		assert.Equal(t, shared.ErrCodeNotFound, shared.CodeOf(err))
		caio, caioSession := enter(t, h, "caio")
		keepAlive(t, h, caio)
		require.Eventually(t, func() bool {
			p, ok := caioSession.sees(caio.PID)
			return ok && p.Flags.Has(room.FlagOwner)
		}, wait, tick)
	})

	t.Run("only the owner removes, and the removed connection is closed", func(t *testing.T) {
		h := newHub()
		ana, _ := enter(t, h, "ana")
		bia, biaSession := enter(t, h, "bia")
		keepAlive(t, h, ana)
		keepAlive(t, h, bia)
		require.Eventually(t, func() bool {
			p, ok := biaSession.sees(bia.PID)
			return ok && p.State == room.StateActive
		}, wait, tick)
		assert.Equal(t, shared.ErrCodeInvariantViolation, shared.CodeOf(h.Remove("bk", bia.PID, bia.Gen, ana.PID)))
		assert.Equal(t, shared.ErrCodeNotFound, shared.CodeOf(h.Remove("bk", ana.PID, ana.Gen+1, bia.PID)))
		require.NoError(t, h.Remove("bk", ana.PID, ana.Gen, bia.PID))
		assert.Equal(t, room.CloseRemoved, biaSession.closedWith())
	})

	t.Run("many people entering at once never exceed the capacity", func(t *testing.T) {
		h := newHub()
		var wg sync.WaitGroup
		var mu sync.Mutex
		admitted := 0
		for i := 0; i < 40; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				if _, err := h.Join("bk", "p", &fakeSession{}); err == nil {
					mu.Lock()
					admitted++
					mu.Unlock()
				}
			}()
		}
		wg.Wait()
		assert.Equal(t, 10, admitted)
	})
}
