package guestpass

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"sync"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"

	"github.com/versatile-sh/live/server/core/room"
	"github.com/versatile-sh/live/server/port/outbound"
)

const (
	ledgerTTL  = 15 * time.Minute
	reentryTTL = 12 * time.Hour
	ledgerCap  = 16384
	sweepAbove = 1024
)

type remembered struct {
	record  outbound.PassRecord
	expires time.Time
}

// Ledger keeps in memory who each handed-out pass vouched for: a quarter of an hour for a pass the issuer handed, twelve hours for the
// re-entry pass a join receives in its place.
type Ledger struct {
	now     func() time.Time
	mu      sync.Mutex
	entries map[string]remembered
}

// NewLedger builds an empty ledger that reads time from now.
func NewLedger(now func() time.Time) *Ledger {
	return &Ledger{now: now, entries: map[string]remembered{}}
}

// Remember keeps what a pass vouched for; when the ledger is full of live entries the newest is not kept.
func (l *Ledger) Remember(id string, record outbound.PassRecord) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	if len(l.entries) > sweepAbove {
		for k, v := range l.entries {
			if !now.Before(v.expires) {
				delete(l.entries, k)
			}
		}
	}
	if len(l.entries) >= ledgerCap {
		return
	}
	l.entries[id] = remembered{record: record, expires: now.Add(ledgerTTL)}
}

// Recall returns what a pass vouched for, or false when it is unknown, spent or expired.
func (l *Ledger) Recall(id string) (outbound.PassRecord, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	v, ok := l.entries[id]
	if !ok || !l.now().Before(v.expires) {
		delete(l.entries, id)
		return outbound.PassRecord{}, false
	}
	return v.record, true
}

// Renew forgets a pass that was used to enter and keeps what it vouched for under a fresh id, without the issuer's trace, for twelve hours;
// false when the pass is unknown, spent or expired.
func (l *Ledger) Renew(id string) (string, bool) {
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", false
	}
	next := base64.RawURLEncoding.EncodeToString(raw[:])
	l.mu.Lock()
	defer l.mu.Unlock()
	v, ok := l.entries[id]
	delete(l.entries, id)
	now := l.now()
	if !ok || !now.Before(v.expires) {
		return "", false
	}
	v.record.TraceParent = ""
	l.entries[next] = remembered{record: v.record, expires: now.Add(reentryTTL)}
	return next, true
}

// Remembering takes passes from another source and notes in a ledger the Discord origin each one vouches for.
type Remembering struct {
	Passes outbound.GuestPasses
	Ledger outbound.PassLedger
	Now    func() time.Time
}

// Take returns the pass and, when it names a Discord user, remembers who it vouched for and the trace its take continued.
func (r Remembering) Take(ctx context.Context, id string) (outbound.GuestPass, bool) {
	began := r.Now()
	pass, ok := r.Passes.Take(ctx, id)
	parent := traceTake(ctx, pass.TraceParent, began, ok)
	if ok && pass.DiscordUserID != "" {
		r.Ledger.Remember(id, outbound.PassRecord{
			Slug:        room.Slug(pass.Slug),
			Discord:     room.Discord{UserID: pass.DiscordUserID, UserName: pass.DiscordName, GuildID: pass.GuildID, ChannelID: pass.ChannelID},
			TraceParent: parent,
		})
	}
	return pass, ok
}

func traceTake(ctx context.Context, parent string, began time.Time, ok bool) string {
	w3c := propagation.TraceContext{}
	ctx = w3c.Extract(ctx, propagation.MapCarrier{"traceparent": parent})
	ctx, span := otel.Tracer("live/guestpass").Start(ctx, "live.pass.take", trace.WithTimestamp(began), trace.WithSpanKind(trace.SpanKindClient))
	defer span.End()
	if !ok {
		span.SetStatus(codes.Error, "no pass")
	}
	carrier := propagation.MapCarrier{}
	w3c.Inject(ctx, carrier)
	return carrier["traceparent"]
}
