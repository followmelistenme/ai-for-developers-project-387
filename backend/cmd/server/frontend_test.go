package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/followmelistenme/ai-for-developers-project-387/backend/internal/server"
)

func TestFrontendAndAPIShareOneServer(t *testing.T) {
	directory := t.TempDir()
	for name, content := range map[string]string{"index.html": "<html>Booking application</html>", "bundle.js": "console.log('booking')"} {
		if err := os.WriteFile(filepath.Join(directory, name), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	api, err := server.New()
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, method, url, directory, contains string
		status                                 int
	}{
		{"homepage", "GET", "/", directory, "Booking application", 200},
		{"owner reload", "GET", "/owner", directory, "Booking application", 200},
		{"catalogue", "GET", "/booking", directory, "Booking application", 200},
		{"meeting type reload", "GET", "/booking/example", directory, "Booking application", 200},
		{"asset", "GET", "/bundle.js", directory, "console.log", 200},
		{"missing asset", "GET", "/missing.js", directory, "404", 404},
		{"API", "GET", "/api/owner/meeting-types", directory, "[]", 200},
		{"unknown API", "GET", "/api/missing", directory, "404", 404},
		{"docs", "GET", "/docs", directory, "<!doctype html>", 200},
		{"OpenAPI JSON", "GET", "/openapi.json", directory, "openapi", 200},
		{"OpenAPI YAML", "GET", "/openapi.yaml", directory, "openapi:", 200},
		{"POST cannot return SPA", "POST", "/booking/example", directory, "404", 404},
		{"HEAD", "HEAD", "/owner", directory, "", 200},
		{"API-only default", "GET", "/owner", "", "404", 404},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := withFrontend(api, tc.directory)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, httptest.NewRequest(tc.method, tc.url, nil))
			if w.Code != tc.status || !strings.Contains(w.Body.String(), tc.contains) {
				t.Fatalf("got %d %s", w.Code, w.Body.String())
			}
			if tc.method == http.MethodHead && w.Body.Len() != 0 {
				t.Fatal("HEAD returned a body")
			}
		})
	}
}
