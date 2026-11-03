package jsruntime

import (
	"context"
	"crypto/tls"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/textproto"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resources"
	"github.com/andreasmolnardev/dashwise/packages/foundation"
)

const (
	maxSDKRecordBytes = 256 << 10
	maxSDKBatchSize   = 1000
	maxSDKStorageSize = 256 << 10
)

var collectionName = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_-]{0,63}$`)
var sdkCapability = regexp.MustCompile(`^[a-z][a-z0-9_.-]{0,127}$`)

// HostOptions binds an SDK manifest to its owner-scoped integration instance.
// Registry types are generated from each collection's optional JSON schema.
type HostOptions struct {
	OwnerID    string
	InstanceID string
	Manifest   Manifest
	Database   *foundation.DB
	Registry   *resources.Registry
	Resources  *resources.Store
	Secrets    map[string]string
}

// StoreHost implements resource collection CRUD/sync and persistent per
// integration storage. It intentionally omits HTTP, actions, events, timers,
// secrets and websocket capabilities until their dedicated host adapters exist.
type StoreHost struct {
	ownerID      string
	instanceID   string
	manifestID   string
	collections  map[string]string // collection name to registered resource type
	fields       map[string]map[string]bool
	configFields map[string]map[string]any
	db           *sql.DB
	foundation   *foundation.DB
	resources    *resources.Store
	secrets      map[string]string
}

func NewStoreHost(ctx context.Context, options HostOptions) (*StoreHost, error) {
	if options.Database == nil || options.Database.SQL() == nil || options.Registry == nil || options.Resources == nil {
		return nil, errors.New("SDK host requires the open database, resource registry, and resource store")
	}
	if strings.TrimSpace(options.OwnerID) == "" || strings.TrimSpace(options.InstanceID) == "" || len(options.InstanceID) > 128 {
		return nil, errors.New("SDK host requires owner and integration instance IDs")
	}
	if !validIdentifier(options.Manifest.ID) || options.Manifest.ID != strings.ToLower(options.Manifest.ID) {
		return nil, errors.New("SDK manifest has an invalid integration ID")
	}
	if len(options.Manifest.Resources) == 0 || len(options.Manifest.Resources) > 100 {
		return nil, errors.New("SDK manifest must declare between 1 and 100 resource collections")
	}
	host := &StoreHost{
		ownerID: options.OwnerID, instanceID: options.InstanceID, manifestID: options.Manifest.ID,
		collections: make(map[string]string, len(options.Manifest.Resources)), fields: make(map[string]map[string]bool, len(options.Manifest.Resources)),
		configFields: make(map[string]map[string]any, len(options.Manifest.Config)),
		db:           options.Database.SQL(), foundation: options.Database, resources: options.Resources,
		secrets: cloneStrings(options.Secrets),
	}
	for key, raw := range options.Manifest.Config {
		if value, ok := raw.(map[string]any); ok {
			host.configFields[key] = value
		}
	}
	for collection, raw := range options.Manifest.Resources {
		if !collectionName.MatchString(collection) {
			return nil, fmt.Errorf("SDK resource collection %q is invalid", collection)
		}
		resourceType := "sdk." + strings.ToLower(options.Manifest.ID) + "." + strings.ToLower(collection)
		definition, err := sdkResourceDefinition(resourceType, options.Manifest.Name, collection, raw)
		if err != nil {
			return nil, err
		}
		if err := options.Registry.Register(ctx, definition); err != nil {
			return nil, fmt.Errorf("register SDK collection %q: %w", collection, err)
		}
		host.collections[collection] = resourceType
		host.fields[collection] = sdkRecordFields(raw)
	}
	if err := host.foundation.ApplyMigrations(ctx, []foundation.Migration{{
		ID: "0017_sdk_host_storage", Name: "create owner scoped SDK host storage",
		Up: func(ctx context.Context, tx *sql.Tx) error {
			_, err := tx.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS sdk_storage (
				owner_id TEXT NOT NULL,
				integration_instance_id TEXT NOT NULL,
				storage_key TEXT NOT NULL,
				value_json TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				PRIMARY KEY(owner_id,integration_instance_id,storage_key)
			)`)
			return err
		},
	}}); err != nil {
		return nil, fmt.Errorf("initialize SDK storage: %w", err)
	}
	return host, nil
}

