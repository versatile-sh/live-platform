package clientinfo

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func observe(h *Headers, pairs ...string) {
	for i := 0; i < len(pairs); i += 2 {
		h.Observe([]byte(pairs[i]), []byte(pairs[i+1]))
	}
}

func TestClientReadsCloudflareHeaders(t *testing.T) {
	var h Headers
	observe(&h,
		"cf-connecting-ip", "203.0.113.7", "CF-IPCountry", "BR", "cf-ipcity", "Sao Paulo", "cf-region", "Sao Paulo",
		"cf-ipcontinent", "SA", "cf-timezone", "America/Sao_Paulo", "cf-iplatitude", "-23.55", "cf-iplongitude", "-46.63",
		"Accept-Language", "pt-BR,pt;q=0.9", "User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142.0.0.0 Safari/537.36",
	)
	c := h.Client("198.51.100.1:5555")
	assert.Equal(t, "203.0.113.7", c.IP)
	assert.Equal(t, "BR", c.Geo.Country)
	assert.Equal(t, "Sao Paulo", c.Geo.City)
	assert.Equal(t, "Sao Paulo", c.Geo.Region)
	assert.Equal(t, "SA", c.Geo.Continent)
	assert.Equal(t, "America/Sao_Paulo", c.Geo.Timezone)
	assert.Equal(t, "-23.55", c.Geo.Latitude)
	assert.Equal(t, "-46.63", c.Geo.Longitude)
	assert.Equal(t, "pt-BR,pt;q=0.9", c.AcceptLanguage)
	assert.Equal(t, "Chrome 142", c.Browser)
	assert.Equal(t, "Windows", c.OS)
	assert.Equal(t, "desktop", c.Device)
	assert.Contains(t, c.UserAgent, "Windows NT")
}

func TestClientFallsBackToTheSocketAddress(t *testing.T) {
	var h Headers
	assert.Equal(t, "198.51.100.1", h.Client("198.51.100.1:5555").IP)
	observe(&h, "cf-connecting-ip", "not an address")
	assert.Equal(t, "198.51.100.1", h.Client("198.51.100.1:5555").IP)
	assert.Empty(t, h.Client("").IP)
}

func TestClientUsesTheConfiguredAddressHeaderWhenCloudflareSentNone(t *testing.T) {
	var h Headers
	h.ObserveAddress([]byte("2001:db8::1, 10.0.0.1"))
	assert.Equal(t, "2001:db8::1", h.Client("10.0.0.9:1").IP)
	observe(&h, "CF-Connecting-IP", "203.0.113.9")
	assert.Equal(t, "203.0.113.9", h.Client("10.0.0.9:1").IP)
}

func TestAbsentGeoHeadersStayEmpty(t *testing.T) {
	var h Headers
	observe(&h, "CF-IPCountry", "BR")
	c := h.Client("203.0.113.1:1")
	assert.Equal(t, "BR", c.Geo.Country)
	assert.Empty(t, c.Geo.City)
	assert.Empty(t, c.Geo.Latitude)
}

func TestValuesAreBoundedAndStrippedOfControlCharacters(t *testing.T) {
	var h Headers
	observe(&h, "User-Agent", "evil\r\n{\"forged\":1}"+strings.Repeat("x", 2000), "cf-ipcity", "Rio\x00 de Janeiro")
	c := h.Client("203.0.113.1:1")
	assert.LessOrEqual(t, len(c.UserAgent), maxAgent)
	assert.NotContains(t, c.UserAgent, "\n")
	assert.Equal(t, "Rio de Janeiro", c.Geo.City)
}

func TestParseUserAgent(t *testing.T) {
	cases := []struct{ agent, browser, system, device string }{
		{"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0", "Edge 142", "Windows", "desktop"},
		{"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.1 Safari/605.1.15", "Safari 18", "macOS", "desktop"},
		{"Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0", "Firefox 140", "Linux", "desktop"},
		{"Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Version/18.1 Mobile/15E148 Safari/604.1", "Safari 18", "iOS", "mobile"},
		{"Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/142.0.0.0 Mobile Safari/537.36", "Chrome 142", "Android 15", "mobile"},
		{"Mozilla/5.0 (Linux; Android 14; SM-X900) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36", "Chrome 141", "Android 14", "tablet"},
		{"Mozilla/5.0 (compatible; ExampleBot/1.0)", "bot", "", "bot"},
		{"", "", "", ""},
		{"curl/8.0", "", "", "desktop"},
	}
	for _, c := range cases {
		browser, system, device := ParseUserAgent(c.agent)
		assert.Equal(t, []string{c.browser, c.system, c.device}, []string{browser, system, device}, c.agent)
	}
}
