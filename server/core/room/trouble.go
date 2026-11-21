package room

// MediaTrouble names something that went wrong on a participant's media path, from a fixed list so that nothing free-form reaches a log.
type MediaTrouble string

// Troubles the server sees on its side of a participant's media.
const (
	TroubleOfferRejected   MediaTrouble = "offer.rejected"
	TroublePublishReplaced MediaTrouble = "publish.replaced"
	TroublePublishLost     MediaTrouble = "publish.lost"
	TroubleSubscribeLost   MediaTrouble = "subscribe.lost"
)

// Troubles a browser reports about its own side.
const (
	TroubleAnswerLate      MediaTrouble = "answer.late"
	TroublePublishFailed   MediaTrouble = "publish.failed"
	TroubleSubscribeFailed MediaTrouble = "subscribe.failed"
	TroubleOfferFailed     MediaTrouble = "offer.failed"
	TroubleAnswerFailed    MediaTrouble = "answer.failed"
)

// BrowserTrouble accepts only the troubles a browser may report.
func BrowserTrouble(code string) (MediaTrouble, bool) {
	switch t := MediaTrouble(code); t {
	case TroubleAnswerLate, TroublePublishFailed, TroubleSubscribeFailed, TroubleOfferFailed, TroubleAnswerFailed:
		return t, true
	}
	return "", false
}
