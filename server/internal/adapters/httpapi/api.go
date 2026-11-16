// Package httpapi serves what the page asks before it opens a signalling connection.
package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/versatile-sh/live/server/internal/domain/room"
	"github.com/versatile-sh/live/server/internal/ports/inbound"
)

type roomView struct {
	Slug     string `json:"slug"`
	Exists   bool   `json:"exists"`
	Private  bool   `json:"private"`
	Listed   bool   `json:"listed"`
	Country  string `json:"country,omitempty"`
	Count    int    `json:"count"`
	Capacity int    `json:"capacity"`
}

// Register adds the room status, lobby and project routes to mux; stars may be nil when no count is kept.
func Register(mux *http.ServeMux, directory inbound.Directory, stars func() (int, bool)) {
	mux.HandleFunc("GET /api/project", func(w http.ResponseWriter, _ *http.Request) {
		view := map[string]*int{"stars": nil}
		if stars != nil {
			if n, known := stars(); known {
				view["stars"] = &n
			}
		}
		write(w, http.StatusOK, view)
	})
	mux.HandleFunc("GET /api/rooms/{slug}", func(w http.ResponseWriter, r *http.Request) {
		slug, err := room.NewSlug(r.PathValue("slug"))
		if err != nil {
			write(w, http.StatusBadRequest, map[string]string{"error": "invalid slug"})
			return
		}
		summary, exists := directory.Status(slug)
		view := view(summary)
		view.Slug, view.Exists = string(slug), exists
		write(w, http.StatusOK, view)
	})
	mux.HandleFunc("GET /api/lobby", func(w http.ResponseWriter, _ *http.Request) {
		listed := directory.Lobby()
		rooms := make([]roomView, len(listed))
		for i, s := range listed {
			rooms[i] = view(s)
			rooms[i].Exists = true
		}
		write(w, http.StatusOK, map[string][]roomView{"rooms": rooms})
	})
}

func view(s room.Summary) roomView {
	return roomView{Slug: string(s.Slug), Private: s.Private, Listed: s.Listed, Country: s.Country, Count: s.Count, Capacity: s.Capacity}
}

func write(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
