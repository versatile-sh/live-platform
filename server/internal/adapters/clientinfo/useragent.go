package clientinfo

import (
	"regexp"
	"strings"
)

var browsers = []struct {
	token string
	name  string
}{
	{"Edg/", "Edge"}, {"EdgA/", "Edge"}, {"EdgiOS/", "Edge"}, {"OPR/", "Opera"}, {"SamsungBrowser/", "Samsung Internet"},
	{"Firefox/", "Firefox"}, {"FxiOS/", "Firefox"}, {"CriOS/", "Chrome"}, {"Chrome/", "Chrome"}, {"Version/", "Safari"},
}

var androidVersion = regexp.MustCompile(`Android (\d+)`)

// ParseUserAgent summarises a User-Agent as browser with its major version, operating system and device class; unknown parts come back empty.
func ParseUserAgent(agent string) (browser, system, device string) {
	if agent == "" {
		return "", "", ""
	}
	return browserOf(agent), systemOf(agent), deviceOf(agent)
}

func browserOf(agent string) string {
	if isBot(agent) {
		return "bot"
	}
	for _, b := range browsers {
		if i := strings.Index(agent, b.token); i >= 0 {
			return strings.TrimSpace(b.name + " " + major(agent[i+len(b.token):]))
		}
	}
	return ""
}

func major(rest string) string {
	end := 0
	for end < len(rest) && rest[end] >= '0' && rest[end] <= '9' {
		end++
	}
	return rest[:end]
}

func systemOf(agent string) string {
	switch {
	case strings.Contains(agent, "Windows"):
		return "Windows"
	case strings.Contains(agent, "Android"):
		if m := androidVersion.FindStringSubmatch(agent); m != nil {
			return "Android " + m[1]
		}
		return "Android"
	case strings.Contains(agent, "iPhone") || strings.Contains(agent, "iPad") || strings.Contains(agent, "iPod"):
		return "iOS"
	case strings.Contains(agent, "Mac OS X") || strings.Contains(agent, "Macintosh"):
		return "macOS"
	case strings.Contains(agent, "CrOS"):
		return "ChromeOS"
	case strings.Contains(agent, "Linux") || strings.Contains(agent, "X11"):
		return "Linux"
	}
	return ""
}

func deviceOf(agent string) string {
	switch {
	case isBot(agent):
		return "bot"
	case strings.Contains(agent, "iPad") || strings.Contains(agent, "Tablet") || (strings.Contains(agent, "Android") && !strings.Contains(agent, "Mobile")):
		return "tablet"
	case strings.Contains(agent, "Mobi") || strings.Contains(agent, "iPhone"):
		return "mobile"
	}
	return "desktop"
}

func isBot(agent string) bool {
	lower := strings.ToLower(agent)
	return strings.Contains(lower, "bot") || strings.Contains(lower, "crawler") || strings.Contains(lower, "spider")
}
