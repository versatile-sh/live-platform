package github

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func counter(t *testing.T, handler http.HandlerFunc) *Stars {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	s, ok := NewStars("versatile-sh/call-platform", srv.Client())
	require.True(t, ok)
	s.url = srv.URL
	return s
}

func TestStars(t *testing.T) {
	t.Run("is unknown until GitHub answers, then reports the count", func(t *testing.T) {
		s := counter(t, func(w http.ResponseWriter, r *http.Request) {
			assert.NotEmpty(t, r.Header.Get("User-Agent"))
			_, _ = w.Write([]byte(`{"stargazers_count": 1234, "name": "x"}`))
		})
		_, known := s.Count()
		assert.False(t, known)
		s.refresh(context.Background())
		n, known := s.Count()
		assert.True(t, known)
		assert.Equal(t, 1234, n)
	})

	t.Run("keeps the last count when a refresh fails or answers nonsense", func(t *testing.T) {
		answers := []string{`{"stargazers_count": 7}`, `not json`, `{"stargazers_count": -3}`, `{}`}
		status := []int{200, 200, 200, 200, 404}
		call := 0
		s := counter(t, func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(status[call])
			if call < len(answers) {
				_, _ = w.Write([]byte(answers[call]))
			}
			call++
		})
		for range status {
			s.refresh(context.Background())
			n, known := s.Count()
			assert.True(t, known)
			assert.Equal(t, 7, n)
		}
	})

	t.Run("refuses anything that is not owner/name", func(t *testing.T) {
		for _, repo := range []string{"", "nope", "a/b/c", "a/b?x=1", "../a/b", "a/ b"} {
			_, ok := NewStars(repo, http.DefaultClient)
			assert.False(t, ok, repo)
		}
	})
}
