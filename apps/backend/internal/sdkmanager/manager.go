// Package sdkmanager owns trusted Goja integration instances and their
// serialized lifecycle. Bundles must come from an application-controlled
// registry; this package never executes JavaScript stored by a user.
package sdkmanager

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/activities"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/integrations"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/jsruntime"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resources"
	"github.com/andreasmolnardev/dashwise/packages/foundation"
)

var (
	ErrNotFound       = errors.New("SDK integration instance not found")
	ErrBundleNotFound = errors.New("trusted SDK provider bundle not found")
)

// TrustedBundleRegistry resolves only installed provider bundles. An
// application can back this with an embed.FS or a compiled release manifest.
type TrustedBundleRegistry interface {
	LoadBundle(context.Context, string) ([]byte, error)
}

// BundleMap is a convenient registry for application-embedded CommonJS
// bundles. Its source keys are provider identifiers, not arbitrary paths.
type BundleMap map[string][]byte

func (b BundleMap) LoadBundle(ctx context.Context, source string) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	source = strings.TrimSpace(source)
	if source == "" {
		return nil, ErrBundleNotFound
	}
	bundle, ok := b[source]
	if !ok || len(bundle) == 0 {
		return nil, ErrBundleNotFound
	}
	return append([]byte(nil), bundle...), nil
}

type Options struct {
	Database     *foundation.DB
	Integrations *integrations.Store
	Registry     *resources.Registry
	Resources    *resources.Store
	Activities   *activities.Store
	Bundles      TrustedBundleRegistry
	HookTimeout  time.Duration
	// Logger receives provider runtime events; optional.
	Logger *slog.Logger
}

type Status struct {
	IntegrationID string    `json:"integrationId"`
	Source        string    `json:"source"`
	State         string    `json:"state"`
	UpdatedAt     time.Time `json:"updatedAt"`
	Message       string    `json:"message,omitempty"`
}

type managedInstance struct {
	mu            sync.Mutex
	ownerID       string
	status        Status
	runtime       *jsruntime.Instance
	manifest      jsruntime.Manifest
	loadedUpdated time.Time
}

type Manager struct {
	database     *foundation.DB
	integrations *integrations.Store
	registry     *resources.Registry
	resources    *resources.Store
	activities   *activities.Store
	bundles      TrustedBundleRegistry
	hookTimeout  time.Duration
	logger       *slog.Logger
	mu           sync.RWMutex
	instances    map[string]*managedInstance
}

func New(options Options) (*Manager, error) {
	if options.Database == nil || options.Database.SQL() == nil || options.Integrations == nil || options.Registry == nil || options.Resources == nil || options.Activities == nil || options.Bundles == nil {
		return nil, errors.New("SDK manager requires database, integration store, resource registry/store, activities store, and trusted bundles")
	}
	if options.HookTimeout <= 0 {
		options.HookTimeout = 10 * time.Second
	}
	return &Manager{
		database: options.Database, integrations: options.Integrations, registry: options.Registry,
		resources: options.Resources, activities: options.Activities, bundles: options.Bundles, hookTimeout: options.HookTimeout,
		logger: options.Logger, instances: make(map[string]*managedInstance),
	}, nil
}

// StartOwner loads every enabled SDK instance for an account. Per-instance
// failures are reported in status and do not prevent other providers starting.
func (m *Manager) StartOwner(ctx context.Context, owner string) error {
	items, err := m.integrations.List(ctx, owner, true)
	if err != nil {
		return fmt.Errorf("list SDK instances: %w", err)
	}
	var first error
	for _, item := range items {
		if item.Type != "sdk" || !item.SDKEnabled {
			continue
		}
		if err := m.Start(ctx, owner, item.ID); err != nil && first == nil {
			first = err
		}
	}
	return first
}

