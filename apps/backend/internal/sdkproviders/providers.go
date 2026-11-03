// Package sdkproviders contains trusted, application-owned SDK provider
// bundles embedded into the Go server. User-provided JavaScript is never
// loaded by this package.
package sdkproviders

import (
	"context"
	"embed"
	"fmt"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/jsruntime"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/sdkmanager"
)

//go:embed bundles/homeassistant.cjs
var bundleFS embed.FS

// Load returns the embedded bundle registry and its catalog manifests. The
// manifest is read by evaluating only the trusted package definition; no
// lifecycle hooks run until the manager starts an enabled instance.
func Load(ctx context.Context) (sdkmanager.BundleMap, []jsruntime.Manifest, error) {
	bundle, err := bundleFS.ReadFile("bundles/homeassistant.cjs")
	if err != nil {
		return nil, nil, fmt.Errorf("read embedded Home Assistant SDK bundle: %w", err)
	}
	instance, err := jsruntime.Load(ctx, bundle, jsruntime.Options{InstanceID: "catalog-homeassistant"})
	if err != nil {
		return nil, nil, fmt.Errorf("read embedded Home Assistant SDK manifest: %w", err)
	}
	manifest := instance.Manifest()
	if manifest.ID != "homeassistant" {
		return nil, nil, fmt.Errorf("embedded Home Assistant SDK bundle declares unexpected id %q", manifest.ID)
	}
	return sdkmanager.BundleMap{"homeassistant": bundle}, []jsruntime.Manifest{manifest}, nil
}
