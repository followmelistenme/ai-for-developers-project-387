package main

import (
	"io/fs"
	"net/http"
	"os"
	"path"
	"strings"
)

// withFrontend serves a built SPA alongside the API when explicitly configured.
func withFrontend(api http.Handler, directory string) http.Handler {
	if directory == "" {
		return api
	}
	assets := os.DirFS(directory)
	files := http.FileServerFS(assets)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead ||
			r.URL.Path == "/api" || strings.HasPrefix(r.URL.Path, "/api/") ||
			r.URL.Path == "/docs" || strings.HasPrefix(r.URL.Path, "/docs/") ||
			r.URL.Path == "/openapi.json" || r.URL.Path == "/openapi.yaml" {
			api.ServeHTTP(w, r)
			return
		}
		filename := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if filename == "" {
			filename = "."
		}
		info, err := fs.Stat(assets, filename)
		if err == nil && !info.IsDir() {
			files.ServeHTTP(w, r)
			return
		}
		if err != nil && !os.IsNotExist(err) {
			http.Error(w, "Unable to read frontend", http.StatusInternalServerError)
			return
		}
		if path.Ext(r.URL.Path) != "" {
			http.NotFound(w, r)
			return
		}
		http.ServeFileFS(w, r, assets, "index.html")
	})
}
