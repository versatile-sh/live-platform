package presence

import (
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/versatile-sh/live/server/internal/domain/room"
	"github.com/versatile-sh/live/server/internal/ports/outbound"
)

type trail struct {
	mu     sync.Mutex
	events []outbound.AuditEvent
}

func (t *trail) Record(e outbound.AuditEvent) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.events = append(t.events, e)
}

func (t *trail) of(kind outbound.AuditKind) []outbound.AuditEvent {
	t.mu.Lock()
	defer t.mu.Unlock()
	var out []outbound.AuditEvent
	for _, e := range t.events {
		if e.Kind == kind {
			out = append(out, e)
		}
	}
	return out
}

func (t *trail) count(kind outbound.AuditKind) func() bool {
	return func() bool { return len(t.of(kind)) > 0 }
}

func audited() (*Hub, *trail) {
	h := newCalmHub()
	log := &trail{}
	h.UseAudit(log)
	return h, log
}

func enterAs(t *testing.T, h *Hub, entry room.Entry) *room.Seat {
	t.Helper()
	seat, err := h.Join("bk", entry, &fakeSession{})
	require.NoError(t, err)
	h.MediaUp("bk", seat.PID, seat.Gen)
	return &seat
}

func TestAuditRecordsRoomJoinsAndWhoWasThere(t *testing.T) {
	h, log := audited()
	ana := enterAs(t, h, room.Entry{Name: "ana", Client: room.Client{IP: "203.0.113.1", Discord: &room.Discord{UserID: "42", GuildID: "7", ChannelID: "9"}}})
	enterAs(t, h, room.Entry{Name: "bia", Client: room.Client{IP: "203.0.113.2"}})

	created := log.of(outbound.AuditRoomCreated)
	require.Len(t, created, 1)
	assert.Equal(t, "bk", created[0].Room)
	assert.False(t, created[0].Private)
	assert.Equal(t, ana.PID, room.PID(created[0].Actor.PID))
	require.NotNil(t, created[0].Listed)

	joins := log.of(outbound.AuditJoin)
	require.Len(t, joins, 2)
	assert.Empty(t, joins[0].Present)
	assert.Equal(t, "203.0.113.1", joins[0].Client.IP)
	assert.Equal(t, "42", joins[0].Client.Discord.UserID)
	assert.Equal(t, []outbound.AuditPerson{{PID: uint32(ana.PID), Name: "ana"}}, joins[1].Present)
	assert.Nil(t, joins[1].Client.Discord)
	_, people, total := h.Stats()
	assert.EqualValues(t, 2, total)
	assert.GreaterOrEqual(t, people, 0)
}

func TestAuditRecordsLeaveWithReasonAndDurationAndTheEndOfTheRoom(t *testing.T) {
	h, log := audited()
	ana := enterAs(t, h, room.Entry{Name: "ana"})
	h.Leave("bk", ana.PID, ana.Gen)
	require.Eventually(t, log.count(outbound.AuditLeave), wait, tick)
	left := log.of(outbound.AuditLeave)[0]
	assert.Equal(t, "ana", left.Actor.Name)
	assert.Equal(t, string(room.ReasonLeft), left.Reason)
	assert.GreaterOrEqual(t, left.DurationMS, int64(0))
	h2 := newHub()
	log2 := &trail{}
	h2.UseAudit(log2)
	bia := enterAs(t, h2, room.Entry{Name: "bia"})
	h2.Leave("bk", bia.PID, bia.Gen)
	require.Eventually(t, log2.count(outbound.AuditRoomEnded), wait, tick)
	assert.Equal(t, "bk", log2.of(outbound.AuditRoomEnded)[0].Room)
}

func TestAuditKeepsPublicChatTextButNeverPrivateRoomContent(t *testing.T) {
	public, publicLog := audited()
	ana := enterAs(t, public, room.Entry{Name: "ana"})
	bia := enterAs(t, public, room.Entry{Name: "bia"})
	public.Chat("bk", ana.PID, ana.Gen, 0, "hello all", nil)
	public.Chat("bk", ana.PID, ana.Gen, bia.PID, "psst", nil)
	require.Eventually(t, func() bool { return len(publicLog.of(outbound.AuditChat)) == 2 }, wait, tick)
	chats := publicLog.of(outbound.AuditChat)
	assert.Equal(t, "hello all", chats[0].Text)
	assert.Nil(t, chats[0].Target)
	assert.Equal(t, "psst", chats[1].Text)
	assert.Equal(t, "bia", chats[1].Target.Name)
	assert.Equal(t, 4, chats[1].Length)

	private, privateLog := audited()
	proof := room.Verifier{1, 2, 3}
	cai := enterAs(t, private, room.Entry{Name: "cai", Proof: &proof})
	dea := enterAs(t, private, room.Entry{Name: "dea", Proof: &proof})
	private.Chat("bk", cai.PID, cai.Gen, 0, "the code word is swordfish", nil)
	private.Chat("bk", cai.PID, cai.Gen, dea.PID, "secret whisper", nil)
	require.Eventually(t, func() bool { return len(privateLog.of(outbound.AuditChat)) == 2 }, wait, tick)
	for _, e := range privateLog.of(outbound.AuditChat) {
		assert.True(t, e.Private)
		assert.Empty(t, e.Text)
		assert.Positive(t, e.Length)
	}
	assert.Equal(t, 26, privateLog.of(outbound.AuditChat)[0].Length)
	assert.Equal(t, "dea", privateLog.of(outbound.AuditChat)[1].Target.Name)
	for _, e := range privateLog.of(outbound.AuditJoin) {
		assert.True(t, e.Private)
	}
}

func TestAuditRecordsOwnerActionsWithActorAndTarget(t *testing.T) {
	h, log := audited()
	ana := enterAs(t, h, room.Entry{Name: "ana"})
	bia := enterAs(t, h, room.Entry{Name: "bia"})
	cai := enterAs(t, h, room.Entry{Name: "cai"})
	require.NoError(t, h.Quiet("bk", ana.PID, ana.Gen, room.QuietOp("mute"), bia.PID))
	require.NoError(t, h.SetListed("bk", ana.PID, ana.Gen, true))
	proof := room.Verifier{9}
	require.NoError(t, h.SetPassword("bk", ana.PID, ana.Gen, &proof))
	require.NoError(t, h.Remove("bk", ana.PID, ana.Gen, bia.PID))
	require.NoError(t, h.Ban("bk", ana.PID, ana.Gen, cai.PID))
	require.Error(t, h.Transfer("bk", ana.PID, ana.Gen, ana.PID+99))
	require.Error(t, h.Remove("bk", bia.PID, bia.Gen, ana.PID))

	owner := log.of(outbound.AuditOwner)
	ops := make([]string, len(owner))
	for i, e := range owner {
		ops[i] = e.Op
	}
	assert.Equal(t, []string{"mute", "listed", "access", "remove", "ban"}, ops)
	assert.Equal(t, "ana", owner[0].Actor.Name)
	assert.Equal(t, "bia", owner[0].Target.Name)
	assert.True(t, *owner[1].Listed)
	assert.True(t, owner[2].Private)
	assert.Equal(t, "bia", owner[3].Target.Name)
	assert.Equal(t, "cai", owner[4].Target.Name)
}