func (m *Manager) Start(ctx context.Context, owner, instanceID string) error {
	if strings.TrimSpace(owner) == "" || strings.TrimSpace(instanceID) == "" {
		return ErrNotFound
	}
	item, err := m.integrations.Get(ctx, owner, instanceID)
	if err != nil || item.Type != "sdk" {
		return ErrNotFound
	}
	entry := m.entry(owner, item)
	entry.mu.Lock()
	defer entry.mu.Unlock()
	if !item.SDKEnabled {
		if entry.runtime != nil {
			_ = entry.runtime.Stop(ctx)
			entry.runtime = nil
		}
		entry.status.State = "disabled"
		entry.status.Message = ""
		entry.status.Source = item.Source
		entry.status.UpdatedAt = time.Now().UTC()
		return nil
	}
	if entry.runtime != nil && entry.loadedUpdated.Equal(item.Updated) {
		return nil
	}
	if entry.runtime != nil {
		_ = entry.runtime.Stop(ctx)
		entry.runtime = nil
	}
	entry.status.State = "starting"
	entry.status.Message = ""
	entry.status.Source = item.Source
	entry.status.UpdatedAt = time.Now().UTC()
	bundle, err := m.bundles.LoadBundle(ctx, item.Source)
	if err != nil {
		entry.failed("provider bundle is unavailable")
		return err
	}
	runtime, err := jsruntime.Load(ctx, bundle, jsruntime.Options{
		InstanceID: item.ID,
		Config:     item.Config,
		HookLimit:  m.hookTimeout,
		Log:        m.runtimeLogger(item.ID),
		HostFactory: func(manifest jsruntime.Manifest) (jsruntime.Host, error) {
			return jsruntime.NewStoreHost(ctx, jsruntime.HostOptions{
				OwnerID: owner, InstanceID: item.ID, Manifest: manifest, Source: item.Source,
				Database: m.database, Registry: m.registry, Resources: m.resources,
				Activities: m.activities, Secrets: item.Environment,
			})
		},
	})
	if err != nil {
		entry.failed("provider bundle could not be loaded")
		return err
	}
	if err := runtime.Start(ctx); err != nil {
		entry.failed("provider failed to start")
		// Release the dormant runtime (disposal cleanup) so a retry does not
		// leak the instance's dispatcher or reserved provider state.
		_ = runtime.Stop(context.WithoutCancel(ctx))
		return err
	}
	entry.runtime = runtime
	entry.manifest = runtime.Manifest()
	entry.loadedUpdated = item.Updated
	entry.status.State = "ready"
	entry.status.UpdatedAt = time.Now().UTC()
	return nil
}

func (m *Manager) Stop(ctx context.Context, owner, instanceID string) error {
	entry := m.get(owner, instanceID)
	if entry == nil {
		return ErrNotFound
	}
	entry.mu.Lock()
	defer entry.mu.Unlock()
	if entry.runtime != nil {
		err := entry.runtime.Stop(ctx)
		entry.runtime = nil
		entry.status.State = "stopped"
		entry.status.UpdatedAt = time.Now().UTC()
		entry.status.Message = ""
		return err
	}
	entry.status.State = "stopped"
	entry.status.UpdatedAt = time.Now().UTC()
	return nil
}

func (m *Manager) StopAll(ctx context.Context) error {
	m.mu.RLock()
	entries := make([]*managedInstance, 0, len(m.instances))
	for _, entry := range m.instances {
		entries = append(entries, entry)
	}
	m.mu.RUnlock()
	var first error
	for _, entry := range entries {
		entry.mu.Lock()
		if entry.runtime != nil {
			if err := entry.runtime.Stop(ctx); err != nil && first == nil {
				first = err
			}
			entry.runtime = nil
		}
		entry.status.State = "stopped"
		entry.status.UpdatedAt = time.Now().UTC()
		entry.mu.Unlock()
	}
	return first
}

func (m *Manager) Status(owner, instanceID string) (Status, error) {
	entry := m.get(owner, instanceID)
	if entry == nil {
		return Status{}, ErrNotFound
	}
	entry.mu.Lock()
	defer entry.mu.Unlock()
	return entry.status, nil
}

