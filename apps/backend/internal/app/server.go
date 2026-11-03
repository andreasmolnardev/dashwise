package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/auth"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/authapi"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/config"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/links"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/linksapi"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/news"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/newsapi"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resourceapi"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resources"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/viewapi"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/views"
	"github.com/andreasmolnardev/dashwise/packages/foundation"
)

type App struct {
	server    *http.Server
	db        *foundation.DB
	registry  *resources.Registry
	resources *resources.Store
	views     *views.Store
	links     *links.Store
	news      *news.Store
	auth      *auth.Store
}

func New(ctx context.Context, cfg config.Config, logger *slog.Logger) (*App, error) {
	db, err := foundation.OpenSQLite(ctx, foundation.SQLiteOptions{Path: cfg.DatabasePath})
	if err != nil {
		return nil, fmt.Errorf("open application database: %w", err)
	}
	if err := db.ApplyMigrations(ctx, initialMigrations()); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("apply application migrations: %w", err)
	}
	authStore, err := auth.NewStore(db, auth.Options{DisableSignup: cfg.DisableSignup})
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize authentication store: %w", err)
	}
	if err := authStore.Initialize(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize authentication schema: %w", err)
	}
	registry, err := resources.NewRegistry(db)
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize resource registry: %w", err)
	}
	if err := registry.RegisterBuiltins(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("register builtin resource types: %w", err)
	}
	resourceStore, err := resources.NewStore(db, registry)
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize resource store: %w", err)
	}
	viewStore, err := views.NewStore(db)
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize view store: %w", err)
	}
	linksStore, err := links.New(db)
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize Links store: %w", err)
	}
	if err := linksStore.Initialize(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize Links schema: %w", err)
	}
	newsStore, err := news.NewStore(db)
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize News store: %w", err)
	}
	if err := newsStore.Initialize(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize News schema: %w", err)
	}
	newsHandler, err := newsapi.New(newsStore, authenticateOwner(authStore), newsapi.Options{})
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize News API: %w", err)
	}
	authHandler, err := authapi.New(authStore)
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize authentication API: %w", err)
	}
	resourceHandler, err := resourceapi.New(resourceStore, registry, authenticateOwner(authStore))
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize resource API: %w", err)
	}
	viewHandler, err := viewapi.New(viewStore, resourceStore, authenticateOwner(authStore))
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize view API: %w", err)
	}
	linksHandler, err := linksapi.New(linksStore, authenticateOwner(authStore))
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize Links API: %w", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /api/v1/appConfig", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"enableSSO":     cfg.EnableSSO,
			"instance_name": cfg.InstanceName,
		})
	})
	mux.HandleFunc("GET /api/v1/appInfo", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"updateAvailable":    false,
			"currentAppVersion":  cfg.Version,
			"userSignupDisabled": cfg.DisableSignup,
		})
	})
	mux.Handle("/api/v1/auth/", authHandler)
	mux.Handle("/api/v1/resources", resourceHandler)
	mux.Handle("/api/v1/resources/", resourceHandler)
	mux.Handle("/api/v1/resource-types", resourceHandler)
	mux.Handle("/api/v1/views", viewHandler)
	mux.Handle("/api/v1/views/", viewHandler)
	mux.Handle("/api/v1/links/", linksHandler)
	mux.Handle("/api/v1/news", newsHandler)
	mux.Handle("/api/v1/news/", newsHandler)
	mux.Handle("/api/", http.NotFoundHandler())
	mux.Handle("/", frontend(cfg.WebDist))

	return &App{db: db, registry: registry, resources: resourceStore, views: viewStore, links: linksStore, news: newsStore, auth: authStore, server: &http.Server{
		Addr:              cfg.Address,
		Handler:           requestLog(cors(mux), logger),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}}, nil
}

func authenticateOwner(store *auth.Store) resourceapi.Authenticate {
	return func(r *http.Request) (string, error) {
		value := strings.TrimSpace(r.Header.Get("Authorization"))
		if len(value) < len("Bearer ") || !strings.EqualFold(value[:len("Bearer ")], "Bearer ") {
			return "", auth.ErrUnauthorized
		}
		user, session, err := store.Validate(r.Context(), strings.TrimSpace(value[len("Bearer "):]))
		if err != nil {
			return "", err
		}
		if sessionID := strings.TrimSpace(r.Header.Get("X-Session-Id")); sessionID != "" && sessionID != session.ID {
			return "", auth.ErrUnauthorized
		}
		return user.ID, nil
	}
}

