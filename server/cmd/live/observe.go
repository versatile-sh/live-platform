package main

import (
	"context"
	"log/slog"
	"strconv"
	"time"

	"github.com/versatile-sh/live/server/internal/adapters/audit"
	"github.com/versatile-sh/live/server/internal/application/presence"
)

const (
	purgeEvery     = 24 * time.Hour
	metricsDefault = time.Minute
)

func startAudit(ctx context.Context, log *slog.Logger, hub *presence.Hub, getenv func(string) string) (*audit.Writer, func()) {
	dir := getenv("AUDIT_DIR")
	if dir == "" {
		log.WarnContext(ctx, "audit disabled: AUDIT_DIR is not set")
		return nil, func() {}
	}
	queue, _ := strconv.Atoi(getenv("AUDIT_QUEUE"))
	cfg := audit.Config{Dir: dir, Queue: queue, Log: log}
	if on, _ := strconv.ParseBool(getenv("AUDIT_LOG_STDOUT")); on {
		cfg.Mirror = log
	}
	writer, err := audit.Open(cfg)
	if err != nil {
		log.ErrorContext(ctx, "audit unusable, continuing without it", "error", err.Error())
		return nil, func() {}
	}
	keep := audit.DefaultRetentionDays
	if n, err := strconv.Atoi(getenv("AUDIT_RETENTION_DAYS")); err == nil && n > 0 {
		keep = n
	}
	hub.UseAudit(audit.Logged{Log: log, Next: writer})
	go audit.RunPurge(ctx, dir, keep, purgeEvery, log)
	log.InfoContext(ctx, "audit writer started", "dir", dir, "retention_days", keep)
	return writer, func() {
		drain, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
		defer cancel()
		if err := writer.Close(drain); err != nil {
			log.ErrorContext(drain, "audit not drained", "error", err.Error())
		}
	}
}

func reportMetrics(ctx context.Context, log *slog.Logger, hub *presence.Hub, trail *audit.Writer, getenv func(string) string) {
	every := metricsDefault
	if raw := getenv("METRICS_INTERVAL"); raw != "" {
		parsed, err := time.ParseDuration(raw)
		if err != nil || parsed <= 0 {
			return
		}
		every = parsed
	}
	tick := time.NewTicker(every)
	defer tick.Stop()
	var last uint64
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
		rooms, people, joins := hub.Stats()
		attrs := []any{"rooms", rooms, "people", people, "joins_total", joins, "joins_per_min", float64(joins-last) * float64(time.Minute) / float64(every)}
		last = joins
		if trail != nil {
			attrs = append(attrs, "audit_queue", trail.Depth(), "audit_written", trail.Written(), "audit_dropped", trail.Dropped(), "audit_failed", trail.Failed())
		}
		log.InfoContext(ctx, "metrics", attrs...)
	}
}
