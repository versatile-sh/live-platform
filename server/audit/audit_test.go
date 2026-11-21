package audit

import (
	"bytes"
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/versatile-sh/live/server/core/room"
	"github.com/versatile-sh/live/server/port/outbound"
)

var noon = time.Date(2026, 3, 10, 12, 0, 0, 0, time.UTC)

func closeWriter(t *testing.T, w *Writer) {
	t.Helper()
	ctx, stop := context.WithTimeout(context.Background(), 5*time.Second)
	defer stop()
	require.NoError(t, w.Close(ctx))
}

func collect(t *testing.T, dir string, f Filter) []outbound.AuditEvent {
	t.Helper()
	var out []outbound.AuditEvent
	_, err := Scan(dir, f, func(e outbound.AuditEvent) { out = append(out, e) })
	require.NoError(t, err)
	return out
}

func joinEvent(at time.Time, slug string, pid uint32, name, ip string, d *room.Discord) outbound.AuditEvent {
	return outbound.AuditEvent{At: at, Kind: outbound.AuditJoin, Room: slug, Actor: &outbound.AuditPerson{PID: pid, Name: name}, Client: &room.Client{IP: ip, Discord: d}}
}

func TestWriterAppendsOneLinePerEventAndRotatesByDay(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "trail")
	w, err := Open(Config{Dir: dir})
	require.NoError(t, err)
	w.Record(joinEvent(noon, "alpha", 1, "Ana", "203.0.113.1", nil))
	w.Record(joinEvent(noon.Add(time.Minute), "alpha", 2, "Bia", "203.0.113.2", nil))
	w.Record(joinEvent(noon.Add(24*time.Hour), "alpha", 3, "Caio", "203.0.113.3", nil))
	closeWriter(t, w)
	assert.EqualValues(t, 3, w.Written())
	assert.Zero(t, w.Dropped())
	first, err := os.ReadFile(filepath.Join(dir, "audit-2026-03-10.jsonl"))
	require.NoError(t, err)
	assert.Equal(t, 2, strings.Count(string(first), "\n"))
	_, err = os.Stat(filepath.Join(dir, "audit-2026-03-11.jsonl"))
	require.NoError(t, err)
	info, err := os.Stat(dir)
	require.NoError(t, err)
	assert.Zero(t, info.Mode().Perm()&0o077)
	file, err := os.Stat(filepath.Join(dir, "audit-2026-03-10.jsonl"))
	require.NoError(t, err)
	assert.Zero(t, file.Mode().Perm()&0o077)
}

func TestWriterDropsAndCountsWhenTheQueueIsFull(t *testing.T) {
	dir := t.TempDir()
	w := &Writer{dir: dir, queue: make(chan outbound.AuditEvent, 2), stop: make(chan struct{}), done: make(chan struct{})}
	for range 5 {
		w.Record(joinEvent(noon, "alpha", 1, "Ana", "203.0.113.1", nil))
	}
	assert.Equal(t, 2, w.Depth())
	assert.EqualValues(t, 3, w.Dropped())
}

func TestWriterNeverBlocksAndLosesNothingWhileItKeepsUp(t *testing.T) {
	dir := t.TempDir()
	w, err := Open(Config{Dir: dir, Queue: 100000})
	require.NoError(t, err)
	var wg sync.WaitGroup
	for g := range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range 500 {
				w.Record(joinEvent(noon, "alpha", uint32(g*1000+i), "Ana", "203.0.113.1", nil))
			}
		}()
	}
	wg.Wait()
	closeWriter(t, w)
	assert.EqualValues(t, 4000, w.Written())
	assert.Len(t, collect(t, dir, Filter{}), 4000)
}

func TestRecordAfterCloseIsDroppedNotLost(t *testing.T) {
	w, err := Open(Config{Dir: t.TempDir()})
	require.NoError(t, err)
	closeWriter(t, w)
	w.Record(joinEvent(noon, "alpha", 1, "Ana", "203.0.113.1", nil))
	assert.EqualValues(t, 1, w.Dropped())
}