func (h *StoreHost) Call(ctx context.Context, instanceID, operation string, args []any) (any, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if instanceID != h.instanceID {
		return nil, errors.New("SDK host instance scope mismatch")
	}
	if len(args) > 4 {
		return nil, errors.New("SDK host operation has too many arguments")
	}
	if operation == "secrets.get" {
		key, err := stringArg(args, 0, "secret key")
		if err != nil {
			return nil, err
		}
		_, declared := h.secretDefinition(key)
		if !declared {
			return nil, errors.New("SDK requested an undeclared secret")
		}
		value := h.secrets[key]
		if value == "" {
			return nil, nil
		}
		return value, nil
	}
	if operation == "http.assertSafeUrl" {
		return h.assertSafeURL(ctx, args)
	}
	if operation == "http.fetch" {
		return h.fetch(ctx, args)
	}
	if operation == "storage.get" || operation == "storage.set" || operation == "storage.delete" {
		return h.storage(ctx, operation, args)
	}
	parts := strings.Split(operation, ".")
	if len(parts) != 3 || parts[0] != "resources" {
		return nil, fmt.Errorf("SDK host operation %q is not supported", operation)
	}
	resourceType, ok := h.collections[parts[1]]
	if !ok {
		return nil, fmt.Errorf("SDK collection %q is not declared", parts[1])
	}
	switch parts[2] {
	case "get":
		id, err := stringArg(args, 0, "resource ID")
		if err != nil {
			return nil, err
		}
		item, err := h.find(ctx, resourceType, id)
		if errors.Is(err, resources.ErrNotFound) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		return item.Data, nil
	case "upsert":
		return h.upsert(ctx, parts[1], resourceType, args)
	case "update":
		return h.update(ctx, parts[1], resourceType, args)
	case "remove":
		return h.remove(ctx, resourceType, args)
	case "sync":
		return h.sync(ctx, parts[1], resourceType, args)
	default:
		return nil, fmt.Errorf("SDK resource operation %q is not supported", parts[2])
	}
}

func (h *StoreHost) secretDefinition(key string) (map[string]any, bool) {
	definition, ok := h.configFields[key]
	return definition, ok && stringArgValue(definition["type"]) == "secret"
}

func (h *StoreHost) assertSafeURL(ctx context.Context, args []any) (string, error) {
	value, err := stringArg(args, 0, "URL")
	if err != nil {
		return "", err
	}
	u, ips, err := safeURL(ctx, value)
	if err != nil {
		return "", err
	}
	if len(args) > 1 {
		allowed := stringSlice(args[1])
		if len(allowed) > 0 {
			ok := false
			for _, scheme := range allowed {
				if strings.TrimSuffix(strings.ToLower(scheme), ":") == u.Scheme {
					ok = true
				}
			}
			if !ok {
				return "", errors.New("SDK URL protocol is not allowed")
			}
		}
	}
	_ = ips // Resolution is repeated and pinned when the request is made.
	return u.String(), nil
}

