package guestpass

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const key = "kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk"

func issuer(t *testing.T, handler http.HandlerFunc) *Source {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	s, ok := NewSource(srv.URL+"/pass/", key, srv.Client())
	require.True(t, ok)
	return s
}

func TestNewSource(t *testing.T) {
	t.Run("refuses a base that is not http(s) or a short key", func(t *testing.T) {
		_, ok := NewSource("ftp://x", key, http.DefaultClient)
		assert.False(t, ok)
		_, ok = NewSource("http://bot:3000/pass", "short", http.DefaultClient)
		assert.False(t, ok)
	})
}

func TestTake(t *testing.T) {
	const id = "abcdefghijklmnopqrstuv"

	t.Run("asks the issuer with its key and returns the pass", func(t *testing.T) {
		s := issuer(t, func(w http.ResponseWriter, r *http.Request) {
			assert.Equal(t, "/pass/"+id, r.URL.Path)
			assert.Equal(t, "Bearer "+key, r.Header.Get("Authorization"))
			_, _ = w.Write([]byte(`{"name":"  Ana  ","face":"AQID","private":true,"listed":false,"slug":"noite-k3p9"}`))
		})
		p, ok := s.Take(context.Background(), id)
		require.True(t, ok)
		assert.Equal(t, Pass{Name: "Ana", Face: "AQID", Private: true, Slug: "noite-k3p9"}, p)
	})

	t.Run("never asks for a malformed id", func(t *testing.T) {
		asked := false
		s := issuer(t, func(http.ResponseWriter, *http.Request) { asked = true })
		_, ok := s.Take(context.Background(), "../../admin")
		assert.False(t, ok)
		assert.False(t, asked)
	})

	t.Run("refuses what is not a valid pass", func(t *testing.T) {
		for name, body := range map[string]string{
			"no name":       `{"name":"","slug":"a-b"}`,
			"long name":     `{"name":"` + strings.Repeat("a", 41) + `","slug":"a-b"}`,
			"invisible":     `{"name":"a​b","slug":"a-b"}`,
			"face too big":  `{"name":"a","face":"` + strings.Repeat("A", 13_004) + `","slug":"a-b"}`,
			"face not b64":  `{"name":"a","face":"<script>","slug":"a-b"}`,
			"reserved slug": `{"name":"a","slug":"api"}`,
			"not json":      `nope`,
		} {
			s := issuer(t, func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(body)) })
			_, ok := s.Take(context.Background(), id)
			assert.False(t, ok, name)
		}
	})

	t.Run("is absent when the issuer has none", func(t *testing.T) {
		s := issuer(t, func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNotFound) })
		_, ok := s.Take(context.Background(), id)
		assert.False(t, ok)
	})
}
