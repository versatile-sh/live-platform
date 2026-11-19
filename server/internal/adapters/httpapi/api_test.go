package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/versatile-sh/live/server/internal/domain/room"
	"github.com/versatile-sh/live/server/internal/ports/outbound"
)

type fakeDirectory map[room.Slug]room.Summary

func (d fakeDirectory) Status(slug room.Slug) (room.Summary, bool) {
	if s, ok := d[slug]; ok {
		return s, true
	}
	return room.Summary{Slug: slug, Capacity: 10}, false
}

func (d fakeDirectory) Lobby() []room.Summary {
	return []room.Summary{d["bk"]}
}

func TestAPI(t *testing.T) {
	mux := http.NewServeMux()
	known := false
	Register(mux, fakeDirectory{"bk": {Slug: "bk", Listed: true, Country: "BR", Count: 2, Capacity: 10}}, func() (int, bool) { return 42, known })
	cases := []struct {
		path   string
		status int
		body   string
	}{
		{"/api/rooms/bk", 200, `{"slug":"bk","exists":true,"private":false,"listed":true,"country":"BR","count":2,"capacity":10}`},
		{"/api/rooms/free", 200, `{"slug":"free","exists":false,"private":false,"listed":false,"count":0,"capacity":10}`},
		{"/api/rooms/API!", 400, `{"error":"invalid slug"}`},
		{"/api/project", 200, `{"stars":null}`},
		{"/api/lobby", 200, `{"rooms":[{"slug":"bk","exists":true,"private":false,"listed":true,"country":"BR","count":2,"capacity":10}]}`},
	}
	for _, c := range cases {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest("GET", c.path, nil))
		assert.Equal(t, c.status, rec.Code, c.path)
		assert.JSONEq(t, c.body, rec.Body.String(), c.path)
		assert.Equal(t, "no-store", rec.Header().Get("Cache-Control"))
	}
	known = true
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/project", nil))
	assert.JSONEq(t, `{"stars":42}`, rec.Body.String())
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("POST", "/api/lobby", nil))
	assert.Equal(t, http.StatusMethodNotAllowed, rec.Code)
}

type fakePasses map[string]outbound.GuestPass

func (p fakePasses) Take(_ context.Context, id string) (outbound.GuestPass, bool) {
	pass, ok := p[id]
	delete(p, id)
	return pass, ok
}

func TestPasses(t *testing.T) {
	mux := http.NewServeMux()
	RegisterPasses(mux, fakePasses{"abcdefghijklmnopqrstuv": {Name: "Ana", Face: "AQID", Private: true, Slug: "noite-k3p9"}})
	get := func() *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/pass/abcdefghijklmnopqrstuv", nil))
		return rec
	}
	first := get()
	assert.Equal(t, 200, first.Code)
	assert.JSONEq(t, `{"name":"Ana","face":"AQID","private":true,"listed":false,"slug":"noite-k3p9"}`, first.Body.String())
	assert.Equal(t, "no-store", first.Header().Get("Cache-Control"))
	assert.Equal(t, 404, get().Code, "a pass is handed once")
}
