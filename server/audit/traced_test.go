package audit

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	"github.com/versatile-sh/live/server/port/outbound"
)

const (
	joinTrace = "4bf92f3577b34da6a3ce929d0e0e4736"
	joinSpan  = "00f067aa0ba902b7"
)

func TestJoinLogLineCarriesItsTrace(t *testing.T) {
	var out bytes.Buffer
	Logged{Log: slog.New(slog.NewJSONHandler(&out, nil)), Next: outbound.NoAudit{}}.Record(outbound.AuditEvent{Kind: outbound.AuditJoin, Room: "bk", Actor: &outbound.AuditPerson{PID: 1}, TraceID: joinTrace, SpanID: joinSpan})
	var line map[string]any
	require.NoError(t, json.Unmarshal(out.Bytes(), &line))
	assert.Equal(t, joinTrace, line["trace_id"])
	assert.Equal(t, joinSpan, line["span_id"])
}

func TestTracedEmitsAStayUnderItsJoinAndARoomLinkedToItsJoins(t *testing.T) {
	spans := tracetest.NewSpanRecorder()
	traced := NewTraced(context.Background(), sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(spans)).Tracer("test"), outbound.NoAudit{})
	at := time.Date(2026, 11, 21, 12, 0, 0, 0, time.UTC)
	join := outbound.AuditEvent{Room: "bk", TraceID: joinTrace, SpanID: joinSpan}
	created, joined, left := join, join, join
	created.Kind, joined.Kind = outbound.AuditRoomCreated, outbound.AuditJoin
	left.Kind, left.At, left.DurationMS, left.Reason = outbound.AuditLeave, at, 60_000, "left"
	traced.Record(created)
	traced.Record(joined)
	traced.Record(outbound.AuditEvent{Kind: outbound.AuditJoin, Room: "bk"})
	traced.Record(left)
	traced.Record(outbound.AuditEvent{Kind: outbound.AuditRoomEnded, Room: "bk", At: at, DurationMS: 120_000})

	ended := spans.Ended()
	require.Len(t, ended, 2)
	stay, life := ended[0], ended[1]
	assert.Equal(t, "live.stay", stay.Name())
	assert.Equal(t, joinTrace, stay.SpanContext().TraceID().String())
	assert.Equal(t, joinSpan, stay.Parent().SpanID().String())
	assert.Equal(t, time.Minute, stay.EndTime().Sub(stay.StartTime()))
	assert.Equal(t, "live.room", life.Name())
	assert.Equal(t, joinSpan, life.Parent().SpanID().String())
	assert.Equal(t, 2*time.Minute, life.EndTime().Sub(life.StartTime()))
	require.Len(t, life.Links(), 1)
	assert.Equal(t, joinSpan, life.Links()[0].SpanContext.SpanID().String())
}
