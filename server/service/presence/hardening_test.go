package presence

import (
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/versatile-sh/live/server/core/room"
	"github.com/versatile-sh/live/server/port"
)

type recordingPlane struct {
	mu  sync.Mutex
	ops []string
}

func (p *recordingPlane) note(op string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.ops = append(p.ops, op)
}

func (p *recordingPlane) seen() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]string(nil), p.ops...)
}

func (p *recordingPlane) Attach(_ room.Slug, pid room.PID, _ uint32, _ func(room.MediaSignal)) {
	p.note("attach")
}
func (p *recordingPlane) Detach(_ room.Slug, pid room.PID) { p.note("detach") }
func (p *recordingPlane) Signal(room.Slug, room.PID, uint32, room.MediaSignal) {
}
func (p *recordingPlane) Silence(_ room.Slug, _ room.PID, silent bool) {
	if silent {
		p.note("silence")
	} else {
		p.note("unsilence")
	}
}

func onActor(t *testing.T, h *Hub, fn func(a *actor)) {
	t.Helper()
	done := make(chan struct{})
	require.True(t, h.tell("bk", func(a *actor) { fn(a); close(done) }))
	<-done
}

func stalledQueue(a *actor) chan func() {
	queue := make(chan func())
	a.wires = queue
	return queue
}

func drain(queue chan func()) {
	go func() {
		for op := range queue {
			op()
		}
	}()
}

type stuckBoard struct{ *fakeSession }

func (stuckBoard) Board(room.BoardUpdate) bool { return false }

func TestMediaPlaneHardening(t *testing.T) {
	t.Run("a mute the media plane could not take is resent, not forgotten", func(t *testing.T) {
		h := newCalmHub()
		plane := &recordingPlane{}
		h.UseMedia(plane)
		ana, _ := enter(t, h, "ana")
		bia, _ := enter(t, h, "bia")
		var queue chan func()
		onActor(t, h, func(a *actor) {
			queue = stalledQueue(a)
			a.backlog = make([]wireOp, wireBacklogMax)
			for i := range a.backlog {
				a.backlog[i] = wireOp{run: func() {}}
			}
		})
		require.NoError(t, h.Quiet("bk", ana.PID, ana.Gen, room.QuietOp("mute"), bia.PID))
		onActor(t, h, func(a *actor) {
			assert.False(t, a.silent[bia.PID], "a mute that was not queued is not recorded as sent")
			assert.True(t, a.retry)
		})
		assert.NotZero(t, h.MediaDrops())
		drain(queue)
		require.Eventually(t, func() bool {
			onActor(t, h, func(a *actor) { a.mend() })
			return slices.Contains(plane.seen(), "silence")
		}, wait, tick)
		onActor(t, h, func(a *actor) { assert.True(t, a.silent[bia.PID]) })
	})

	t.Run("a detach that finds the queue full waits and is delivered", func(t *testing.T) {
		h := newCalmHub()
		plane := &recordingPlane{}
		h.UseMedia(plane)
		ana, _ := enter(t, h, "ana")
		bia, _ := enter(t, h, "bia")
		var queue chan func()
		onActor(t, h, func(a *actor) { queue = stalledQueue(a) })
		h.Leave("bk", bia.PID, bia.Gen)
		onActor(t, h, func(a *actor) { assert.Len(t, a.backlog, 1) })
		drain(queue)
		require.Eventually(t, func() bool {
			onActor(t, h, func(a *actor) { a.mend() })
			return slices.Contains(plane.seen(), "detach")
		}, wait, tick)
		_ = ana
	})
}

func TestTroubleHardening(t *testing.T) {
	t.Run("a flood of server troubles from one seat is capped and its detail clipped", func(t *testing.T) {
		h := newCalmHub()
		heard := &heardTroubles{}
		h.UseTroubles(heard)
		ana, _ := enter(t, h, "ana")
		for i := 0; i < 50; i++ {
			h.ServerTrouble("bk", ana.PID, ana.Gen, room.TroubleOfferRejected, strings.Repeat("é", 1000))
			h.MediaTrouble("bk", ana.PID, ana.Gen, room.TroubleAnswerLate)
		}
		onActor(t, h, func(*actor) {})
		got := heard.all()
		assert.LessOrEqual(t, len(got), troubleBurst)
		for _, e := range got {
			assert.LessOrEqual(t, len(e.Detail), troubleDetail)
		}
	})
}

func TestBoardBudget(t *testing.T) {
	t.Run("a sender past the byte budget is dropped and a receiver that cannot keep up stays", func(t *testing.T) {
		h := newCalmHub()
		ana, _ := enter(t, h, "ana")
		keepAlive(t, h, ana)
		slow := &stuckBoard{&fakeSession{}}
		bia, err := h.Join("bk", room.Entry{Name: "bia"}, slow)
		require.NoError(t, err)
		h.MediaUp("bk", bia.PID, bia.Gen)
		keepAlive(t, h, &bia)
		cai, caiSession := enter(t, h, "cai")
		keepAlive(t, h, cai)
		data := `{"k":"s","d":"` + strings.Repeat("x", 48<<10-20) + `"}`
		for i := 0; i < 100; i++ {
			h.Board("bk", ana.PID, ana.Gen, 0, data)
		}
		onActor(t, h, func(*actor) {})
		got := len(caiSession.boards())
		assert.Greater(t, got, 10)
		assert.Less(t, got, 30, "the budget stops the flood")
		assert.Empty(t, slow.closedWith(), "a full receiver loses frames, not its connection")
	})
}

func TestBanNotKept(t *testing.T) {
	t.Run("a ban that cannot be recorded removes the target and tells the owner", func(t *testing.T) {
		h := newCalmHub()
		ana, anaSession := enter(t, h, "ana")
		keepAlive(t, h, ana)
		bia, _ := enter(t, h, "bia")
		err := h.Ban("bk", ana.PID, ana.Gen, bia.PID)
		assert.Equal(t, CodeBanNotKept, port.CodeOf(err))
		require.Eventually(t, func() bool { return anaSession.reasonFor(bia.PID) == room.ReasonBanned }, wait, tick)
	})
}
