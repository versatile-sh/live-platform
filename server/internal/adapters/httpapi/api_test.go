package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/versatile-sh/live/server/internal/domain/room"
)

type fakeDirectory map[room.Slug]room.Summary

func (d fakeDirectory) Status(slug room.Slug) (room.Summary, bool) {
	s, ok := d[slug]
	return s, ok
}

func (d fakeDirectory) Lobby() []room.Summary {
	return []room.Summary{d["bk"]}
}

func TestAPI(t *testing.T) {
	mux := http.NewServeMux()
	Register(mux, fakeDirectory{"bk": {Slug: "bk", Listed: true, Country: "BR", Count: 2, Capacity: 10}})
	cases := []struct {
		path   string
		status int
		body   string
	}{
		{"/api/rooms/bk", 200, `{"slug":"bk","exists":true,"private":false,"country":"BR","count":2,"capacity":10}`},
		{"/api/rooms/free", 200, `{"slug":"free","exists":false,"private":false,"count":0,"capacity":0}`},
		{"/api/rooms/API!", 400, `{"error":"invalid slug"}`},
		{"/api/lobby", 200, `{"rooms":[{"slug":"bk","exists":true,"private":false,"country":"BR","count":2,"capacity":10}]}`},
	}
	for _, c := range cases {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest("GET", c.path, nil))
		assert.Equal(t, c.status, rec.Code, c.path)
		assert.JSONEq(t, c.body, rec.Body.String(), c.path)
		assert.Equal(t, "no-store", rec.Header().Get("Cache-Control"))
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("POST", "/api/lobby", nil))
	assert.Equal(t, http.StatusMethodNotAllowed, rec.Code)
}
