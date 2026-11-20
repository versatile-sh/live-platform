package main

import (
	"bytes"
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/versatile-sh/live/server/internal/adapters/audit"
	"github.com/versatile-sh/live/server/internal/application/presence"
	"github.com/versatile-sh/live/server/internal/domain/room"
)

func noEnv(string) string { return "" }

func writeTrail(t *testing.T, dir string) {
	t.Helper()
	day := time.Date(2026, 3, 10, 12, 0, 0, 0, time.UTC)
	lines := `{"at":"2026-03-10T12:00:00Z","kind":"join","room":"alpha","private":false,"actor":{"pid":1,"name":"Ana"},"client":{"ip":"203.0.113.1","geo":{"country":"BR"},"discord":{"user_id":"42","guild_id":"7","channel_id":"9"}}}
{"at":"2026-03-10T12:00:05Z","kind":"chat","room":"alpha","private":false,"actor":{"pid":1,"name":"Ana"},"length":2,"text":"oi"}
{"at":"2026-03-10T12:00:09Z","kind":"join","room":"beta","private":true,"actor":{"pid":1,"name":"Bia"},"client":{"ip":"203.0.113.2","geo":{}}}
`
	require.NoError(t, os.WriteFile(filepath.Join(dir, audit.FileName(day)), []byte(lines), 0o600))
}

func TestAuditCommandPrintsAFilteredTimeline(t *testing.T) {
	dir := t.TempDir()
	writeTrail(t, dir)
	var out, errOut bytes.Buffer
	code := runAudit([]string{"--dir", dir, "--discord-user", "42", "--from", "2026-03-10", "--to", "2026-03-10"}, noEnv, &out, &errOut)
	require.Zero(t, code, errOut.String())
	assert.Contains(t, out.String(), "ip=203.0.113.1")
	assert.Contains(t, out.String(), `text="oi"`)
	assert.NotContains(t, out.String(), "beta")
	assert.Contains(t, errOut.String(), "2 events")
}

func TestAuditCommandReadsTheDirectoryFromTheEnvironmentAndCanPrintJSON(t *testing.T) {
	dir := t.TempDir()
	writeTrail(t, dir)
	var out, errOut bytes.Buffer
	env := func(k string) string {
		if k == "AUDIT_DIR" {
			return dir
		}
		return ""
	}
	require.Zero(t, runAudit([]string{"--room", "beta", "--json"}, env, &out, &errOut))
	assert.Equal(t, 1, strings.Count(out.String(), "\n"))
	assert.Contains(t, out.String(), `"room":"beta"`)
}

func TestAuditCommandRefusesWithoutADirectoryOrWithABadDate(t *testing.T) {
	var out, errOut bytes.Buffer
	assert.Equal(t, 2, runAudit(nil, noEnv, &out, &errOut))
	assert.Contains(t, errOut.String(), "AUDIT_DIR")
	assert.Equal(t, 2, runAudit([]string{"--dir", t.TempDir(), "--from", "yesterday"}, noEnv, &out, &errOut))
}

func TestStartAuditStartsTheWriterAndPurgesOldDays(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "trail")
	require.NoError(t, os.MkdirAll(dir, 0o700))
	old := filepath.Join(dir, audit.FileName(time.Now().AddDate(0, 0, -400)))
	require.NoError(t, os.WriteFile(old, []byte("{}\n"), 0o600))
	env := func(k string) string {
		if k == "AUDIT_DIR" {
			return dir
		}
		return ""
	}
	hub := presence.NewHub(room.DefaultConfig(), presence.DefaultLiveness(), time.Now)
	ctx, stop := context.WithCancel(context.Background())
	defer stop()
	writer, drain := startAudit(ctx, slog.New(slog.DiscardHandler), hub, env)
	require.NotNil(t, writer)
	drain()
	require.Eventually(t, func() bool { _, err := os.Stat(old); return os.IsNotExist(err) }, 2*time.Second, 10*time.Millisecond)
}

func TestStartAuditIsOffWithoutADirectory(t *testing.T) {
	hub := presence.NewHub(room.DefaultConfig(), presence.DefaultLiveness(), time.Now)
	writer, drain := startAudit(context.Background(), slog.New(slog.DiscardHandler), hub, noEnv)
	assert.Nil(t, writer)
	drain()
}
