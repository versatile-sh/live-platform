// Package page serves the built web client and the headers that confine it.
package page

import (
	"io/fs"
	"net/http"
	"regexp"
	"strings"
)

const contentSecurityPolicy = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; font-src 'self'; " +
	"img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self'; " +
	"base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

var hashed = regexp.MustCompile(`-[A-Za-z0-9_-]{8}\.[a-z0-9]+$`)

const previewImage = "/assets/og.png"

// Handler serves assets named after their content as immutable, the others for an hour, and answers every other path with the page itself, never cached.
func Handler(files fs.FS) (http.Handler, error) {
	sub, err := fs.Sub(files, "assets")
	if err != nil {
		return nil, err
	}
	assets := http.StripPrefix("/assets/", http.FileServerFS(sub))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", contentSecurityPolicy)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Cross-Origin-Opener-Policy", "same-origin")
		h.Set("Cross-Origin-Resource-Policy", "same-origin")
		if r.URL.Path == previewImage {
			h.Set("Cross-Origin-Resource-Policy", "cross-origin")
		}
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			if hashed.MatchString(r.URL.Path) {
				h.Set("Cache-Control", "public, max-age=31536000, immutable")
			} else {
				h.Set("Cache-Control", "public, max-age=3600")
			}
			assets.ServeHTTP(w, r)
			return
		}
		h.Set("Cache-Control", "no-cache")
		http.ServeFileFS(w, r, files, "index.html")
	}), nil
}
