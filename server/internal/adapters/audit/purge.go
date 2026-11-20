package audit

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"time"
)

// DefaultRetentionDays is how long the trail is kept: the six months the Marco Civil da Internet asks for, in days.
const DefaultRetentionDays = 183

// Purge deletes every day file older than keepDays whole days before now and answers how many it removed; files it does not recognise are left alone.
func Purge(dir string, keepDays int, now time.Time) (int, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0, err
	}
	today := now.UTC().Truncate(24 * time.Hour)
	cutoff := today.AddDate(0, 0, -keepDays)
	removed := 0
	for _, entry := range entries {
		day, ok := Day(entry.Name())
		if !ok || entry.IsDir() || !day.Before(cutoff) {
			continue
		}
		if err := os.Remove(filepath.Join(dir, entry.Name())); err != nil {
			return removed, err
		}
		removed++
	}
	return removed, nil
}

// RunPurge purges at once and then every interval until ctx ends, logging what it removed and any failure.
func RunPurge(ctx context.Context, dir string, keepDays int, interval time.Duration, log *slog.Logger) {
	tick := time.NewTicker(interval)
	defer tick.Stop()
	for {
		switch removed, err := Purge(dir, keepDays, time.Now()); {
		case err != nil:
			log.Error("audit purge failed", "error", err.Error())
		case removed > 0:
			log.Info("audit purged", "files", removed, "keep_days", keepDays)
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}
