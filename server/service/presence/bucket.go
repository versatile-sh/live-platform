package presence

import "time"

type bucket struct {
	tokens float64
	at     time.Time
	filled bool
}

func (b *bucket) take(now time.Time, cost, rate, burst float64) bool {
	if !b.filled {
		b.tokens, b.at, b.filled = burst, now, true
	} else if elapsed := now.Sub(b.at).Seconds(); elapsed > 0 {
		b.tokens, b.at = min(burst, b.tokens+elapsed*rate), now
	}
	if b.tokens < cost {
		return false
	}
	b.tokens -= cost
	return true
}
