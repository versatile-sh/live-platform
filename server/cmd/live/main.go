// Command live serves the rooms: signalling, and later media and the page.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/versatile-sh/live/server/internal/adapters/ws"
	"github.com/versatile-sh/live/server/internal/application/presence"
	"github.com/versatile-sh/live/server/internal/domain/room"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	hub := presence.NewHub(room.DefaultConfig(), presence.DefaultLiveness(), time.Now)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /up", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	mux.Handle("GET /ws", ws.NewHandler(hub, ws.DefaultConfig(origins())))

	server := &http.Server{
		Addr:              net.JoinHostPort(env("HOST", "127.0.0.1"), env("PORT", "8080")),
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		grace, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(grace)
	}()
	log.Info("listening", "addr", server.Addr)
	if err := server.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		log.Error("server stopped", "error", err.Error())
		os.Exit(1)
	}
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