func (h *StoreHost) fetch(ctx context.Context, args []any) (any, error) {
	urlText, err := stringArg(args, 0, "URL")
	if err != nil {
		return nil, err
	}
	u, ips, err := safeURL(ctx, urlText)
	if err != nil {
		return nil, err
	}
	method := http.MethodGet
	header := make(http.Header)
	var body io.Reader
	if len(args) > 1 {
		init, _ := args[1].(map[string]any)
		if value := strings.ToUpper(stringArgValue(init["method"])); value != "" {
			method = value
		}
		for name, raw := range objectValue(init["headers"]) {
			key := textproto.CanonicalMIMEHeaderKey(name)
			value := fmt.Sprint(raw)
			if key == "" || strings.ContainsAny(name+value, "\r\n") || len(key) > 128 || len(value) > 8192 {
				return nil, errors.New("SDK HTTP header is invalid")
			}
			header.Add(key, value)
		}
		if raw, exists := init["body"]; exists && raw != nil {
			text, ok := raw.(string)
			if !ok || len(text) > maxSDKHTTPBytes {
				return nil, errors.New("SDK HTTP request body must be a string under 5 MB")
			}
			body = strings.NewReader(text)
		}
	}
	if !validHTTPMethod(method) {
		return nil, errors.New("SDK HTTP method is invalid")
	}
	request, err := http.NewRequestWithContext(ctx, method, u.String(), body)
	if err != nil {
		return nil, err
	}
	request.Header = header
	transport := &http.Transport{
		Proxy:           nil,
		TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12},
		DialContext:     pinnedDial(ips),
	}
	client := &http.Client{Transport: transport, Timeout: 30 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 || len(via) > 0 && !sameOrigin(via[len(via)-1].URL, req.URL) {
			return errors.New("SDK HTTP request redirected outside the configured origin")
		}
		return nil
	}}
	defer transport.CloseIdleConnections()
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	contents, err := io.ReadAll(io.LimitReader(response.Body, maxSDKHTTPBytes+1))
	if err != nil {
		return nil, err
	}
	if len(contents) > maxSDKHTTPBytes {
		return nil, errors.New("SDK HTTP response exceeds 5 MB")
	}
	headers := map[string]string{}
	for name, values := range response.Header {
		if len(values) > 0 {
			headers[name] = values[0]
		}
	}
	return map[string]any{"status": response.StatusCode, "statusText": http.StatusText(response.StatusCode), "headers": headers, "body": string(contents)}, nil
}

const maxSDKHTTPBytes = 5 << 20

func safeURL(ctx context.Context, raw string) (*url.URL, []net.IP, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil || u.Fragment != "" {
		return nil, nil, errors.New("SDK URL must be absolute HTTP(S) without credentials or fragments")
	}
	host := strings.TrimSuffix(strings.ToLower(u.Hostname()), ".")
	if host == "localhost" || strings.HasSuffix(host, ".localhost") || host == "metadata.google.internal" || host == "metadata" {
		return nil, nil, errors.New("SDK URL targets a blocked host")
	}
	var ips []net.IP
	if ip := net.ParseIP(host); ip != nil {
		ips = []net.IP{ip}
	} else {
		ips, err = net.DefaultResolver.LookupIP(ctx, "ip", host)
		if err != nil {
			return nil, nil, fmt.Errorf("resolve SDK host: %w", err)
		}
	}
	if len(ips) == 0 || len(ips) > 32 {
		return nil, nil, errors.New("SDK URL has no safe address")
	}
	for _, ip := range ips {
		if !safeIP(ip) {
			return nil, nil, errors.New("SDK URL resolves to a blocked address")
		}
	}
	return u, ips, nil
}

func safeIP(ip net.IP) bool {
	if ip == nil || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() {
		return false
	}
	return !ip.Equal(net.ParseIP("169.254.169.254")) && !ip.Equal(net.ParseIP("100.100.100.200"))
}

func pinnedDial(ips []net.IP) func(context.Context, string, string) (net.Conn, error) {
	return func(ctx context.Context, network, address string) (net.Conn, error) {
		_, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		dialer := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
		var last error
		for _, ip := range ips {
			connection, err := dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
			if err == nil {
				return connection, nil
			}
			last = err
		}
		return nil, last
	}
}

func sameOrigin(a, b *url.URL) bool {
	return strings.EqualFold(a.Scheme, b.Scheme) && strings.EqualFold(a.Host, b.Host)
}

func validHTTPMethod(method string) bool {
	if method == "" || len(method) > 16 {
		return false
	}
	for _, char := range method {
		if char < 'A' || char > 'Z' {
			return false
		}
	}
	return true
}

func objectValue(value any) map[string]any {
	result, _ := value.(map[string]any)
	return result
}

