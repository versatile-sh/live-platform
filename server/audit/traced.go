package audit

import (
	"context"
	"sync"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/versatile-sh/live/server/port/outbound"
)

const maxRoomLinks = 64

// Traced turns a stay and a room's life into spans once they end: a stay is a child of its join, a room of its first join, linked to the rest.
type Traced struct {
	next  outbound.Audit
	start func(parent trace.SpanContext, name string, opts ...trace.SpanStartOption) trace.Span
	mu    sync.Mutex
	rooms map[string]*tracedRoom
}

// NewTraced builds a Traced that starts its spans with tracer under ctx and hands every event to next.
func NewTraced(ctx context.Context, tracer trace.Tracer, next outbound.Audit) *Traced {
	return &Traced{next: next, rooms: map[string]*tracedRoom{}, start: func(parent trace.SpanContext, name string, opts ...trace.SpanStartOption) trace.Span {
		_, span := tracer.Start(trace.ContextWithRemoteSpanContext(ctx, parent), name, opts...)
		return span
	}}
}

type tracedRoom struct {
	parent trace.SpanContext
	links  []trace.Link
}

// Record emits the span an event closes, if any, and hands the event to the next audit.
func (t *Traced) Record(e outbound.AuditEvent) {
	switch e.Kind {
	case outbound.AuditRoomCreated:
		t.room(e.Room).parent = spanContext(e)
	case outbound.AuditJoin:
		if sc := spanContext(e); sc.IsValid() {
			r := t.room(e.Room)
			if len(r.links) < maxRoomLinks {
				r.links = append(r.links, trace.Link{SpanContext: sc})
			}
		}
	case outbound.AuditLeave:
		if sc := spanContext(e); sc.IsValid() {
			t.emit(sc, "live.stay", e, trace.WithAttributes(attribute.String("live.reason", e.Reason)))
		}
	case outbound.AuditRoomEnded:
		t.mu.Lock()
		r := t.rooms[e.Room]
		delete(t.rooms, e.Room)
		t.mu.Unlock()
		if r == nil {
			r = &tracedRoom{}
		}
		t.emit(r.parent, "live.room", e, trace.WithAttributes(attribute.Int("live.joins", len(r.links))), trace.WithLinks(r.links...))
	}
	t.next.Record(e)
}

func (t *Traced) room(slug string) *tracedRoom {
	t.mu.Lock()
	defer t.mu.Unlock()
	r := t.rooms[slug]
	if r == nil {
		r = &tracedRoom{}
		t.rooms[slug] = r
	}
	return r
}

func (t *Traced) emit(parent trace.SpanContext, name string, e outbound.AuditEvent, opts ...trace.SpanStartOption) {
	opts = append(opts, trace.WithTimestamp(e.At.Add(-time.Duration(e.DurationMS)*time.Millisecond)), trace.WithAttributes(attribute.String("live.room", e.Room), attribute.Bool("live.private", e.Private)))
	t.start(parent, name, opts...).End(trace.WithTimestamp(e.At))
}

func spanContext(e outbound.AuditEvent) trace.SpanContext {
	traceID, err := trace.TraceIDFromHex(e.TraceID)
	if err != nil {
		return trace.SpanContext{}
	}
	spanID, err := trace.SpanIDFromHex(e.SpanID)
	if err != nil {
		return trace.SpanContext{}
	}
	return trace.NewSpanContext(trace.SpanContextConfig{TraceID: traceID, SpanID: spanID, TraceFlags: trace.FlagsSampled, Remote: true})
}
