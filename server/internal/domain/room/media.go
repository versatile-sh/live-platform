package room

// Media roles: the connection a participant publishes on, and the one it is sent other people's media on.
const (
	MediaRolePublish   = "pub"
	MediaRoleSubscribe = "sub"
)

// Media signal kinds.
const (
	MediaKindOffer  = "offer"
	MediaKindAnswer = "answer"
	MediaKindICE    = "ice"
)

// MediaSignal is one step of setting up a participant's media: a session description or a network candidate.
// Sources names each published stream by the stream id in its msid; a track id key is still read for older clients.
type MediaSignal struct {
	Role      string
	Kind      string
	SDP       string
	Candidate string
	Sources   map[string]string
}