func stringArgValue(value any) string {
	text, _ := value.(string)
	return text
}

func cloneStrings(input map[string]string) map[string]string {
	result := make(map[string]string, len(input))
	for key, value := range input {
		result[key] = value
	}
	return result
}

func (h *StoreHost) storage(ctx context.Context, operation string, args []any) (any, error) {
	key, err := stringArg(args, 0, "storage key")
	if err != nil || key == "" || len(key) > 256 {
		return nil, errors.New("SDK storage key must contain 1 to 256 bytes")
	}
	switch operation {
	case "storage.get":
		var raw string
		err := h.db.QueryRowContext(ctx, `SELECT value_json FROM sdk_storage WHERE owner_id=? AND integration_instance_id=? AND storage_key=?`, h.ownerID, h.instanceID, key).Scan(&raw)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		var value any
		if err := json.Unmarshal([]byte(raw), &value); err != nil {
			return nil, fmt.Errorf("decode SDK storage value: %w", err)
		}
		return value, nil
	case "storage.set":
		if len(args) != 2 {
			return nil, errors.New("storage.set requires a key and value")
		}
		encoded, err := json.Marshal(args[1])
		if err != nil || len(encoded) > maxSDKStorageSize {
			return nil, errors.New("SDK storage value is invalid or exceeds 256 KB")
		}
		_, err = h.db.ExecContext(ctx, `INSERT INTO sdk_storage(owner_id,integration_instance_id,storage_key,value_json,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(owner_id,integration_instance_id,storage_key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`, h.ownerID, h.instanceID, key, string(encoded), time.Now().UTC().Format(time.RFC3339Nano))
		return nil, err
	case "storage.delete":
		_, err := h.db.ExecContext(ctx, `DELETE FROM sdk_storage WHERE owner_id=? AND integration_instance_id=? AND storage_key=?`, h.ownerID, h.instanceID, key)
		return nil, err
	default:
		return nil, errors.New("unsupported SDK storage operation")
	}
}

func (h *StoreHost) upsert(ctx context.Context, collection, resourceType string, args []any) (any, error) {
	if len(args) != 1 {
		return nil, errors.New("resource upsert requires one record")
	}
	data, err := normalizeSDKRecord(args[0], h.fields[collection])
	if err != nil {
		return nil, err
	}
	capabilities := stringSlice(data["capabilities"])
	for _, capability := range capabilities {
		if !sdkCapability.MatchString(capability) {
			return nil, errors.New("SDK resource contains an invalid capability")
		}
	}
	item, err := h.resources.Upsert(ctx, resources.Resource{Type: resourceType, Provider: "sdk", ProviderInstanceID: h.instanceID, ProviderResourceID: data["id"].(string), OwnerID: h.ownerID, Data: data, State: "current", Capabilities: capabilities})
	if err != nil {
		return nil, err
	}
	return item.Data, nil
}

