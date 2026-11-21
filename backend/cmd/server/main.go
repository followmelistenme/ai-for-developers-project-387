package main

import (
	"log"
	"net"
	"net/http"
	"os"
	"time"

	"github.com/followmelistenme/ai-for-developers-project-387/backend/internal/server"
)

func main() {
	handler, err := server.New()
	if err != nil {
		log.Fatal(err)
	}
	handler = withFrontend(handler, os.Getenv("FRONTEND_DIR"))
	host := envOr("BACKEND_HOST", "127.0.0.1")
	port := envOr("BACKEND_PORT", envOr("PORT", "8080"))
	httpServer := &http.Server{
		Addr: net.JoinHostPort(host, port), Handler: handler,
		ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second,
		WriteTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second,
	}
	log.Printf("Calendar API listening on %s", httpServer.Addr)
	log.Fatal(httpServer.ListenAndServe())
}

func envOr(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
