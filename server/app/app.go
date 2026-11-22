package app

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"time"

	"go.opentelemetry.io/otel"

	"github.com/versatile-sh/live/server/audit"
	"github.com/versatile-sh/live/server/core/room"
	"github.com/versatile-sh/live/server/github"
	"github.com/versatile-sh/live/server/guestpass"
	"github.com/versatile-sh/live/server/handoff"
	"github.com/versatile-sh/live/server/httpapi"
	"github.com/versatile-sh/live/server/page"
	"github.com/versatile-sh/live/server/port/inbound"
	"github.com/versatile-sh/live/server/port/outbound"
	"github.com/versatile-sh/live/server/service/presence"
	"github.com/versatile-sh/live/server/sfu"
	"github.com/versatile-sh/live/server/signal"
)

const (
	handoverHold = 12 * time.Second
	handoverWait = 4 * time.Second
)

// Run serves HTTP and signalling until ctx ends or a server fails, then hands rooms over and shuts down.
func Run(ctx context.Context, cfg Config, log *slog.Logger) error {
	hub := presence.NewHub(room.DefaultConfig(), presence.DefaultLiveness(), time.Now)

	mux := http.NewServeMux()
	var starCount func() (int, bool)
	if stars, ok := github.NewStars(cfg.GitHubRepo, &http.Client{Timeout: 10 * time.Second}); ok {
		go stars.Run(ctx, 30*time.Minute)
		starCount = stars.Count
	}
	httpapi.Register(mux, hub, starCount)
	ledger := guestpass.NewLedger(time.Now)
	if passes, ok := guestpass.NewSource(cfg.PassSource, cfg.PassKey, &http.Client{Timeout: 3 * time.Second}); ok {
		httpapi.RegisterPasses(mux, guestpass.Remembering{Passes: passes, Ledger: ledger, Now: time.Now})
	}
	trail, drainTrail := startAudit(ctx, log, hub, cfg.Audit)
	defer drainTrail()
	go reportMetrics(ctx, log, hub, trail, cfg.MetricsEvery)
	if cfg.WebDir != "" {
		files := os.DirFS(cfg.WebDir)
		if cfg.WebLiveDir != "" {
			files = page.Layered(os.DirFS(cfg.WebLiveDir), files)
		}
		web, err := page.Handler(files)
		if err != nil {
			log.ErrorContext(ctx, "web directory unusable", "error", err.Error())
			return err
		}
		mux.Handle("GET /", web)
	}
	mux.HandleFunc("GET /up", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })

	server := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
	signalCfg := signal.DefaultConfig(cfg.Origins, time.Now)
	signalCfg.CountryHeader = cfg.CountryHeader
	signalCfg.AddressHeader = cfg.AddressHeader
	hub.UseTroubles(audit.NewTroubles(context.WithoutCancel(ctx), log, otel.Tracer("live/media")))
	var rooms inbound.Presence = presence.WithoutMedia{Hub: hub}
	if cfg.Media {
		engine, err := sfu.New(sfu.Config{UDPPort: cfg.MediaUDPPort, PublicIP: cfg.MediaPublicIP, Now: time.Now}, hub)
		if err != nil {
			log.ErrorContext(ctx, "media plane unusable", "error", err.Error())
			return err
		}
		hub.UseMedia(engine)
		rooms = hub
	}
	rooms = presence.Governed{Presence: rooms, Rooms: hub, Policy: outbound.AllowAll{}}
	var handover *handoff.Dir
	if cfg.HandoverDir != "" {
		opened, err := handoff.Open(cfg.HandoverDir, time.Now)
		if err != nil {
			log.ErrorContext(ctx, "handover directory unusable", "error", err.Error())
			return err
		}
		handover = opened
		if salt, err := handover.Salt(); err == nil {
			signalCfg.Salt = salt
		} else {
			log.ErrorContext(ctx, "handover salt unusable, bans last only for this process", "error", err.Error())
		}
		go handover.Watch(ctx, func(handed []presence.HandedRoom) {
			log.InfoContext(ctx, "rooms taken over", "handed", len(handed), "taken", hub.Adopt(handed, handoverHold))
		})
	}
	signalling := signal.NewServer(rooms, signalCfg)
	signalling.UsePasses(ctx, ledger)

	failed := make(chan error, 2)
	go func() { failed <- signalling.Run(cfg.SignalAddr) }()
	go func() { failed <- server.ListenAndServe() }()
	log.InfoContext(ctx, "listening", "http", server.Addr, "signal", cfg.SignalAddr)

	var stopped error
	select {
	case <-ctx.Done():
	case stopped = <-failed:
		log.ErrorContext(ctx, "server stopped", "error", stopped.Error())
	}
	signalling.Drain()
	if handed := hub.Export(); handover != nil && len(handed) > 0 {
		if err := handover.Leave(handed); err != nil {
			log.ErrorContext(ctx, "rooms not handed over", "error", err.Error())
		} else {
			wait, done := context.WithTimeout(context.WithoutCancel(ctx), handoverWait)
			log.InfoContext(ctx, "rooms handed over", "rooms", len(handed), "taken", handover.Taken(wait))
			done()
		}
		signalling.Handoff()
		time.Sleep(200 * time.Millisecond)
	}
	grace, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	_ = server.Shutdown(grace)
	_ = signalling.Stop(grace)
	return stopped
}
