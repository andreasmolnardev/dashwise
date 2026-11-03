package config

import (
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

type Config struct {
	Address                   string
	DataDir                   string
	DatabasePath              string
	WebDist                   string
	LogLevel                  slog.Level
	DisableSignup             bool
	EnableSSO                 bool
	InstanceName              string
	Version                   string
	GitHubRepo                string
	Environment               string
	DashwiseURL               string
	NewsSubscriptionRetention int
	ActivityRetentionDays     int
	NewsRefreshInterval       time.Duration
}

func Load() Config {
	dataDir := env("DATA_DIR", "./data")
	port := env("PORT", "3000")
	newsRefreshInterval := 30 * time.Minute
	if seconds, err := strconv.Atoi(env("NEWS_REFRESH_INTERVAL_SECONDS", "")); err == nil && seconds > 0 && seconds <= 604800 {
		newsRefreshInterval = time.Duration(seconds) * time.Second
	}

	return Config{
		Address:                   ":" + port,
		DataDir:                   dataDir,
		DatabasePath:              env("DATABASE_PATH", filepath.Join(dataDir, "dashwise.sqlite")),
		WebDist:                   env("WEB_DIST", "../../web/dist"),
		LogLevel:                  parseLogLevel(env("LOG_LEVEL", "info")),
		DisableSignup:             parseBool(env("DISABLE_USER_SIGNUP", "false")),
		EnableSSO:                 parseBool(env("ENABLE_SSO", "false")),
		InstanceName:              env("INSTANCE_NAME", "Dashwise"),
		Version:                   env("DASHWISE_VERSION", "go-migration"),
		GitHubRepo:                env("DASHWISE_GITHUB_REPO", "andreasmolnardev/dashwise"),
		Environment:               env("ENVIRONMENT", "development"),
		DashwiseURL:               env("DASHWISE_URL", "http://localhost:3000"),
		NewsSubscriptionRetention: parseBoundedInt(env("NEWS_SUBSCRIPTION_RETENTION", "50"), 50, 1, 10000),
		ActivityRetentionDays:     parseBoundedInt(env("ACTIVITY_RETENTION_DAYS", "90"), 90, 1, 3650),
		NewsRefreshInterval:       newsRefreshInterval,
	}
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func parseBool(value string) bool {
	parsed, err := strconv.ParseBool(value)
	return err == nil && parsed
}

func parseBoundedInt(value string, fallback, min, max int) int {
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < min || parsed > max {
		return fallback
	}
	return parsed
}

func parseLogLevel(value string) slog.Level {
	switch value {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
