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

	"github.com/versatile-sh/live/server/core/room"
	"github.com/versatile-sh/live/server/port/outbound"
)

func TestTroubles(t *testing.T) {
	var out bytes.Buffer
	spans := tracetest.NewSpanRecorder()
	troubles := NewTroubles(context.Background(), slog.New(slog.NewJSONHandler(&out, nil)), sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(spans)).Tracer("test"))
	at := time.Date(2026, 11, 21, 12, 0, 0, 0, time.UTC)

	t.Run("a trouble is a warning line with the stay's trace ids and a span under that stay", func(t *testing.T) {
		troubles.Report(outbound.MediaTroubleEvent{At: at, Room: "bk", PID: 3, Trouble: room.TroubleOfferRejected, Detail: "InvalidStateError: connection closed", TraceID: joinTrace, SpanID: joinSpan})
		var line map[string]any
		require.NoError(t, json.Unmarshal(out.Bytes(), &line))
		assert.Equal(t, "WARN", line["level"])
		assert.Equal(t, "media trouble", line["msg"])
		assert.Equal(t, "offer.rejected", line["trouble"])
		assert.Equal(t, "server", line["from"])
		assert.Equal(t, "InvalidStateError: connection closed", line["detail"])
		assert.Equal(t, joinTrace, line["trace_id"])
		ended := spans.Ended()
		require.Len(t, ended, 1)
		assert.Equal(t, "live.media.trouble", ended[0].Name())
		assert.Equal(t, joinTrace, ended[0].Parent().TraceID().String())
		assert.Equal(t, joinSpan, ended[0].Parent().SpanID().String())
	})

	t.Run("a trouble outside a traced stay is still logged, with no span", func(t *testing.T) {
		out.Reset()
		troubles.Report(outbound.MediaTroubleEvent{At: at, Room: "bk", PID: 4, Trouble: room.TroubleAnswerLate, Browser: true})
		var line map[string]any
		require.NoError(t, json.Unmarshal(out.Bytes(), &line))
		assert.Equal(t, "browser", line["from"])
		assert.NotContains(t, line, "detail")
		assert.Len(t, spans.Ended(), 1)
	})
}
