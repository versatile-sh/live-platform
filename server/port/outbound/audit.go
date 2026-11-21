package outbound

import (
	"time"

	"github.com/versatile-sh/live/server/core/room"
)

// AuditKind names what an audit event records.
type AuditKind string

// Kinds of audit event.
const (
	AuditRoomCreated AuditKind = "room.created"
	AuditJoin        AuditKind = "join"
	AuditLeave       AuditKind = "leave"
	AuditChat        AuditKind = "chat"
	AuditOwner       AuditKind = "owner"
	AuditRoomEnded   AuditKind = "room.ended"
)

// AuditPerson names a participant as the room knew them at the time.
type AuditPerson struct {
	PID  uint32 `json:"pid"`
	Name string `json:"name"`
}

// AuditEvent is one append-only fact; chat text is present only for a public room, a private room keeps its length alone.
type AuditEvent struct {
	At         time.Time     `json:"at"`
	Kind       AuditKind     `json:"kind"`
	Room       string        `json:"room"`
	Private    bool          `json:"private"`
	Listed     *bool         `json:"listed,omitempty"`
	Actor      *AuditPerson  `json:"actor,omitempty"`
	Target     *AuditPerson  `json:"target,omitempty"`
	Client     *room.Client  `json:"client,omitempty"`
	Look       string        `json:"look,omitempty"`
	Present    []AuditPerson `json:"present,omitempty"`
	Op         string        `json:"op,omitempty"`
	Reason     string        `json:"reason,omitempty"`
	DurationMS int64         `json:"duration_ms,omitempty"`
	Length     int           `json:"length,omitempty"`
	Text       string        `json:"text,omitempty"`
	ImageBytes int           `json:"image_bytes,omitempty"`
	TraceID    string        `json:"trace_id,omitempty"`
	SpanID     string        `json:"span_id,omitempty"`
}

// Audit takes facts about who did what and when; Record never blocks and may drop an event when the sink cannot keep up.
type Audit interface {
	Record(event AuditEvent)
}

// NoAudit is the default audit: it keeps nothing.
type NoAudit struct{}

// Record discards the event.
func (NoAudit) Record(AuditEvent) {}

// PassRecord is what the server remembers of a guest pass it handed to a browser: the room it was for and the Discord origin it vouched for.
type PassRecord struct {
	Slug        room.Slug
	Discord     room.Discord
	TraceParent string
}

// PassLedger remembers, on the server's side, who a guest pass vouched for, so a join can claim it by id and the browser cannot name a Discord identity itself.
type PassLedger interface {
	Remember(id string, record PassRecord)
	Recall(id string) (PassRecord, bool)
	Spend(id string)
}
