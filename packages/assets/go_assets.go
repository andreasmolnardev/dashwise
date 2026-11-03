// Package assets exposes the bundled Dashwise integration YAML to Go services.
package assets

import "embed"

// Files contains canonical bundled YAML integration blueprints and their
// manifest. Keys are paths relative to the assets package.
//
//go:embed defaults/integrations.json integrations/*.yaml
var Files embed.FS