func TestPrivateRoomChatContentIsNeverStored(t *testing.T) {
	dir := t.TempDir()
	w, err := Open(Config{Dir: dir})
	require.NoError(t, err)
	secret := "the launch code is swordfish"
	w.Record(outbound.AuditEvent{At: noon, Kind: outbound.AuditChat, Room: "vault", Private: true, Actor: &outbound.AuditPerson{PID: 1, Name: "Ana"}, Length: len(secret), Text: secret})
	w.Record(outbound.AuditEvent{At: noon, Kind: outbound.AuditChat, Room: "plaza", Actor: &outbound.AuditPerson{PID: 1, Name: "Ana"}, Length: 5, Text: "hello"})
	closeWriter(t, w)
	raw, err := os.ReadFile(filepath.Join(dir, FileName(noon)))
	require.NoError(t, err)
	assert.NotContains(t, string(raw), "swordfish")
	assert.Contains(t, string(raw), `"text":"hello"`)
	assert.Contains(t, string(raw), `"length":28`)
}

func TestPurgeRemovesOnlyDaysOlderThanTheRetention(t *testing.T) {
	dir := t.TempDir()
	now := time.Date(2026, 9, 10, 8, 0, 0, 0, time.UTC)
	for _, day := range []time.Time{now.AddDate(0, 0, -184), now.AddDate(0, 0, -183), now.AddDate(0, 0, -1), now} {
		require.NoError(t, os.WriteFile(filepath.Join(dir, FileName(day)), []byte("{}\n"), 0o600))
	}
	require.NoError(t, os.WriteFile(filepath.Join(dir, "notes.txt"), nil, 0o600))
	removed, err := Purge(dir, DefaultRetentionDays, now)
	require.NoError(t, err)
	assert.Equal(t, 1, removed)
	left, err := os.ReadDir(dir)
	require.NoError(t, err)
	assert.Len(t, left, 4)
	_, err = os.Stat(filepath.Join(dir, FileName(now.AddDate(0, 0, -184))))
	assert.True(t, os.IsNotExist(err))
}

func TestDayParsesOnlyAuditFiles(t *testing.T) {
	day, ok := Day("audit-2026-03-10.jsonl")
	assert.True(t, ok)
	assert.Equal(t, noon.Truncate(24*time.Hour), day)
	for _, name := range []string{"audit-2026-13-10.jsonl", "audit-2026-03-10.json", "x.jsonl", "audit-2026-3-1.jsonl"} {
		_, ok := Day(name)
		assert.False(t, ok, name)
	}
}

func TestScanFollowsAParticipantFromTheirJoinToTheirLeave(t *testing.T) {
	dir := t.TempDir()
	w, err := Open(Config{Dir: dir})
	require.NoError(t, err)
	ana := &room.Discord{UserID: "u-1", UserName: "ana", GuildID: "g-1", ChannelID: "c-1"}
	w.Record(joinEvent(noon, "alpha", 1, "Ana", "203.0.113.1", ana))
	w.Record(joinEvent(noon.Add(time.Second), "alpha", 2, "Bia", "203.0.113.2", nil))
	w.Record(outbound.AuditEvent{At: noon.Add(2 * time.Second), Kind: outbound.AuditChat, Room: "alpha", Actor: &outbound.AuditPerson{PID: 1, Name: "Ana"}, Length: 2, Text: "oi"})
	w.Record(outbound.AuditEvent{At: noon.Add(3 * time.Second), Kind: outbound.AuditChat, Room: "alpha", Actor: &outbound.AuditPerson{PID: 2, Name: "Bia"}, Length: 3, Text: "yes"})
	w.Record(outbound.AuditEvent{At: noon.Add(4 * time.Second), Kind: outbound.AuditOwner, Room: "alpha", Op: "ban", Actor: &outbound.AuditPerson{PID: 2, Name: "Bia"}, Target: &outbound.AuditPerson{PID: 1, Name: "Ana"}})
	w.Record(outbound.AuditEvent{At: noon.Add(5 * time.Second), Kind: outbound.AuditLeave, Room: "alpha", Actor: &outbound.AuditPerson{PID: 1, Name: "Ana"}, Reason: "banned"})
	w.Record(outbound.AuditEvent{At: noon.Add(6 * time.Second), Kind: outbound.AuditChat, Room: "alpha", Actor: &outbound.AuditPerson{PID: 1, Name: "Ana"}, Text: "reused pid after leave"})
	closeWriter(t, w)

	byIP := collect(t, dir, Filter{IP: "203.0.113.1"})
	assert.Equal(t, []outbound.AuditKind{outbound.AuditJoin, outbound.AuditChat, outbound.AuditOwner, outbound.AuditLeave}, kinds(byIP))
	assert.Len(t, collect(t, dir, Filter{DiscordUser: "u-1"}), 4)
	assert.Len(t, collect(t, dir, Filter{Guild: "g-1"}), 4)
	assert.Empty(t, collect(t, dir, Filter{Guild: "g-other"}))
	assert.Len(t, collect(t, dir, Filter{Room: "alpha", Kind: outbound.AuditChat}), 3)
	assert.Len(t, collect(t, dir, Filter{From: noon.Add(3 * time.Second), To: noon.Add(5 * time.Second)}), 2)
	assert.Empty(t, collect(t, dir, Filter{Room: "beta"}))
}

