package main

import (
	"context"
	"log/slog"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

func startTracing(ctx context.Context, log *slog.Logger, getenv func(string) string) func(context.Context) {
	otel.SetTextMapPropagator(propagation.TraceContext{})
	if getenv("OTEL_EXPORTER_OTLP_ENDPOINT") == "" && getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") == "" {
		return func(context.Context) {}
	}
	exporter, err := otlptracehttp.New(ctx)
	if err != nil {
		log.ErrorContext(ctx, "tracing unusable, continuing without it", "error", err.Error())
		return func(context.Context) {}
	}
	res, err := resource.New(ctx, resource.WithAttributes(attribute.String("service.name", "live")), resource.WithFromEnv())
	if err != nil {
		log.WarnContext(ctx, "tracing resource incomplete", "error", err.Error())
	}
	provider := sdktrace.NewTracerProvider(sdktrace.WithBatcher(exporter), sdktrace.WithResource(res))
	otel.SetTracerProvider(provider)
	log.InfoContext(ctx, "tracing started")
	return func(ctx context.Context) {
		flush, cancel := context.WithTimeout(ctx, 3*time.Second)
		defer cancel()
		_ = provider.Shutdown(flush)
	}
}
