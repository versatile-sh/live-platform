package page

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHandler(t *testing.T) {
	h, err := Handler(fstest.MapFS{
		"index.html":             {Data: []byte("<!doctype html>page")},
		"assets/app-Ab3dE_9z.js": {Data: []byte("console.log(1)")},
		"assets/og.png":          {Data: []byte("png")},
		"secret.txt":             {Data: []byte("not served by name")},
	})
	require.NoError(t, err)
	cases := []struct {
		path, body, cache string
		status            int
	}{
		{"/", "<!doctype html>page", "no-store", 200},
		{"/bk", "<!doctype html>page", "no-store", 200},
		{"/a/b/c", "<!doctype html>page", "no-store", 200},
		{"/secret.txt", "<!doctype html>page", "no-store", 200},
		{"/assets/app-Ab3dE_9z.js", "console.log(1)", "public, max-age=31536000, immutable", 200},
		{"/assets/og.png", "png", "public, max-age=3600", 200},
		{"/assets/missing.js", "404 page not found\n", "", 404},
		{"/assets/../secret.txt", "404 page not found\n", "", 404},
	}
	for _, c := range cases {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, c.path, nil))
		assert.Equal(t, c.status, rec.Code, c.path)
		assert.Equal(t, c.body, rec.Body.String(), c.path)
		assert.Equal(t, c.cache, rec.Header().Get("Cache-Control"), c.path)
		assert.Contains(t, rec.Header().Get("Content-Security-Policy"), "default-src 'none'", c.path)
		assert.Equal(t, "nosniff", rec.Header().Get("X-Content-Type-Options"), c.path)
	}
}

func TestLayered(t *testing.T) {
	under := fstest.MapFS{"index.html": {Data: []byte("old page")}, "assets/app-Ab3dE_9z.js": {Data: []byte("old script")}}
	over := fstest.MapFS{"index.html": {Data: []byte("new page")}, "assets/app-Zz9yX8wV.js": {Data: []byte("new script")}}
	h, err := Handler(Layered(over, under))
	require.NoError(t, err)
	for path, want := range map[string]string{"/": "new page", "/assets/app-Zz9yX8wV.js": "new script", "/assets/app-Ab3dE_9z.js": "old script"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		assert.Equal(t, want, rec.Body.String(), path)
	}
	empty, err := Handler(Layered(fstest.MapFS{}, under))
	require.NoError(t, err)
	rec := httptest.NewRecorder()
	empty.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	assert.Equal(t, "old page", rec.Body.String(), "with nothing laid over, the built-in client is served")
}