func TestScanSkipsLinesItCannotRead(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, FileName(noon)), []byte("not json\n{\"kind\":\"join\",\"room\":\"a\"}\n"), 0o600))
	var seen int
	skipped, err := Scan(dir, Filter{}, func(outbound.AuditEvent) { seen++ })
	require.NoError(t, err)
	assert.Equal(t, 1, skipped)
	assert.Equal(t, 1, seen)
}

func TestTimelineShowsTheFactsAndOnlyThePublicText(t *testing.T) {
	var out bytes.Buffer
	require.NoError(t, WriteTimeline(&out, outbound.AuditEvent{At: noon, Kind: outbound.AuditJoin, Room: "alpha", Actor: &outbound.AuditPerson{PID: 1, Name: "Ana"},
		Client:  &room.Client{IP: "203.0.113.1", Geo: room.Geo{Country: "BR", City: "Recife"}, Browser: "Firefox 140", OS: "Linux", Device: "desktop", Discord: &room.Discord{UserID: "u-1", GuildID: "g-1", ChannelID: "c-1"}},
		Present: []outbound.AuditPerson{{PID: 2, Name: "Bia"}}}))
	line := out.String()
	for _, want := range []string{"join", "room=alpha", "ip=203.0.113.1", "geo=BR/Recife", "Firefox 140 on Linux desktop", "discord=u-1", "guild=g-1", "channel=c-1", `present=#2:"Bia"`} {
		assert.Contains(t, line, want)
	}
}

func kinds(events []outbound.AuditEvent) []outbound.AuditKind {
	out := make([]outbound.AuditKind, len(events))
	for i, e := range events {
		out[i] = e.Kind
	}
	return out
}

func TestMirrorEmitsEachWrittenEventAsOneLogRecordWithoutPrivateText(t *testing.T) {
	var out bytes.Buffer
	w, err := Open(Config{Dir: t.TempDir(), Mirror: slog.New(slog.NewJSONHandler(&out, nil))})
	require.NoError(t, err)
	w.Record(joinEvent(noon, "plaza", 1, "Ana", "203.0.113.1", &room.Discord{UserID: "42", GuildID: "g1"}))
	w.Record(outbound.AuditEvent{At: noon, Kind: outbound.AuditChat, Room: "vault", Private: true, Actor: &outbound.AuditPerson{PID: 1, Name: "Ana"}, Length: 28, Text: "the launch code is swordfish"})
	closeWriter(t, w)
	lines := strings.Split(strings.TrimSpace(out.String()), "\n")
	require.Len(t, lines, 2)
	assert.True(t, strings.HasPrefix(lines[0], `{"time":"`))
	assert.Contains(t, lines[0], `"msg":"audit"`)
	assert.Contains(t, lines[0], `"kind":"join"`)
	assert.Contains(t, lines[0], `"guild_id":"g1"`)
	assert.NotContains(t, out.String(), "swordfish")
}
