package app

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/versatile-sh/live/server/audit"
	"github.com/versatile-sh/live/server/core/room"
	"github.com/versatile-sh/live/server/service/presence"
)

func TestStartAuditStartsTheWriterAndPurgesOldDays(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "trail")
	require.NoError(t, os.MkdirAll(dir, 0o700))
	old := filepath.Join(dir, audit.FileName(time.Now().AddDate(0, 0, -400)))
	require.NoError(t, os.WriteFile(old, []byte("{}\n"), 0o600))
	hub := presence.NewHub(room.DefaultConfig(), presence.DefaultLiveness(), time.Now)
	ctx, stop := context.WithCancel(context.Background())
	defer stop()
	writer, drain := startAudit(ctx, slog.New(slog.DiscardHandler), hub, AuditConfig{Dir: dir, RetentionDays: audit.DefaultRetentionDays})
	require.NotNil(t, writer)
	drain()
	require.Eventually(t, func() bool { _, err := os.Stat(old); return os.IsNotExist(err) }, 2*time.Second, 10*time.Millisecond)
}

func TestStartAuditIsOffWithoutADirectory(t *testing.T) {
	hub := presence.NewHub(room.DefaultConfig(), presence.DefaultLiveness(), time.Now)
	writer, drain := startAudit(context.Background(), slog.New(slog.DiscardHandler), hub, AuditConfig{})
	assert.Nil(t, writer)
	drain()
}
