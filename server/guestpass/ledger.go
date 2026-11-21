package guestpass

import (
	"context"
	"sync"
	"time"

	"github.com/versatile-sh/live/server/core/room"
	"github.com/versatile-sh/live/server/port/outbound"
)

const (
	ledgerTTL  = 15 * time.Minute
	ledgerCap  = 16384
	sweepAbove = 1024
)

type remembered struct {
	record  outbound.PassRecord
	expires time.Time
}

// Ledger keeps in memory who each handed-out pass vouched for, until it is spent or a quarter of an hour has passed.
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

// Spend forgets a pass once it has been used to enter.
func (l *Ledger) Spend(id string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.entries, id)
}

// Remembering takes passes from another source and notes in a ledger the Discord origin each one vouches for.
type Remembering struct {
	Passes outbound.GuestPasses
	Ledger outbound.PassLedger
}

// Take returns the pass and, when it names a Discord user, remembers who it vouched for under its id.
func (r Remembering) Take(ctx context.Context, id string) (outbound.GuestPass, bool) {
	pass, ok := r.Passes.Take(ctx, id)
	if ok && pass.DiscordUserID != "" {
		r.Ledger.Remember(id, outbound.PassRecord{
			Slug:    room.Slug(pass.Slug),
			Discord: room.Discord{UserID: pass.DiscordUserID, UserName: pass.DiscordName, GuildID: pass.GuildID, ChannelID: pass.ChannelID},
		})
	}
	return pass, ok
}
