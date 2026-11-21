// Package clientinfo reads what a connection's HTTP headers say about who is connecting: the real address, the place Cloudflare put them, and their browser.
package clientinfo

import (
	"net"
	"strings"
	"unicode"

	"github.com/versatile-sh/live/server/core/room"
)

const (
	maxField     = 128
	maxAgent     = 512
	maxLanguages = 128
)

// Headers collects the request headers that describe a client while the upgrade reads them.
type Headers struct {
	forwarded string
	extra     string
	client    room.Client
}

// Observe takes one request header; names are matched without regard to case and unrelated headers are ignored.
func (h *Headers) Observe(key, value []byte) {
	switch strings.ToLower(string(key)) {
	case "cf-connecting-ip":
		h.forwarded = clean(value, maxField)
	case "cf-ipcountry":
		h.client.Geo.Country = clean(value, maxField)
	case "cf-ipcity":
		h.client.Geo.City = clean(value, maxField)
	case "cf-region":
		h.client.Geo.Region = clean(value, maxField)
	case "cf-ipcontinent":
		h.client.Geo.Continent = clean(value, maxField)
	case "cf-timezone":
		h.client.Geo.Timezone = clean(value, maxField)
	case "cf-iplatitude":
		h.client.Geo.Latitude = clean(value, maxField)
	case "cf-iplongitude":
		h.client.Geo.Longitude = clean(value, maxField)
	case "user-agent":
		h.client.UserAgent = clean(value, maxAgent)
	case "accept-language":
		h.client.AcceptLanguage = clean(value, maxLanguages)
	}
}

// ObserveAddress takes the value of the configured proxy header that carries the visitor's address, used when CF-Connecting-IP is absent.
func (h *Headers) ObserveAddress(value []byte) {
	first, _, _ := strings.Cut(string(value), ",")
	h.extra = clean([]byte(first), maxField)
}

// Client builds the client: the address from CF-Connecting-IP, else the configured header, else the socket's own, and the browser summary parsed from the User-Agent.
func (h *Headers) Client(remote string) room.Client {
	c := h.client
	c.IP = firstAddress(h.forwarded, h.extra, remote)
	c.Browser, c.OS, c.Device = ParseUserAgent(c.UserAgent)
	return c
}

func firstAddress(candidates ...string) string {
	for _, raw := range candidates {
		host := raw
		if h, _, err := net.SplitHostPort(raw); err == nil {
			host = h
		}
		if ip := net.ParseIP(strings.TrimSpace(host)); ip != nil {
			return ip.String()
		}
	}
	return ""
}

func clean(value []byte, limit int) string {
	text := strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) {
			return -1
		}
		return r
	}, strings.TrimSpace(string(value)))
	if len(text) > limit {
		text = strings.ToValidUTF8(text[:limit], "")
	}
	return text
}
