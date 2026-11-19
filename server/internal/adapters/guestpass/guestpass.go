// Package guestpass takes a guest pass from a trusted issuer on the private network, such as a chat bot, so a page opened
// from its link starts with a name, a photo and the room's access already chosen. The issuer is configured, never the caller.
package guestpass

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/versatile-sh/live/server/internal/domain/room"
	"github.com/versatile-sh/live/server/internal/ports/outbound"
)

const (
	maxBody = 32 << 10
	maxName = 40
	// maxFace is the client's limit for a photo in base64 characters (PHOTO_MAX_BASE64 in web/src/browser-services.ts).
	maxFace = 13_000
)

var passID = regexp.MustCompile(`^[A-Za-z0-9_-]{16,64}$`)

// Pass is the pass as the issuer sends it.
type Pass = outbound.GuestPass

// Source asks the issuer for a pass once; the issuer forgets it after handing it over.
type Source struct {
	base   string
	key    string
	client *http.Client
}

// NewSource builds a source for an http(s) base URL and the key the issuer expects, or reports false when either is unusable.
func NewSource(base, key string, client *http.Client) (*Source, bool) {
	u, err := url.Parse(base)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || len(key) < 32 {
		return nil, false
	}
	return &Source{base: strings.TrimRight(base, "/"), key: key, client: client}, true
}

// Take returns the pass with this id, or false when the id is malformed, the issuer has none, or what it sent is not a valid pass.
func (s *Source) Take(ctx context.Context, id string) (Pass, bool) {
	if !passID.MatchString(id) {
		return Pass{}, false
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.base+"/"+id, nil)
	if err != nil {
		return Pass{}, false
	}
	req.Header.Set("Authorization", "Bearer "+s.key)
	res, err := s.client.Do(req)
	if err != nil {
		return Pass{}, false
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return Pass{}, false
	}
	var p Pass
	if err := json.NewDecoder(io.LimitReader(res.Body, maxBody)).Decode(&p); err != nil {
		return Pass{}, false
	}
	return p, valid(&p)
}

func valid(p *Pass) bool {
	p.Name = strings.TrimSpace(p.Name)
	n := utf8.RuneCountInString(p.Name)
	if n == 0 || n > maxName || strings.IndexFunc(p.Name, func(r rune) bool { return unicode.Is(unicode.Cc, r) || unicode.Is(unicode.Cf, r) }) >= 0 {
		return false
	}
	if len(p.Face) > maxFace {
		return false
	}
	if p.Face != "" {
		if _, err := base64.StdEncoding.DecodeString(p.Face); err != nil {
			return false
		}
	}
	_, err := room.NewSlug(p.Slug)
	return err == nil
}
