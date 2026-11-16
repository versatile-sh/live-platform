package main

// Scenario encodes who publishes what and who subscribes to what.
// Rates follow round1/robustness.md: camera 0.3 Mbps, screen 2.5 Mbps, Opus 40 kbps.
type scenario struct {
	n        int
	speakers int // participants 0..speakers-1 publish audio
	cams     bool
	camsPer  int  // camera tiles per viewer
	screen   bool // participant 0 shares a screen
}

var scenarios = map[string]scenario{
	"video30":     {n: 30, speakers: 6, cams: true, camsPer: 9, screen: true},
	"video30full": {n: 30, speakers: 6, cams: true, camsPer: 29, screen: true},
	"relay1":      {n: 1, speakers: 1},
	"audio100":    {n: 100, speakers: 6},
}

// published tracks of participant i
func (s scenario) pubs(i int) []string {
	var l []string
	if i < s.speakers {
		l = append(l, "aud")
	}
	if s.cams {
		l = append(l, "cam")
	}
	if s.screen && i == 0 {
		l = append(l, "scr")
	}
	return l
}

// tracks subscriber i receives, as "pubIndex/kind"
func (s scenario) subs(i int) []string {
	var l []string
	for p := 0; p < s.speakers; p++ {
		if p != i {
			l = append(l, key(p, "aud"))
		}
	}
	if s.cams {
		for k := 1; k <= s.camsPer; k++ {
			l = append(l, key((i+k)%s.n, "cam"))
		}
	}
	if s.screen && i != 0 {
		l = append(l, key(0, "scr"))
	}
	return l
}

func (s scenario) totalPubs() int {
	t := 0
	for i := 0; i < s.n; i++ {
		t += len(s.pubs(i))
	}
	return t
}

func key(p int, kind string) string { return itoa(p) + "/" + kind }
func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	var b []byte
	for i > 0 {
		b = append([]byte{byte('0' + i%10)}, b...)
		i /= 10
	}
	return string(b)
}

// packets per second and payload bytes per kind
func rate(kind string) (pps, payload int) {
	switch kind {
	case "cam":
		return 30, 1000
	case "scr":
		return 250, 1200
	}
	return 50, 100
}
