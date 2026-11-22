package audit

import (
	"context"
	"log/slog"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/versatile-sh/live/server/port/outbound"
)

// Troubles writes a warning line for every trouble on a media path and, when the stay is traced, a span under it, so a lost picture in production shows in the logs and in the stay's trace.
type Troubles struct {
	log   *slog.Logger
	start func(parent trace.SpanContext, opts ...trace.SpanStartOption) trace.Span
}

// NewTroubles builds Troubles that log to log and start their spans with tracer under ctx.
func NewTroubles(ctx context.Context, log *slog.Logger, tracer trace.Tracer) Troubles {
	return Troubles{log: log, start: func(parent trace.SpanContext, opts ...trace.SpanStartOption) trace.Span {
		_, span := tracer.Start(trace.ContextWithRemoteSpanContext(ctx, parent), "live.media.trouble", opts...)
		return span
	}}
}

// Report logs the trouble with the stay's trace ids and records it as a span of that stay.
func (t Troubles) Report(e outbound.MediaTroubleEvent) {
	from := "server"
	if e.Browser {
		from = "browser"
	}
	attrs := []any{"room", e.Room, "pid", e.PID, "trouble", e.Trouble, "from", from}
	if e.Detail != "" {
		attrs = append(attrs, "detail", e.Detail)
	}
	if e.TraceID != "" {
		attrs = append(attrs, "trace_id", e.TraceID, "span_id", e.SpanID)
	}
	t.log.Warn("media trouble", attrs...)
	sc := spanContext(outbound.AuditEvent{TraceID: e.TraceID, SpanID: e.SpanID})
	if !sc.IsValid() {
		return
	}
	span := t.start(sc, trace.WithTimestamp(e.At), trace.WithAttributes(
		attribute.String("live.room", e.Room),
		attribute.String("live.trouble", e.Trouble),
		attribute.String("live.from", from),
		attribute.String("live.detail", e.Detail),
	))
	span.End(trace.WithTimestamp(e.At))
}