func (m *Manager) ListStatuses(owner string) []Status {
	m.mu.RLock()
	entries := make([]*managedInstance, 0, len(m.instances))
	for _, entry := range m.instances {
		if entry.ownerID == owner {
			entries = append(entries, entry)
		}
	}
	m.mu.RUnlock()
	items := make([]Status, 0, len(entries))
	for _, entry := range entries {
		entry.mu.Lock()
		items = append(items, entry.status)
		entry.mu.Unlock()
	}
	return items
}

func (m *Manager) Invoke(ctx context.Context, owner, instanceID, name string, args ...any) (any, error) {
	entry := m.get(owner, instanceID)
	if entry == nil {
		return nil, ErrNotFound
	}
	entry.mu.Lock()
	defer entry.mu.Unlock()
	if entry.runtime == nil {
		return nil, jsruntime.ErrStopped
	}
	return entry.runtime.Invoke(ctx, name, args...)
}

func (m *Manager) ExecuteAction(ctx context.Context, owner, instanceID, actionID string, resource, input any) (any, error) {
	entry := m.get(owner, instanceID)
	if entry == nil {
		return nil, ErrNotFound
	}
	entry.mu.Lock()
	defer entry.mu.Unlock()
	if entry.runtime == nil {
		return nil, jsruntime.ErrStopped
	}
	return entry.runtime.ExecuteAction(ctx, actionID, resource, input)
}

func (m *Manager) Resources(ctx context.Context, owner, instanceID string) ([]resources.Resource, error) {
	entry := m.get(owner, instanceID)
	if entry == nil {
		return nil, ErrNotFound
	}
	entry.mu.Lock()
	manifest := entry.manifest
	entry.mu.Unlock()
	if manifest.ID == "" {
		return []resources.Resource{}, nil
	}
	types := make([]string, 0, len(manifest.Resources))
	for collection := range manifest.Resources {
		types = append(types, "sdk."+manifest.ID+"."+strings.ToLower(collection))
	}
	out := make([]resources.Resource, 0)
	for offset := 0; ; offset += 200 {
		page, err := m.resources.Query(ctx, resources.Query{OwnerID: owner, Types: types, Provider: "sdk", InstanceID: instanceID, Limit: 200, Offset: offset})
		if err != nil {
			return nil, err
		}
		out = append(out, page.Items...)
		if len(page.Items) < page.Limit || offset+len(page.Items) >= page.Total {
			return out, nil
		}
	}
}

func (m *Manager) entry(owner string, item integrations.Integration) *managedInstance {
	m.mu.Lock()
	defer m.mu.Unlock()
	if entry := m.instances[item.ID]; entry != nil {
		return entry
	}
	entry := &managedInstance{ownerID: owner, status: Status{IntegrationID: item.ID, Source: item.Source, State: "stopped", UpdatedAt: time.Now().UTC()}}
	m.instances[item.ID] = entry
	return entry
}

func (m *Manager) get(owner, instanceID string) *managedInstance {
	m.mu.RLock()
	entry := m.instances[instanceID]
	m.mu.RUnlock()
	if entry == nil || entry.ownerID != owner {
		return nil
	}
	return entry
}

func (entry *managedInstance) failed(message string) {
	entry.runtime = nil
	entry.status.State = "error"
	entry.status.Message = message
	entry.status.UpdatedAt = time.Now().UTC()
}

// runtimeLogger builds the sink that receives provider runtime events with an
// instance-prefixed message. A nil manager logger drops events.
func (m *Manager) runtimeLogger(instanceID string) func(level, message string, fields map[string]any) {
	return func(level, message string, fields map[string]any) {
		if m.logger == nil {
			return
		}
		attrs := make([]any, 0, len(fields)+1)
		attrs = append(attrs, "sdk_instance", instanceID)
		for key, value := range fields {
			attrs = append(attrs, key, value)
		}
		switch level {
		case "debug":
			m.logger.Debug("[sdk] "+message, attrs...)
		case "warn":
			m.logger.Warn("[sdk] "+message, attrs...)
		case "error":
			m.logger.Error("[sdk] "+message, attrs...)
		default:
			m.logger.Info("[sdk] "+message, attrs...)
		}
	}
}
