package guestpass

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/versatile-sh/live/server/core/room"
	"github.com/versatile-sh/live/server/port/outbound"
)

type onePass struct{ pass outbound.GuestPass }

func (o onePass) Take(context.Context, string) (outbound.GuestPass, bool) { return o.pass, true }

func TestLedgerRecallsUntilSpentOrExpired(t *testing.T) {
	now := time.Date(2026, 3, 10, 12, 0, 0, 0, time.UTC)
	ledger := NewLedger(func() time.Time { return now })
	record := outbound.PassRecord{Slug: "a-b", Discord: room.Discord{UserID: "1"}}
	ledger.Remember("p1", record)
	ledger.Remember("p2", record)
	got, ok := ledger.Recall("p1")
	assert.True(t, ok)
	assert.Equal(t, record, got)
	ledger.Spend("p1")
	_, ok = ledger.Recall("p1")
	assert.False(t, ok)
	now = now.Add(ledgerTTL)
	_, ok = ledger.Recall("p2")
	assert.False(t, ok)
	_, ok = ledger.Recall("unknown")
	assert.False(t, ok)
}

func TestRememberingNotesOnlyPassesThatNameADiscordUser(t *testing.T) {
	ledger := NewLedger(time.Now)
	named := Remembering{Passes: onePass{outbound.GuestPass{Name: "Ana", Slug: "a-b", DiscordUserID: "7", GuildID: "g", ChannelID: "c"}}, Ledger: ledger}
	_, ok := named.Take(context.Background(), "named")
	assert.True(t, ok)
	got, found := ledger.Recall("named")
	assert.True(t, found)
	assert.Equal(t, room.Slug("a-b"), got.Slug)
	assert.Equal(t, room.Discord{UserID: "7", GuildID: "g", ChannelID: "c"}, got.Discord)
	plain := Remembering{Passes: onePass{outbound.GuestPass{Name: "Bia", Slug: "a-b"}}, Ledger: ledger}
	_, _ = plain.Take(context.Background(), "plain")
	_, found = ledger.Recall("plain")
	assert.False(t, found)
}

func TestTakeKeepsAndCleansTheDiscordOrigin(t *testing.T) {
	s := issuer(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"name":"Ana","slug":"a-b","discordUserId":"123456789","discordName":"ana\u0007","guildId":"not-a-number","channelId":"42"}`))
	})
	p, ok := s.Take(context.Background(), "abcdefghijklmnopqrstuv")
	require.True(t, ok)
	assert.Equal(t, "123456789", p.DiscordUserID)
	assert.Equal(t, "ana", p.DiscordName)
	assert.Empty(t, p.GuildID)
	assert.Equal(t, "42", p.ChannelID)
}

func TestTakeToleratesAPassWithoutTheDiscordOrigin(t *testing.T) {
	s := issuer(t, func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(`{"name":"Ana","slug":"a-b"}`)) })
	p, ok := s.Take(context.Background(), "abcdefghijklmnopqrstuv")
	require.True(t, ok)
	assert.Empty(t, p.DiscordUserID)
}
