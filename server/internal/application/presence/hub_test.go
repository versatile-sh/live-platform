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
	said   []room.ChatMessage
	drawn  []room.BoardUpdate
	photos map[room.PID]int
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

func (f *fakeSession) Chat(m room.ChatMessage) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.stuck {
		return false
	}
	f.said = append(f.said, m)
	return true
}

func (f *fakeSession) heard() []room.ChatMessage {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]room.ChatMessage(nil), f.said...)
}

func (f *fakeSession) Board(u room.BoardUpdate) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.drawn = append(f.drawn, u)
	return true
}

func (f *fakeSession) boards() []room.BoardUpdate {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]room.BoardUpdate(nil), f.drawn...)
}

func (f *fakeSession) Photo(pid room.PID, jpeg []byte) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.photos == nil {
		f.photos = map[room.PID]int{}
	}
	f.photos[pid] = len(jpeg)
}

func (f *fakeSession) photoOf(pid room.PID) (int, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	n, ok := f.photos[pid]
	return n, ok
}

func (f *fakeSession) Media(room.MediaSignal) {}

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
		PasswordTries:  10,
		PasswordWindow: time.Minute,
	}
	return NewHub(cfg, Liveness{UnstableAfter: 60 * time.Millisecond, SuspectAfter: 150 * time.Millisecond}, time.Now)
}

