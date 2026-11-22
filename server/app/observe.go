package app

import (
	"context"
	"log/slog"
	"time"

	"go.opentelemetry.io/otel"

	"github.com/versatile-sh/live/server/audit"
	"github.com/versatile-sh/live/server/guestpass"
	"github.com/versatile-sh/live/server/service/presence"
)

const purgeEvery = 24 * time.Hour

func startAudit(ctx context.Context, log *slog.Logger, hub *presence.Hub, trail AuditConfig) (*audit.Writer, func()) {
	dir := trail.Dir
	if dir == "" {
		log.WarnContext(ctx, "audit disabled: AUDIT_DIR is not set")
		return nil, func() {}
	}
	cfg := audit.Config{Dir: dir, Queue: trail.Queue, Log: log, Now: time.Now}
	if trail.Mirror {
		cfg.Mirror = log
	}
	writer, err := audit.Open(cfg)
	if err != nil {
		log.ErrorContext(ctx, "audit unusable, continuing without it", "error", err.Error())
		return nil, func() {}
	}
	keep := trail.RetentionDays
	hub.UseAudit(audit.Logged{Log: log, Next: audit.NewTraced(context.WithoutCancel(ctx), otel.Tracer("live/audit"), writer)})
	go audit.RunPurge(ctx, dir, keep, purgeEvery, time.Now, log)
	log.InfoContext(ctx, "audit writer started", "dir", dir, "retention_days", keep)
	return writer, func() {
		drain, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
		defer cancel()
		if err := writer.Close(drain); err != nil {
			log.ErrorContext(drain, "audit not drained", "error", err.Error())
		}
	}
}

func reportMetrics(ctx context.Context, log *slog.Logger, hub *presence.Hub, trail *audit.Writer, ledger *guestpass.Ledger, every time.Duration) {
	if every <= 0 {
		return
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
		attrs = append(attrs, "guestpass_evicted", ledger.Evicted())
		if trail != nil {
			attrs = append(attrs, "audit_queue", trail.Depth(), "audit_written", trail.Written(), "audit_dropped", trail.Dropped(), "audit_failed", trail.Failed())
		}
		log.InfoContext(ctx, "metrics", attrs...)
	}
}
