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
	"sync"
	"time"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/activities"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/activitiesapi"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/auth"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/authapi"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/backgroundjobs"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/cache"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/calendarapi"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/config"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/consumersapi"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/deviceauth"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/deviceauthapi"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/importexport"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/importexportapi"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/integrations"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/integrationsapi"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/links"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/linksapi"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/monitoring"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/monitoringapi"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/news"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/newsapi"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/notifications"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/notificationsapi"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/pages"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/pagesapi"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/realtimeapi"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/realtimebroker"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resourceapi"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resources"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resourcesync"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/sdkintegrationsapi"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/sdkmanager"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/sdkproviders"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/secrets"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/shortcuts"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/shortcutsapi"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/systemapi"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/viewapi"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/views"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/wallpapers"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/wallpapersapi"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/yamlruntime"
	"github.com/andreasmolnardev/dashwise/packages/foundation"
)

type App struct {
	server       *http.Server
	db           *foundation.DB
	sdkManager   *sdkmanager.Manager
	registry     *resources.Registry
	resources    *resources.Store
	views        *views.Store
	links        *links.Store
	news         *news.Store
	auth         *auth.Store
	workerCancel context.CancelFunc
	workers      sync.WaitGroup
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
	deviceAuthStore, err := deviceauth.New(db, authStore, 5*time.Minute)
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize device authorization store: %w", err)
	}
	if err := deviceAuthStore.Initialize(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize device authorization schema: %w", err)
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
	if err := resourceStore.Initialize(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize resource store schema: %w", err)
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
	if err := linksStore.InitializeRSS(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize Links RSS schema: %w", err)
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
	secretProtector, err := secrets.OpenFileProtector(filepath.Join(cfg.DataDir, "secret.key"))
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize credential encryption: %w", err)
	}
	monitoringStore, err := monitoring.NewStore(db, secretProtector)
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize Monitoring store: %w", err)
	}
	if err := monitoringStore.Initialize(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize Monitoring schema: %w", err)
	}
	notificationsStore, err := notifications.NewStore(db)
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize Notifications store: %w", err)
	}
	if err := notificationsStore.Initialize(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize Notifications schema: %w", err)
	}
	activitiesStore, err := activities.New(db)
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize Activities store: %w", err)
	}
	if err := activitiesStore.Initialize(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize Activities schema: %w", err)
	}
	wallpapersStore, err := wallpapers.New(db, filepath.Join(cfg.DataDir, "wallpapers"))
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize Wallpapers store: %w", err)
	}
	if err := wallpapersStore.Initialize(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize Wallpapers schema: %w", err)
	}
	integrationsStore, err := integrations.NewStore(db, secretProtector)
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize Integrations store: %w", err)
	}
	if err := integrationsStore.Initialize(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize Integrations schema: %w", err)
	}
	shortcutsStore, err := shortcuts.New(db, resourceStore)
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize Shortcuts store: %w", err)
	}
	yamlRuntime := yamlruntime.New()
	endpointCache, err := cache.NewStore(db)
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize YAML endpoint cache: %w", err)
	}
	if err := endpointCache.Initialize(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize YAML endpoint cache schema: %w", err)
	}
	yamlRuntime.Cache = endpointCache
	pagesStore, err := pages.New(db)
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize Pages store: %w", err)
	}
	if err := pagesStore.Initialize(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize Pages schema: %w", err)
	}
	transferStore, err := importexport.New(db, secretProtector, filepath.Join(cfg.DataDir, "wallpapers"))
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize migration archive store: %w", err)
	}
	if err := transferStore.Initialize(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize migration archive schema: %w", err)
	}
	newsFetcher := news.NewFetcher()
	newsFetcher.Retention = cfg.NewsSubscriptionRetention
	newsHandler, err := newsapi.New(newsStore, authenticateOwner(authStore), newsapi.Options{
		ResolveMetadata: func(ctx context.Context, feedURL string) (newsapi.Metadata, error) {
			title, icon, err := newsFetcher.Metadata(ctx, feedURL)
			return newsapi.Metadata{FeedURL: feedURL, Title: title, Icon: icon}, err
		},
		Refresh: func(ctx context.Context, owner string, ids []string) error {
			_, err := newsStore.Refresh(ctx, owner, ids, newsFetcher)
			return err
		},
		SyncResources: func(ctx context.Context, owner string) error {
			return resourcesync.SyncNewsOwner(ctx, owner, newsStore, resourceStore)
		},
		ReadItems: func(ctx context.Context, owner, id string) (any, error) {
			return newsStore.ReadSubscriptionItems(ctx, owner, id, 1000)
		},
	})
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize News API: %w", err)
	}
	authHandler, err := authapi.New(authStore, authapi.Options{
		OIDC: authapi.OIDCOptions{
			Enabled: cfg.EnableSSO, IssuerURL: cfg.OIDCIssuerURL, ClientID: cfg.OIDCClientID,
			ClientSecret: cfg.OIDCClientSecret, RedirectURL: cfg.OIDCRedirectURL,
			Scopes: cfg.OIDCScopes, SecureCookie: strings.EqualFold(cfg.Environment, "production"),
		},
	})
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize authentication API: %w", err)
	}
	deviceAuthHandler, err := deviceauthapi.New(deviceAuthStore, authStore, deviceauthapi.Options{RequireTLS: strings.EqualFold(cfg.Environment, "production")})
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize device authorization API: %w", err)
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
	linksHandler, err := linksapi.New(linksStore, authenticateOwner(authStore), resourceStore)
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize Links API: %w", err)
	}
	monitoringHandler, err := monitoringapi.New(monitoringStore, authenticateOwner(authStore), func(r *http.Request, host monitoring.Host) error {
		return monitoringStore.RefreshHost(r.Context(), host.OwnerID, host.ID)
	}, monitoringapi.SDKResourceDependencies{Resources: resourceStore, Registry: registry, Integrations: integrationsStore})
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize Monitoring API: %w", err)
	}
	notificationsHandler, err := notificationsapi.New(notificationsStore, authenticateOwner(authStore))
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize Notifications API: %w", err)
	}
	sdkBundles, sdkManifests, err := sdkproviders.Load(ctx)
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("load trusted SDK providers: %w", err)
	}
	sdkManager, err := sdkmanager.New(sdkmanager.Options{
		Database: db, Integrations: integrationsStore, Registry: registry, Resources: resourceStore,
		Activities: activitiesStore, Notifications: notificationsStore, Bundles: sdkBundles, Logger: logger,
	})
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize SDK integration manager: %w", err)
	}
	sdkIntegrationsHandler, err := sdkintegrationsapi.New(integrationsStore, sdkManager, authenticateOwner(authStore), sdkManifests, resourceStore)
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize SDK integrations API: %w", err)
	}
	// Retained manifests feed the Activities definitions surface the same way
	// they feed the SDK catalog.
	activityManifests := make([]activities.SDKManifest, 0, len(sdkManifests))
	for _, manifest := range sdkManifests {
		activityManifests = append(activityManifests, activities.SDKManifest{
			ID: manifest.ID, Name: manifest.Name, Description: manifest.Description, Activities: manifest.Activities,
		})
	}
	activitiesHandler, err := activitiesapi.NewWithDefinitions(activitiesStore, authenticateOwner(authStore), integrationsStore, notificationsStore, resourceStore, registry, activityManifests...)
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize Activities API: %w", err)
	}
	// Shared realtime session broker: the activity websocket registers every
	// authenticated connection under owner and session, and the integrations
	// proxy routes shortcut actions to those sessions through this instance.
	shortcutBroker := realtimebroker.New()
	activityRealtimeHandler, err := realtimeapi.NewActivityHandler(
		authStore, activitiesStore, notificationsStore, integrationsStore, resourceStore, pagesStore,
		func(ctx context.Context, owner string, pageConfig map[string]any) []map[string]any {
			return consumersapi.ResolvePageData(ctx, owner, pageConfig, integrationsStore, resourceStore)
		},
		shortcutBroker,
	)
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize Activity realtime API: %w", err)
	}
	wallpapersHandler, err := wallpapersapi.New(wallpapersStore, authenticateOwner(authStore))
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize Wallpapers API: %w", err)
	}
	integrationsHandler, err := integrationsapi.NewWithShortcuts(integrationsStore, authenticateOwner(authStore), shortcutsStore, authStore, shortcutBroker, yamlRuntime)
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize Integrations API: %w", err)
	}
	calendarHandler, err := calendarapi.New(integrationsStore, authenticateOwner(authStore), resourceStore)
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize Calendar API: %w", err)
	}
	systemHandler, err := systemapi.NewWithOptions(authenticateOwner(authStore), systemapi.Options{
		Version: cfg.Version, GitHubRepo: cfg.GitHubRepo, DisableSignup: cfg.DisableSignup,
	})
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize system API: %w", err)
	}
	pagesHandler, err := pagesapi.New(pagesStore, authenticateOwner(authStore), func(ctx context.Context, owner string, pageConfig map[string]any) []map[string]any {
		return consumersapi.ResolvePageData(ctx, owner, pageConfig, integrationsStore, resourceStore)
	})
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize Pages API: %w", err)
	}
	consumersHandler, err := consumersapi.New(integrationsStore, authenticateOwner(authStore), yamlRuntime, resourceStore)
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize Widgets and Glanceables API: %w", err)
	}
	shortcutsHandler, err := shortcutsapi.New(shortcutsStore, authenticateOwner(authStore))
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize Shortcuts API: %w", err)
	}
	transferHandler, err := importexportapi.New(transferStore, authenticateOwner(authStore))
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize migration archive API: %w", err)
	}
	maintenanceRunner, err := backgroundjobs.New(backgroundjobs.Options{
		Users: authStore, News: newsStore, NewsFetcher: newsFetcher, Resources: resourceStore,
		Activities: activitiesStore, Monitoring: monitoringStore, Notifications: notificationsStore,
		Logger: logger, ActivityRetentionDays: cfg.ActivityRetentionDays,
		NewsInterval: cfg.NewsRefreshInterval,
	})
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize background maintenance: %w", err)
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
	mux.Handle("/api/v1/auth/device-code", deviceAuthHandler)
	mux.Handle("/api/v1/auth/device-code/", deviceAuthHandler)
	mux.Handle("/api/v1/auth/", authHandler)
	mux.Handle("/api/v1/sessions", authHandler)
	mux.Handle("/api/v1/sessions/", authHandler)
	mux.Handle("/api/v1/resources", resourceHandler)
	mux.Handle("/api/v1/resources/", resourceHandler)
	mux.Handle("/api/v1/resource-types", resourceHandler)
	mux.Handle("/api/v1/views", viewHandler)
	mux.Handle("/api/v1/views/", viewHandler)
	mux.Handle("/api/v1/links/", linksHandler)
	mux.Handle("/api/v1/news", newsHandler)
	mux.Handle("/api/v1/news/", newsHandler)
	mux.Handle("/api/v1/monitors", monitoringHandler)
	mux.Handle("/api/v1/monitors/", monitoringHandler)
	mux.Handle("/api/v1/monitoringStatus", monitoringHandler)
	mux.Handle("/api/v1/monitoring/", monitoringHandler)
	mux.Handle("/api/v1/notifications", notificationsHandler)
	mux.Handle("/api/v1/notifications/", notificationsHandler)
	mux.Handle("/api/v1/activities", activitiesHandler)
	mux.Handle("/api/v1/activities/", activitiesHandler)
	mux.Handle("/api/v1/activity", activityRealtimeHandler)
	mux.Handle("/api/v1/integrations/{integrationId}/activities", activitiesHandler)
	mux.Handle("/api/v1/wallpapers", wallpapersHandler)
	mux.Handle("/api/v1/appInfo", systemHandler)
	mux.Handle("/api/v1/integrations/caldav/", calendarHandler)
	mux.Handle("/api/v1/migration/", transferHandler)
	mux.Handle("/api/v1/integrations", integrationsHandler)
	mux.Handle("/api/v1/integrations/", integrationsHandler)
	mux.Handle("/api/v1/sdk-integrations/", sdkIntegrationsHandler)
	mux.Handle("/api/v1/locations", systemHandler)
	mux.Handle("/api/v1/jobs/pullIcons", systemHandler)
	mux.Handle("/api/v1/pageConfig", pagesHandler)
	mux.Handle("/api/v1/pageConfig/", pagesHandler)
	mux.Handle("/api/v1/widgets", consumersHandler)
	mux.Handle("/api/v1/widgets/", consumersHandler)
	mux.Handle("/api/v1/glanceables", consumersHandler)
	mux.Handle("/api/v1/glanceables/", consumersHandler)
	mux.Handle("/api/v1/integrations/consumerData", consumersHandler)
	mux.Handle("/api/v1/integrations/widget-properties", consumersHandler)
	mux.Handle("/api/v1/shortcuts", shortcutsHandler)
	mux.Handle("/api/v1/shortcuts/", shortcutsHandler)
	mux.Handle("/api/", http.NotFoundHandler())
	mux.Handle("/", frontend(cfg.WebDist))

	app := &App{db: db, sdkManager: sdkManager, registry: registry, resources: resourceStore, views: viewStore, links: linksStore, news: newsStore, auth: authStore, server: &http.Server{
		Addr:              cfg.Address,
		Handler:           requestLog(cors(mux), logger),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}}
	workerCtx, workerCancel := context.WithCancel(context.Background())
	app.workerCancel = workerCancel
	// Restore enabled provider instances after restart. Provider errors are
	// isolated per account and are reflected through the SDK status endpoint.
	app.workers.Add(1)
	go func() {
		defer app.workers.Done()
		owners, err := authStore.ListUserIDs(workerCtx)
		if err != nil {
			if workerCtx.Err() == nil {
				logger.Error("list accounts for SDK integration startup", "error", err)
			}
			return
		}
		for _, owner := range owners {
			if err := sdkManager.StartOwner(workerCtx, owner); err != nil && workerCtx.Err() == nil {
				logger.Error("start SDK integrations", "owner_id", owner, "error", err)
			}
		}
	}()
	app.workers.Add(1)
	go func() {
		defer app.workers.Done()
		if err := notificationsStore.RunDeliveryWorker(workerCtx, 10*time.Second, notifications.SendViaShoutrrr); err != nil && workerCtx.Err() == nil {
			logger.Error("notification delivery worker stopped", "error", err)
		}
	}()
	app.workers.Add(1)
	go func() {
		defer app.workers.Done()
		if err := monitoringStore.RunAgentPoller(workerCtx, 15*time.Second); err != nil && workerCtx.Err() == nil {
			logger.Error("System Agent poller stopped", "error", err)
		}
	}()
	app.workers.Add(1)
	go func() {
		defer app.workers.Done()
		if err := systemHandler.RunVersionChecks(workerCtx); err != nil && workerCtx.Err() == nil {
			logger.Error("app version checker stopped", "error", err)
		}
	}()
	app.workers.Add(1)
	go func() {
		defer app.workers.Done()
		if err := runResourceSync(workerCtx, authStore, linksStore, newsStore, monitoringStore, integrationsStore, yamlRuntime, registry, resourceStore, logger); err != nil && workerCtx.Err() == nil {
			logger.Error("native resource sync stopped", "error", err)
		}
	}()
	app.workers.Add(1)
	go func() {
		defer app.workers.Done()
		if err := runActivityConditionReconciliation(workerCtx, authStore, activitiesStore, notificationsStore, resourceStore, registry, logger); err != nil && workerCtx.Err() == nil {
			logger.Error("resource activity condition reconciliation stopped", "error", err)
		}
	}()
	app.workers.Add(1)
	go func() {
		defer app.workers.Done()
		if err := maintenanceRunner.Run(workerCtx); err != nil && workerCtx.Err() == nil {
			logger.Error("background maintenance runner stopped", "error", err)
		}
	}()
	return app, nil
}

