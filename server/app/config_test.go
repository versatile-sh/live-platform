package app

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func envOf(values map[string]string) func(string) string {
	return func(key string) string { return values[key] }
}

func TestLoad(t *testing.T) {
	t.Run("an empty environment gives the local defaults", func(t *testing.T) {
		cfg, err := Load(envOf(nil))
		require.NoError(t, err)
		assert.Equal(t, "127.0.0.1:8080", cfg.HTTPAddr)
		assert.Equal(t, "127.0.0.1:8081", cfg.SignalAddr)
		assert.True(t, cfg.Media)
		assert.Zero(t, cfg.MediaUDPPort)
		assert.Equal(t, 183, cfg.Audit.RetentionDays)
		assert.Equal(t, time.Minute, cfg.MetricsEvery)
		assert.Nil(t, cfg.Origins)
	})
	t.Run("the deployed settings are read as given", func(t *testing.T) {
		cfg, err := Load(envOf(map[string]string{
			"HOST": "0.0.0.0", "PORT": "3000", "SIGNAL_PORT": "3001", "MEDIA_UDP_PORT": "40000",
			"AUDIT_DIR": "/audit", "AUDIT_LOG_STDOUT": "1", "AUDIT_RETENTION_DAYS": "30", "METRICS_INTERVAL": "0",
			"PUBLIC_ORIGIN": "https://a.example,https://b.example", "MEDIA": "off",
		}))
		require.NoError(t, err)
		assert.Equal(t, "0.0.0.0:3000", cfg.HTTPAddr)
		assert.Equal(t, 40000, cfg.MediaUDPPort)
		assert.Equal(t, AuditConfig{Dir: "/audit", Mirror: true, RetentionDays: 30}, cfg.Audit)
		assert.Zero(t, cfg.MetricsEvery)
		assert.Equal(t, []string{"https://a.example", "https://b.example"}, cfg.Origins)
		assert.False(t, cfg.Media)
	})
	t.Run("a bad setting stops startup and names itself", func(t *testing.T) {
		for key, raw := range map[string]string{
			"MEDIA_UDP_PORT": "forty", "AUDIT_QUEUE": "-1", "AUDIT_RETENTION_DAYS": "0",
			"AUDIT_LOG_STDOUT": "maybe", "METRICS_INTERVAL": "soon",
		} {
			_, err := Load(envOf(map[string]string{key: raw}))
			require.Error(t, err, key)
			assert.Contains(t, err.Error(), key)
		}
	})
}
