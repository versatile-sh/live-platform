package audit

import (
	"log/slog"

	"github.com/versatile-sh/live/server/port/outbound"
)

// Logged writes a structured log line for joins, leaves and ended rooms, then passes every event on; the line carries no address, name or text.
type Logged struct {
	Log  *slog.Logger
	Next outbound.Audit
}

// Record logs the event's shape and hands the whole event to the next audit.
func (l Logged) Record(e outbound.AuditEvent) {
	switch e.Kind {
	case outbound.AuditJoin:
		attrs := []any{"room", e.Room, "private", e.Private, "pid", e.Actor.PID, "present", len(e.Present)}
		if c := e.Client; c != nil {
			attrs = append(attrs, "country", c.Geo.Country, "discord", c.Discord != nil)
		}
		l.Log.Info("join", attrs...)
	case outbound.AuditLeave:
		l.Log.Info("leave", "room", e.Room, "pid", e.Actor.PID, "reason", e.Reason, "duration_ms", e.DurationMS)
	case outbound.AuditRoomCreated:
		l.Log.Info("room created", "room", e.Room, "private", e.Private)
	case outbound.AuditRoomEnded:
		l.Log.Info("room ended", "room", e.Room, "duration_ms", e.DurationMS)
	}
	l.Next.Record(e)
}