func (app *App) ListenAndServe() error {
	return app.server.ListenAndServe()
}

func (app *App) Shutdown(ctx context.Context) error {
	if err := app.server.Shutdown(ctx); err != nil {
		return err
	}
	return app.db.Close()
}

func initialMigrations() []foundation.Migration {
	return []foundation.Migration{{
		ID:   "0001_core_tables",
		Name: "create initial data platform tables",
		Up: func(ctx context.Context, tx *sql.Tx) error {
			_, err := tx.ExecContext(ctx, `
				CREATE TABLE resource_types (
					type TEXT PRIMARY KEY NOT NULL,
					version INTEGER NOT NULL,
					definition_json TEXT NOT NULL,
					updated_at TEXT NOT NULL
				);

				CREATE TABLE resources (
					id TEXT PRIMARY KEY NOT NULL,
					type TEXT NOT NULL,
					provider TEXT NOT NULL,
					provider_instance_id TEXT NOT NULL DEFAULT '',
					provider_resource_id TEXT NOT NULL,
					owner_id TEXT NOT NULL DEFAULT '',
					data_json TEXT NOT NULL,
					capabilities_json TEXT NOT NULL DEFAULT '[]',
					state TEXT NOT NULL DEFAULT 'current',
					created_at TEXT NOT NULL,
					updated_at TEXT NOT NULL,
					UNIQUE(owner_id, type, provider_instance_id, provider_resource_id)
				);
				CREATE INDEX resources_by_owner_type ON resources(owner_id, type, updated_at DESC);
				CREATE INDEX resources_by_provider ON resources(provider, provider_instance_id, type);

				CREATE TABLE saved_views (
					id TEXT PRIMARY KEY NOT NULL,
					owner_id TEXT NOT NULL,
					name TEXT NOT NULL,
					definition_json TEXT NOT NULL,
					created_at TEXT NOT NULL,
					updated_at TEXT NOT NULL
				);
				CREATE INDEX saved_views_by_owner ON saved_views(owner_id, name);

				CREATE TABLE activity_events (
					id TEXT PRIMARY KEY NOT NULL,
					owner_id TEXT NOT NULL,
					event_type TEXT NOT NULL,
					occurred_at TEXT NOT NULL,
					data_json TEXT NOT NULL
				);
				CREATE INDEX activity_events_by_owner_time ON activity_events(owner_id, occurred_at DESC);

				CREATE TABLE notification_items (
					id TEXT PRIMARY KEY NOT NULL,
					owner_id TEXT NOT NULL,
					topic TEXT NOT NULL DEFAULT '',
					created_at TEXT NOT NULL,
					expires_at TEXT,
					read_at TEXT,
					dismissed_at TEXT,
					data_json TEXT NOT NULL
				);
				CREATE INDEX notification_items_by_owner ON notification_items(owner_id, created_at DESC);
				CREATE INDEX notification_items_by_expiry ON notification_items(expires_at);

				CREATE TABLE change_events (
					sequence INTEGER PRIMARY KEY AUTOINCREMENT,
					resource_id TEXT NOT NULL,
					operation TEXT NOT NULL,
					created_at TEXT NOT NULL
				);
			`)
			return err
		},
		Down: func(ctx context.Context, tx *sql.Tx) error {
			_, err := tx.ExecContext(ctx, `
				DROP TABLE IF EXISTS change_events;
				DROP TABLE IF EXISTS notification_items;
				DROP TABLE IF EXISTS activity_events;
				DROP TABLE IF EXISTS saved_views;
				DROP TABLE IF EXISTS resources;
				DROP TABLE IF EXISTS resource_types;
			`)
			return err
		},
	}}
}

func frontend(root string) http.Handler {
	fileServer := http.FileServer(http.Dir(root))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}

		path := filepath.Join(root, filepath.Clean("/"+r.URL.Path))
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			fileServer.ServeHTTP(w, r)
			return
		}
		if _, err := os.Stat(filepath.Join(root, "index.html")); err != nil {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, filepath.Join(root, "index.html"))
	})
}

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Session-Id")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func requestLog(next http.Handler, logger *slog.Logger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		next.ServeHTTP(w, r)
		logger.Info("http request", "method", r.Method, "path", r.URL.Path, "duration", time.Since(started))
	})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