func runActivityConditionReconciliation(ctx context.Context, authStore *auth.Store, activityStore *activities.Store, notificationStore *notifications.Store, resourceStore *resources.Store, registry *resources.Registry, logger *slog.Logger) error {
	reconcile := func() {
		owners, err := authStore.ListUserIDs(ctx)
		if err != nil {
			if ctx.Err() == nil {
				logger.Error("list accounts for activity condition reconciliation", "error", err)
			}
			return
		}
		for _, owner := range owners {
			settings, err := activityStore.DefinitionSettings(ctx, owner)
			if err != nil {
				if ctx.Err() == nil {
					logger.Error("load activity conditions", "owner_id", owner, "error", err)
				}
				continue
			}
			for _, condition := range settings.Conditions {
				if err := activities.ReconcileResourceConditionSnapshot(ctx, activityStore, notificationStore, owner, condition, resourceStore, registry); err != nil {
					if ctx.Err() == nil {
						logger.Error("reconcile resource activity condition", "owner_id", owner, "condition_id", condition.ID, "error", err)
					}
				}
			}
		}
	}
	reconcile()
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			reconcile()
		}
	}
}

func runResourceSync(ctx context.Context, authStore *auth.Store, linksStore *links.Store, newsStore *news.Store, monitoringStore *monitoring.Store, integrationsStore *integrations.Store, yamlRuntime *yamlruntime.Runtime, registry *resources.Registry, resourceStore *resources.Store, logger *slog.Logger) error {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		owners, err := authStore.ListUserIDs(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			logger.Error("list accounts for resource sync", "error", err)
		} else {
			for _, owner := range owners {
				if err := resourcesync.SyncOwner(ctx, owner, linksStore, monitoringStore, resourceStore); err != nil {
					if ctx.Err() != nil {
						return ctx.Err()
					}
					logger.Error("sync native resources", "owner_id", owner, "error", err)
				}
				if err := resourcesync.SyncYAMLResources(ctx, owner, integrationsStore, yamlRuntime, registry, resourceStore); err != nil {
					if ctx.Err() != nil {
						return ctx.Err()
					}
					logger.Error("sync YAML integration resources", "owner_id", owner, "error", err)
				}
				if err := resourcesync.SyncNewsOwner(ctx, owner, newsStore, resourceStore); err != nil {
					if ctx.Err() != nil {
						return ctx.Err()
					}
					logger.Error("sync News resources", "owner_id", owner, "error", err)
				}
			}
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
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
	serverErr := app.server.Shutdown(ctx)
	if app.workerCancel != nil {
		app.workerCancel()
	}
	app.workers.Wait()
	// Stop JavaScript provider hooks before closing the database they use.
	if app.sdkManager != nil {
		if err := app.sdkManager.StopAll(ctx); err != nil && serverErr == nil {
			serverErr = err
		}
	}
	closeErr := app.db.Close()
	if serverErr != nil {
		return serverErr
	}
	return closeErr
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
