// Package github asks GitHub how many people starred the project, so the page can show it without talking to GitHub itself.
package github

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"sync/atomic"
	"time"
)

const unknown = -1

var repoName = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$`)

// Stars keeps the last star count GitHub reported for one repository.
type Stars struct {
	url    string
	client *http.Client
	count  atomic.Int64
}

// NewStars builds a counter for "owner/name", or reports false when that is not a repository name.
func NewStars(repo string, client *http.Client) (*Stars, bool) {
	if !repoName.MatchString(repo) {
		return nil, false
	}
	s := &Stars{url: "https://api.github.com/repos/" + repo, client: client}
	s.count.Store(unknown)
	return s, true
}

// Count returns the last known count, or false while GitHub has not answered.
func (s *Stars) Count() (int, bool) {
	n := s.count.Load()
	return int(n), n != unknown
}

// Run refreshes the count now and then every interval, until ctx ends; a failed refresh keeps the last count.
func (s *Stars) Run(ctx context.Context, every time.Duration) {
	ticker := time.NewTicker(every)
	defer ticker.Stop()
	for {
		s.refresh(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (s *Stars) refresh(ctx context.Context) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.url, nil)
	if err != nil {
		return
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "live-server")
	res, err := s.client.Do(req)
	if err != nil {
		return
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return
	}
	var body struct {
		Stars *int64 `json:"stargazers_count"`
	}
	if json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&body) != nil || body.Stars == nil || *body.Stars < 0 {
		return
	}
	s.count.Store(*body.Stars)
}
