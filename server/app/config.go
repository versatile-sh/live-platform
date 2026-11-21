// Package app is the composition root of the server: it reads the configuration once, wires the adapters and runs them.
package app

import (
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/versatile-sh/live/server/audit"
)

const metricsDefault = time.Minute

// Config is every setting the server reads from its environment, validated once at startup.
type Config struct {
	HTTPAddr      string
	SignalAddr    string
	GitHubRepo    string
	PassSource    string
	PassKey       string
	WebDir        string
	WebLiveDir    string
	CountryHeader string
	AddressHeader string
	Origins       []string
	Media         bool
	MediaUDPPort  int
	MediaPublicIP string
	HandoverDir   string
	Audit         AuditConfig
	MetricsEvery  time.Duration
}

// AuditConfig turns the audit trail on when Dir is set; Mirror also writes each event to the log.
type AuditConfig struct {
	Dir           string
	Queue         int
	Mirror        bool
	RetentionDays int
}

// Load reads the configuration through getenv and fails on the first bad setting, naming it.
func Load(getenv func(string) string) (Config, error) {
	env := func(key, fallback string) string {
		if v := getenv(key); v != "" {
			return v
		}
		return fallback
	}
	host := env("HOST", "127.0.0.1")
	cfg := Config{
		HTTPAddr:      net.JoinHostPort(host, env("PORT", "8080")),
		SignalAddr:    net.JoinHostPort(host, env("SIGNAL_PORT", "8081")),
		GitHubRepo:    getenv("GITHUB_REPO"),
		PassSource:    getenv("PASS_SOURCE"),
		PassKey:       getenv("PASS_KEY"),
		WebDir:        getenv("WEB_DIR"),
		WebLiveDir:    getenv("WEB_LIVE_DIR"),
		CountryHeader: getenv("COUNTRY_HEADER"),
		AddressHeader: getenv("ADDRESS_HEADER"),
		Media:         getenv("MEDIA") != "off",
		MediaPublicIP: getenv("MEDIA_PUBLIC_IP"),
		HandoverDir:   getenv("HANDOVER_DIR"),
		Audit:         AuditConfig{Dir: getenv("AUDIT_DIR"), RetentionDays: audit.DefaultRetentionDays},
		MetricsEvery:  metricsDefault,
	}
	if raw := getenv("PUBLIC_ORIGIN"); raw != "" {
		cfg.Origins = strings.Split(raw, ",")
	}
	var err error
	if cfg.MediaUDPPort, err = intSetting(getenv, "MEDIA_UDP_PORT", 0, 0, 65535); err != nil {
		return Config{}, err
	}
	if cfg.Audit.Queue, err = intSetting(getenv, "AUDIT_QUEUE", 0, 1, 1<<24); err != nil {
		return Config{}, err
	}
	if cfg.Audit.RetentionDays, err = intSetting(getenv, "AUDIT_RETENTION_DAYS", audit.DefaultRetentionDays, 1, 1<<16); err != nil {
		return Config{}, err
	}
	if raw := getenv("AUDIT_LOG_STDOUT"); raw != "" {
		if cfg.Audit.Mirror, err = strconv.ParseBool(raw); err != nil {
			return Config{}, fmt.Errorf("AUDIT_LOG_STDOUT: %q is not a boolean", raw)
		}
	}
	if raw := getenv("METRICS_INTERVAL"); raw != "" {
		if cfg.MetricsEvery, err = time.ParseDuration(raw); err != nil || cfg.MetricsEvery < 0 {
			return Config{}, fmt.Errorf("METRICS_INTERVAL: %q is not a duration of 0 or more", raw)
		}
	}
	return cfg, nil
}

func intSetting(getenv func(string) string, key string, fallback, minimum, maximum int) (int, error) {
	raw := getenv(key)
	if raw == "" {
		return fallback, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < minimum || n > maximum {
		return 0, fmt.Errorf("%s: %q is not a whole number from %d to %d", key, raw, minimum, maximum)
	}
	return n, nil
}
