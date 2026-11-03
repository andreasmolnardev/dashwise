package config

import (
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
)

type Config struct {
	Address       string
	DataDir       string
	DatabasePath  string
	WebDist       string
	LogLevel      slog.Level
	DisableSignup bool
	EnableSSO     bool
	InstanceName  string
	Version       string
	Environment   string
}

func Load() Config {
	dataDir := env("DATA_DIR", "./data")
	port := env("PORT", "3000")

	return Config{
		Address:       ":" + port,
		DataDir:       dataDir,
		DatabasePath:  env("DATABASE_PATH", filepath.Join(dataDir, "dashwise.sqlite")),
		WebDist:       env("WEB_DIST", "../../web/dist"),
		LogLevel:      parseLogLevel(env("LOG_LEVEL", "info")),
		DisableSignup: parseBool(env("DISABLE_USER_SIGNUP", "false")),
		EnableSSO:     parseBool(env("ENABLE_SSO", "false")),
		InstanceName:  env("INSTANCE_NAME", "Dashwise"),
		Version:       env("DASHWISE_VERSION", "go-migration"),
		Environment:   env("ENVIRONMENT", "development"),
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
