package guestpass

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace/noop"

	"github.com/versatile-sh/live/server/core/room"
	"github.com/versatile-sh/live/server/port/outbound"
)

type onePass struct{ pass outbound.GuestPass }

func (o onePass) Take(context.Context, string) (outbound.GuestPass, bool) { return o.pass, true }

func TestLedgerRecallsUntilRenewedOrExpired(t *testing.T) {
	now := time.Date(2026, 3, 10, 12, 0, 0, 0, time.UTC)
	ledger := NewLedger(func() time.Time { return now })
	record := outbound.PassRecord{Slug: "a-b", Discord: room.Discord{UserID: "1"}}
	ledger.Remember("p1", record)
	ledger.Remember("p2", record)
	got, ok := ledger.Recall("p1")
	assert.True(t, ok)
	assert.Equal(t, record, got)
	_, ok = ledger.Renew("p1")
	assert.True(t, ok)
	_, ok = ledger.Recall("p1")
	assert.False(t, ok)
	now = now.Add(ledgerTTL)
	_, ok = ledger.Recall("p2")
	assert.False(t, ok)
	_, ok = ledger.Recall("unknown")
	assert.False(t, ok)
}

func TestRenewHandsAFreshPassForTheSameRoomForTwelveHours(t *testing.T) {
	now := time.Date(2026, 3, 10, 12, 0, 0, 0, time.UTC)
	ledger := NewLedger(func() time.Time { return now })
	ledger.Remember("p1", outbound.PassRecord{Slug: "a-b", Discord: room.Discord{UserID: "1"}, TraceParent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"})

	next, ok := ledger.Renew("p1")
	require.True(t, ok)
	assert.Regexp(t, `^[A-Za-z0-9_-]{43}$`, next)
	got, ok := ledger.Recall(next)
	require.True(t, ok)
	assert.Equal(t, outbound.PassRecord{Slug: "a-b", Discord: room.Discord{UserID: "1"}}, got, "the re-entry pass vouches for the same person and room, without the issuer's trace")

	again, ok := ledger.Renew(next)
	require.True(t, ok)
	assert.NotEqual(t, next, again)
	_, ok = ledger.Recall(next)
	assert.False(t, ok, "each entry retires the pass it used")

	now = now.Add(reentryTTL - time.Second)
	_, ok = ledger.Recall(again)
	assert.True(t, ok)
	now = now.Add(time.Second)
	_, ok = ledger.Recall(again)
	assert.False(t, ok)
	_, ok = ledger.Renew("unknown")
	assert.False(t, ok)
}

func TestRememberingNotesOnlyPassesThatNameADiscordUser(t *testing.T) {
	ledger := NewLedger(time.Now)
	named := Remembering{Passes: onePass{outbound.GuestPass{Name: "Ana", Slug: "a-b", DiscordUserID: "7", GuildID: "g", ChannelID: "c"}}, Ledger: ledger, Now: time.Now}
	_, ok := named.Take(context.Background(), "named")
	assert.True(t, ok)
	got, found := ledger.Recall("named")
	assert.True(t, found)
	assert.Equal(t, room.Slug("a-b"), got.Slug)
	assert.Equal(t, room.Discord{UserID: "7", GuildID: "g", ChannelID: "c"}, got.Discord)
	plain := Remembering{Passes: onePass{outbound.GuestPass{Name: "Bia", Slug: "a-b"}}, Ledger: ledger, Now: time.Now}
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

const (
	issuerTrace = "4bf92f3577b34da6a3ce929d0e0e4736"
	issuerSpan  = "00f067aa0ba902b7"
)

func TestTakeContinuesTheIssuersTrace(t *testing.T) {
	spans := tracetest.NewSpanRecorder()
	otel.SetTracerProvider(sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(spans)))
	t.Cleanup(func() { otel.SetTracerProvider(noop.NewTracerProvider()) })
	ledger := NewLedger(time.Now)
	pass := outbound.GuestPass{Name: "Ana", Slug: "a-b", DiscordUserID: "7", TraceParent: "00-" + issuerTrace + "-" + issuerSpan + "-01"}
	_, ok := Remembering{Passes: onePass{pass}, Ledger: ledger, Now: time.Now}.Take(context.Background(), "traced")
	require.True(t, ok)
	got, found := ledger.Recall("traced")
	require.True(t, found)
	ended := spans.Ended()
	require.Len(t, ended, 1)
	take := ended[0]
	assert.Equal(t, "live.pass.take", take.Name())
	assert.Equal(t, issuerTrace, take.SpanContext().TraceID().String())
	assert.Equal(t, issuerSpan, take.Parent().SpanID().String())
	assert.Equal(t, "00-"+issuerTrace+"-"+take.SpanContext().SpanID().String()+"-01", got.TraceParent)
}

func TestTakeDropsAMalformedTraceparent(t *testing.T) {
	s := issuer(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"name":"Ana","slug":"a-b","traceparent":"00-not-a-trace-01"}`))
	})
	p, ok := s.Take(context.Background(), "abcdefghijklmnopqrstuv")
	require.True(t, ok)
	assert.Empty(t, p.TraceParent)
}
