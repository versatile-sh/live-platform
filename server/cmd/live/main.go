// Command live serves the rooms: HTTP on one port, signalling on another, and later media.
package main

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"os"
	ossignal "os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/versatile-sh/live/server/internal/adapters/signal"
	"github.com/versatile-sh/live/server/internal/application/presence"
	"github.com/versatile-sh/live/server/internal/domain/room"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	hub := presence.NewHub(room.DefaultConfig(), presence.DefaultLiveness(), time.Now)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /up", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })

	server := &http.Server{
		Addr:              net.JoinHostPort(env("HOST", "127.0.0.1"), env("PORT", "8080")),
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
	signalling := signal.NewServer(hub, signal.DefaultConfig(origins()))
	signalAddr := net.JoinHostPort(env("HOST", "127.0.0.1"), env("SIGNAL_PORT", "8081"))

	ctx, stop := ossignal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	failed := make(chan error, 2)
	go func() { failed <- signalling.Run(signalAddr) }()
	go func() { failed <- server.ListenAndServe() }()
	log.Info("listening", "http", server.Addr, "signal", signalAddr)

	select {
	case <-ctx.Done():
	case err := <-failed:
		log.Error("server stopped", "error", err.Error())
		defer os.Exit(1)
	}
	grace, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = server.Shutdown(grace)
	_ = signalling.Stop(grace)
}

func origins() []string {
	raw := os.Getenv("PUBLIC_ORIGIN")
	if raw == "" {
		return nil
	}
	return strings.Split(raw, ",")
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
