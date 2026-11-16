package ws

import "time"

type bucket struct {
	tokens float64
	burst  float64
	rate   float64
	last   time.Time
}

func newBucket(rate, burst float64, now time.Time) bucket {
	return bucket{tokens: burst, burst: burst, rate: rate, last: now}
}

func (b *bucket) take(now time.Time) bool {
	b.tokens = min(b.burst, b.tokens+now.Sub(b.last).Seconds()*b.rate)
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}