func newCalmHub() *Hub {
	cfg := room.DefaultConfig()
	return NewHub(cfg, DefaultLiveness(), time.Now)
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
	seat, err := h.Join("bk", room.Entry{Name: name}, session)
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
				if _, err := h.Join("bk", room.Entry{Name: "p"}, &fakeSession{}); err == nil {
					mu.Lock()
					admitted++
					mu.Unlock()
				}
			}()
		}
		wg.Wait()
		assert.Equal(t, 10, admitted)
	})

	t.Run("the first entry decides the room; a private room asks everyone for the password and may still be listed", func(t *testing.T) {
		h := newCalmHub()
		password, wrong := room.Verifier{7}, room.Verifier{8}
		_, err := h.Join("bk", room.Entry{Name: "ana", Proof: &password, Listed: true, Country: "BR"}, &fakeSession{})
		require.NoError(t, err)
		_, err = h.Join("bk", room.Entry{Name: "bia"}, &fakeSession{})
		assert.Equal(t, shared.ErrCodePermissionDenied, shared.CodeOf(err))
		_, err = h.Join("bk", room.Entry{Name: "bia", Proof: &wrong}, &fakeSession{})
		assert.Equal(t, shared.ErrCodePermissionDenied, shared.CodeOf(err))
		_, err = h.Join("bk", room.Entry{Name: "bia", Proof: &password}, &fakeSession{})
		require.NoError(t, err)
		require.Eventually(t, func() bool {
			s, ok := h.Status("bk")
			return ok && s.Private && s.Count == 2 && s.Country == "BR"
		}, wait, tick)
		listed := h.Lobby()
		require.Len(t, listed, 1)
		assert.True(t, listed[0].Private)
		_, ok := h.Status("free")
		assert.False(t, ok)
	})

	t.Run("the lobby shows listed rooms with people, fullest first, until the owner unlists", func(t *testing.T) {
		h := newCalmHub()
		enterAs := func(slug room.Slug, name string, listed bool) room.Seat {
			seat, err := h.Join(slug, room.Entry{Name: name, Listed: listed, Country: "BR"}, &fakeSession{})
			require.NoError(t, err)
			h.MediaUp(slug, seat.PID, seat.Gen)
			return seat
		}
		owner := enterAs("small", "a", true)
		enterAs("big", "a", true)
		enterAs("big", "b", false)
		enterAs("hidden", "a", false)
		require.Eventually(t, func() bool {
			l := h.Lobby()
			return len(l) == 2 && l[0].Slug == "big" && l[0].Count == 2 && l[1].Slug == "small"
		}, wait, tick)
		require.NoError(t, h.SetListed("small", owner.PID, owner.Gen, false))
		require.Eventually(t, func() bool { return len(h.Lobby()) == 1 }, wait, tick)
		assert.Equal(t, shared.ErrCodeNotFound, shared.CodeOf(h.SetListed("small", owner.PID, owner.Gen+1, true)))
	})

	t.Run("without a media plane a participant is active as soon as it is seated, and again after a resume", func(t *testing.T) {
		h := WithoutMedia{Hub: newCalmHub()}
		session := &fakeSession{}
		seat, err := h.Join("bk", room.Entry{Name: "ana"}, session)
		require.NoError(t, err)
		active := func(pid room.PID) func() bool {
			return func() bool {
				p, ok := session.sees(pid)
				return ok && p.State == room.StateActive
			}
		}
		require.Eventually(t, active(seat.PID), wait, tick)
		fresh := &fakeSession{}
		resumed, err := h.Resume("bk", seat.PID, seat.Secret, fresh)
		require.NoError(t, err)
		session = fresh
		require.Eventually(t, active(resumed.PID), wait, tick)
	})

	t.Run("a line said in the room reaches everyone in it, the speaker included, and nobody outside", func(t *testing.T) {
		h := newCalmHub()
		ana, anaSession := enter(t, h, "ana")
		_, biaSession := enter(t, h, "bia")
		outsider := &fakeSession{}
		h.Chat("bk", ana.PID, ana.Gen, 0, "hello")
		h.Chat("bk", ana.PID, ana.Gen+1, 0, "from a stale connection")
		h.Chat("bk", 99, 1, 0, "from nobody")
		require.Eventually(t, func() bool { return len(biaSession.heard()) == 1 && len(anaSession.heard()) == 1 }, wait, tick)
		said := biaSession.heard()[0]
		assert.Equal(t, ana.PID, said.From)
		assert.Equal(t, "ana", said.Name)
		assert.Equal(t, "hello", said.Text)
		assert.Empty(t, outsider.heard())
	})

	t.Run("a photo is shown to the room, to whoever arrives later, and goes with its owner", func(t *testing.T) {
		h := newCalmHub()
		jpeg := []byte{0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3}
		ana, _ := enter(t, h, "ana")
		_, biaSession := enter(t, h, "bia")
		h.SetPhoto("bk", ana.PID, ana.Gen, []byte("<svg/>"))
		h.SetPhoto("bk", ana.PID, ana.Gen, jpeg)
		require.Eventually(t, func() bool { n, ok := biaSession.photoOf(ana.PID); return ok && n == len(jpeg) }, wait, tick)
		_, caioSession := enter(t, h, "caio")
		require.Eventually(t, func() bool { n, ok := caioSession.photoOf(ana.PID); return ok && n == len(jpeg) }, wait, tick)
		h.SetPhoto("bk", ana.PID, ana.Gen, nil)
		require.Eventually(t, func() bool { n, ok := biaSession.photoOf(ana.PID); return ok && n == 0 }, wait, tick)
	})

	t.Run("a private line reaches only the one it is for, and comes back to the speaker", func(t *testing.T) {
		h := newCalmHub()
		ana, anaSession := enter(t, h, "ana")
		bia, biaSession := enter(t, h, "bia")
		_, caioSession := enter(t, h, "caio")
		h.Chat("bk", ana.PID, ana.Gen, bia.PID, "psst")
		require.Eventually(t, func() bool { return len(biaSession.heard()) == 1 && len(anaSession.heard()) == 1 }, wait, tick)
		assert.Equal(t, bia.PID, biaSession.heard()[0].To)
		h.Chat("bk", ana.PID, ana.Gen, 0, "everyone")
		require.Eventually(t, func() bool { return len(caioSession.heard()) == 1 }, wait, tick)
		assert.Equal(t, "everyone", caioSession.heard()[0].Text)
	})

	t.Run("a piece of the whiteboard reaches the others and never comes back to who drew it", func(t *testing.T) {
		h := newCalmHub()
		ana, anaSession := enter(t, h, "ana")
		bia, biaSession := enter(t, h, "bia")
		_, caioSession := enter(t, h, "caio")
		h.Board("bk", ana.PID, ana.Gen, 0, `{"n":1}`)
		require.Eventually(t, func() bool { return len(biaSession.boards()) == 1 && len(caioSession.boards()) == 1 }, wait, tick)
		h.Board("bk", ana.PID, ana.Gen, bia.PID, `{"n":2}`)
		h.Board("bk", ana.PID, ana.Gen+1, 0, `{"n":3}`)
		require.Eventually(t, func() bool { return len(biaSession.boards()) == 2 }, wait, tick)
		assert.Len(t, caioSession.boards(), 1)
		assert.Empty(t, anaSession.boards())
	})
}
