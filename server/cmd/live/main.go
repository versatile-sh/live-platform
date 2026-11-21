// Command live serves the rooms: HTTP on one port, signalling on another, and later media.
package main

import (
	"context"
	"log/slog"
	"os"
	ossignal "os/signal"
	"syscall"

	"github.com/versatile-sh/live/server/app"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "audit" {
		os.Exit(runAudit(os.Args[2:], os.Getenv, os.Stdout, os.Stderr))
	}
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg, err := app.Load(os.Getenv)
	if err != nil {
		log.Error("configuration invalid", "error", err.Error())
		os.Exit(1)
	}
	ctx, stop := ossignal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	err = app.Run(ctx, cfg, log)
	stop()
	if err != nil {
		os.Exit(1)
	}
}