func (h *StoreHost) update(ctx context.Context, collection, resourceType string, args []any) (any, error) {
	if len(args) != 2 {
		return nil, errors.New("resource update requires an ID and changes")
	}
	id, err := stringArg(args, 0, "resource ID")
	if err != nil {
		return nil, err
	}
	changes, ok := args[1].(map[string]any)
	if !ok {
		return nil, errors.New("resource changes must be an object")
	}
	current, err := h.find(ctx, resourceType, id)
	if errors.Is(err, resources.ErrNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	merged := make(map[string]any, len(current.Data)+len(changes))
	for key, value := range current.Data {
		merged[key] = value
	}
	for key, value := range changes {
		if key == "id" && value != id {
			return nil, errors.New("SDK resource ID cannot be changed")
		}
		merged[key] = value
	}
	return h.upsert(ctx, collection, resourceType, []any{merged})
}

func (h *StoreHost) remove(ctx context.Context, resourceType string, args []any) (any, error) {
	id, err := stringArg(args, 0, "resource ID")
	if err != nil {
		return false, err
	}
	current, err := h.find(ctx, resourceType, id)
	if errors.Is(err, resources.ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if err := h.resources.Delete(ctx, h.ownerID, current.ID); err != nil {
		if errors.Is(err, resources.ErrNotFound) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func (h *StoreHost) sync(ctx context.Context, collection, resourceType string, args []any) (any, error) {
	if len(args) != 2 {
		return nil, errors.New("resource sync requires records and options")
	}
	rows, ok := args[0].([]any)
	if !ok || len(rows) > maxSDKBatchSize {
		return nil, errors.New("resource sync requires an array of at most 1000 records")
	}
	options, _ := args[1].(map[string]any)
	completeness, _ := options["completeness"].(string)
	if completeness != "complete" && completeness != "partial" {
		return nil, errors.New("resource sync completeness must be complete or partial")
	}
	encoded, err := json.Marshal(rows)
	if err != nil || len(encoded) > 4<<20 {
		return nil, errors.New("resource sync batch exceeds 4 MB")
	}
	seen := make(map[string]bool, len(rows))
	for _, raw := range rows {
		data, err := normalizeSDKRecord(raw, h.fields[collection])
		if err != nil {
			return nil, err
		}
		id := data["id"].(string)
		if seen[id] {
			return nil, fmt.Errorf("resource sync contains duplicate ID %q", id)
		}
		seen[id] = true
		if _, err := h.upsert(ctx, collection, resourceType, []any{data}); err != nil {
			return nil, err
		}
	}
	if completeness == "complete" {
		if err := h.removeMissing(ctx, resourceType, seen); err != nil {
			return nil, err
		}
	}
	return nil, nil
}

func (h *StoreHost) removeMissing(ctx context.Context, resourceType string, seen map[string]bool) error {
	stale := make([]resources.Resource, 0)
	for offset := 0; ; offset += 200 {
		page, err := h.resources.Query(ctx, resources.Query{OwnerID: h.ownerID, Types: []string{resourceType}, Provider: "sdk", InstanceID: h.instanceID, Limit: 200, Offset: offset})
		if err != nil {
			return err
		}
		for _, item := range page.Items {
			if !seen[item.ProviderResourceID] {
				stale = append(stale, item)
			}
		}
		if len(page.Items) < page.Limit || offset+len(page.Items) >= page.Total {
			break
		}
	}
	for _, item := range stale {
		if err := h.resources.Delete(ctx, h.ownerID, item.ID); err != nil && !errors.Is(err, resources.ErrNotFound) {
			return err
		}
	}
	return nil
}

func (h *StoreHost) find(ctx context.Context, resourceType, id string) (resources.Resource, error) {
	for offset := 0; ; offset += 200 {
		page, err := h.resources.Query(ctx, resources.Query{OwnerID: h.ownerID, Types: []string{resourceType}, Provider: "sdk", InstanceID: h.instanceID, Limit: 200, Offset: offset})
		if err != nil {
			return resources.Resource{}, err
		}
		for _, item := range page.Items {
			if item.ProviderResourceID == id {
				return item, nil
			}
		}
		if len(page.Items) < page.Limit || offset+len(page.Items) >= page.Total {
			return resources.Resource{}, resources.ErrNotFound
		}
	}
}

func normalizeSDKRecord(raw any, allowedFields map[string]bool) (map[string]any, error) {
	data, ok := raw.(map[string]any)
	if !ok {
		return nil, errors.New("SDK resource must be an object")
	}
	encoded, err := json.Marshal(data)
	if err != nil || len(encoded) > maxSDKRecordBytes {
		return nil, errors.New("SDK resource is invalid or exceeds 256 KB")
	}
	var safe map[string]any
	if err := json.Unmarshal(encoded, &safe); err != nil {
		return nil, err
	}
	for key := range safe {
		if !allowedFields[key] {
			return nil, fmt.Errorf("SDK resource field %q is not declared by the collection", key)
		}
	}
	id, ok := safe["id"].(string)
	if !ok || strings.TrimSpace(id) == "" || len(id) > 200 {
		return nil, errors.New("SDK resource ID must contain 1 to 200 bytes")
	}
	if name, ok := safe["name"].(string); !ok || strings.TrimSpace(name) == "" || len(name) > 500 {
		return nil, errors.New("SDK resource name must contain 1 to 500 bytes")
	}
	return safe, nil
}

func stringArg(args []any, index int, name string) (string, error) {
	if index >= len(args) {
		return "", fmt.Errorf("%s is required", name)
	}
	value, ok := args[index].(string)
	if !ok {
		if object, objectOK := args[index].(map[string]any); objectOK {
			value, ok = object["href"].(string)
		}
	}
	if !ok || strings.TrimSpace(value) == "" || len(value) > 512 {
		return "", fmt.Errorf("%s must be a non-empty string under 512 bytes", name)
	}
	return value, nil
}

func stringSlice(value any) []string {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		if text, ok := item.(string); ok && len(text) <= 128 {
			out = append(out, text)
		}
	}
	return out
}

func sdkResourceDefinition(resourceType, integrationName, collection string, raw any) (resources.Definition, error) {
	definition := resources.Definition{Type: resourceType, Version: 1, Title: integrationName + " " + collection, Capabilities: []string{"list", "detail", "search", "actions"}}
	fields := map[string]resources.FieldDefinition{}
	add := func(name, typ string, searchable, filterable bool) {
		fields[name] = resources.FieldDefinition{Name: name, Type: typ, Searchable: searchable, Filterable: filterable}
	}
	add("id", "string", true, true)
	add("name", "string", true, true)
	add("icon", "string", false, false)
	add("type", "string", true, true)
	add("tags", "array", false, false)
	add("capabilities", "array", false, false)
	add("attributes", "object", false, false)
	add("available", "boolean", false, true)
	add("actions", "array", false, false)
	add("apps", "array", false, false)
	add("updatedAt", "datetime", false, true)
	add("upstreamId", "string", true, true)
	add("playback", "boolean", false, true)
	spec, _ := raw.(map[string]any)
	schema, _ := spec["schema"].(map[string]any)
	properties, _ := schema["properties"].(map[string]any)
	if len(properties) > 100 {
		return resources.Definition{}, errors.New("SDK resource schema has too many properties")
	}
	for name, rawField := range properties {
		if !resourcesFieldName(name) {
			return resources.Definition{}, fmt.Errorf("SDK schema field %q must be a top-level identifier", name)
		}
		field, _ := rawField.(map[string]any)
		typeName, _ := field["type"].(string)
		typ := map[string]string{"string": "string", "number": "number", "integer": "integer", "boolean": "boolean", "object": "object", "array": "array"}[typeName]
		if typ == "" {
			continue
		}
		_, exists := fields[name]
		if !exists {
			searchable := typ == "string"
			filterable := typ != "object" && typ != "array"
			add(name, typ, searchable, filterable)
		}
	}
	for _, field := range fields {
		definition.Fields = append(definition.Fields, field)
	}
	if err := definition.Validate(); err != nil {
		return resources.Definition{}, err
	}
	return definition, nil
}

func sdkRecordFields(raw any) map[string]bool {
	fields := map[string]bool{
		"id": true, "name": true, "icon": true, "type": true, "tags": true,
		"capabilities": true, "attributes": true, "available": true, "actions": true,
		"apps": true, "updatedAt": true, "upstreamId": true, "playback": true, "state": true,
	}
	spec, _ := raw.(map[string]any)
	schema, _ := spec["schema"].(map[string]any)
	properties, _ := schema["properties"].(map[string]any)
	for name := range properties {
		if resourcesFieldName(name) {
			fields[name] = true
		}
	}
	return fields
}

func resourcesFieldName(value string) bool {
	if value == "" || len(value) > 128 || !(value[0] == '_' || value[0] >= 'A' && value[0] <= 'Z' || value[0] >= 'a' && value[0] <= 'z') {
		return false
	}
	for _, c := range value[1:] {
		if !(c == '_' || c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9') {
			return false
		}
	}
	return true
}
