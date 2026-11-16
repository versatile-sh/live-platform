// Command live serves the rooms: HTTP on one port, signalling on another, and later media.
package main

import (
	"context"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	ossignal "os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/versatile-sh/live/server/internal/adapters/github"
	"github.com/versatile-sh/live/server/internal/adapters/httpapi"
	"github.com/versatile-sh/live/server/internal/adapters/page"
	"github.com/versatile-sh/live/server/internal/adapters/sfu"
	"github.com/versatile-sh/live/server/internal/adapters/signal"
	"github.com/versatile-sh/live/server/internal/application/presence"
	"github.com/versatile-sh/live/server/internal/domain/room"
	"github.com/versatile-sh/live/server/internal/ports/inbound"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	hub := presence.NewHub(room.DefaultConfig(), presence.DefaultLiveness(), time.Now)

	mux := http.NewServeMux()
	ctx, stop := ossignal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	var starCount func() (int, bool)
	if stars, ok := github.NewStars(os.Getenv("GITHUB_REPO"), &http.Client{Timeout: 10 * time.Second}); ok {
		go stars.Run(ctx, 30*time.Minute)
		starCount = stars.Count
	}
	httpapi.Register(mux, hub, starCount)
	if dir := os.Getenv("WEB_DIR"); dir != "" {
		var files fs.FS = os.DirFS(dir)
		if over := os.Getenv("WEB_LIVE_DIR"); over != "" {
			files = page.Layered(os.DirFS(over), files)
		}
		web, err := page.Handler(files)
		if err != nil {
			log.Error("web directory unusable", "error", err.Error())
			os.Exit(1)
		}
		mux.Handle("GET /", web)
	}
	mux.HandleFunc("GET /up", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })

	server := &http.Server{
		Addr:              net.JoinHostPort(env("HOST", "127.0.0.1"), env("PORT", "8080")),
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
	signalCfg := signal.DefaultConfig(origins())
	signalCfg.CountryHeader = os.Getenv("COUNTRY_HEADER")
	signalCfg.AddressHeader = os.Getenv("ADDRESS_HEADER")
	var rooms inbound.Presence = presence.WithoutMedia{Hub: hub}
	if os.Getenv("MEDIA") != "off" {
		udpPort, _ := strconv.Atoi(os.Getenv("MEDIA_UDP_PORT"))
		engine, err := sfu.New(sfu.Config{UDPPort: udpPort, PublicIP: os.Getenv("MEDIA_PUBLIC_IP")}, hub)
		if err != nil {
			log.Error("media plane unusable", "error", err.Error())
			os.Exit(1)
		}
		hub.UseMedia(engine)
		rooms = hub
	}
	signalling := signal.NewServer(rooms, signalCfg)
	signalAddr := net.JoinHostPort(env("HOST", "127.0.0.1"), env("SIGNAL_PORT", "8081"))

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
