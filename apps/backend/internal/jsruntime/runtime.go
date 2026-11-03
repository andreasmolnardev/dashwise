// Package jsruntime hosts trusted, pre-bundled Dashwise integration providers.
// Provider JavaScript has no ambient filesystem, process, or network globals;
// every privileged operation must pass through the injected Host bridge.
package jsruntime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/dop251/goja"
)

const (
	defaultMaxBundleBytes = 2 << 20
	defaultHookTimeout    = 10 * time.Second
)

var ErrStopped = errors.New("integration runtime is stopped")

// Host is the capability boundary between provider code and Dashwise. Call
// methods receive dot paths such as "resources.devices.upsert" or
// "storage.get". Implementations must apply instance and owner scoping.
type Host interface {
	Call(context.Context, string, string, []any) (any, error)
}

type Options struct {
	InstanceID string
	Config     map[string]any
	Host       Host
	// HostFactory receives the provider manifest before lifecycle hooks run. It
	// lets the application bind manifest-declared resources without evaluating
	// user supplied code or loading the bundle twice.
	HostFactory func(Manifest) (Host, error)
	MaxBytes    int
	HookLimit   time.Duration
}

// Manifest is the JSON-safe subset of an IntegrationDefinition that is safe
// to expose to catalog/UI code.
type Manifest struct {
	ID          string           `json:"id"`
	Name        string           `json:"name"`
	Version     string           `json:"version"`
	Description string           `json:"description,omitempty"`
	Config      map[string]any   `json:"config"`
	Resources   map[string]any   `json:"resources"`
	Apps        []map[string]any `json:"apps,omitempty"`
	Activities  []map[string]any `json:"activities,omitempty"`
	Widgets     []map[string]any `json:"widgets,omitempty"`
	Glanceables []map[string]any `json:"glanceables,omitempty"`
	Actions     map[string]any   `json:"actions,omitempty"`
}

type Instance struct {
	mu          sync.Mutex
	rt          *goja.Runtime
	definition  *goja.Object
	api         *goja.Object
	manifest    Manifest
	instanceID  string
	host        Host
	hookLimit   time.Duration
	started     bool
	stopped     bool
	disposables []goja.Callable
	activeCtx   context.Context
}

// Load evaluates a CommonJS JavaScript bundle emitted from the TypeScript
// provider package and prepares its lifecycle object. It intentionally accepts
// installed/trusted bundles only; user-authored code must not be passed here.
func Load(ctx context.Context, bundle []byte, options Options) (*Instance, error) {
	maxBytes := options.MaxBytes
	if maxBytes <= 0 {
		maxBytes = defaultMaxBundleBytes
	}
	if len(bundle) == 0 || len(bundle) > maxBytes {
		return nil, fmt.Errorf("integration bundle must be between 1 byte and %d bytes", maxBytes)
	}
	if strings.TrimSpace(options.InstanceID) == "" {
		return nil, errors.New("integration instance id is required")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	limit := options.HookLimit
	if limit <= 0 {
		limit = defaultHookTimeout
	}
	rt := goja.New()
	module := rt.NewObject()
	exports := rt.NewObject()
	_ = module.Set("exports", exports)
	_ = rt.Set("module", module)
	_ = rt.Set("exports", exports)
	// These helpers are the runtime-level equivalents of the SDK's pure
	// defineIntegration/resourceCollection identity functions.
	identity := func(call goja.FunctionCall) goja.Value { return call.Argument(0) }
	_ = rt.Set("defineIntegration", identity)
	_ = rt.Set("resourceCollection", identity)
	_ = rt.Set("defineAction", identity)
	_ = rt.Set("require", func(call goja.FunctionCall) goja.Value {
		if call.Argument(0).String() != "@dashwise/integrations-sdk" {
			panic(rt.NewTypeError("integration bundles cannot import host modules"))
		}
		api := rt.NewObject()
		_ = api.Set("defineIntegration", identity)
		_ = api.Set("resourceCollection", identity)
		_ = api.Set("defineAction", identity)
		return api
	})
	// Browser/network primitives are not ambient. This small abort signal shape
	// carries timeout intent to the Host bridge without exposing sockets.
	if _, err := rt.RunString(`this.AbortSignal = { timeout: function(milliseconds) { return { timeoutMs: milliseconds }; } };`); err != nil {
		return nil, err
	}
	if _, err := rt.RunString(string(bundle)); err != nil {
		return nil, fmt.Errorf("evaluate integration bundle: %w", err)
	}
	exported := module.Get("exports")
	if object, ok := exported.(*goja.Object); ok && object.Get("default") != nil && !goja.IsUndefined(object.Get("default")) {
		exported = object.Get("default")
	}
	definition, ok := exported.(*goja.Object)
	if !ok {
		return nil, errors.New("integration bundle must export an integration definition object")
	}
	manifest, err := readManifest(rt, definition)
	if err != nil {
		return nil, err
	}
	host := options.Host
	if options.HostFactory != nil {
		host, err = options.HostFactory(manifest)
		if err != nil {
			return nil, fmt.Errorf("initialize integration host: %w", err)
		}
	}
	instance := &Instance{rt: rt, definition: definition, manifest: manifest, instanceID: options.InstanceID, host: host, hookLimit: limit}
	api, err := instance.makeAPI(options.Config)
	if err != nil {
		return nil, err
	}
	instance.api = api
	return instance, nil
}

func (i *Instance) Manifest() Manifest { return i.manifest }

// Start invokes setup and start serially. Calls to host bridge methods run on
// the VM's owning goroutine and return resolved Promises, which preserves the
// SDK's async/await call shape for synchronous host operations.
func (i *Instance) Start(ctx context.Context) error {
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.stopped {
		return ErrStopped
	}
	if i.started {
		return nil
	}
	if err := i.callHook(ctx, "setup"); err != nil {
		return fmt.Errorf("integration setup: %w", err)
	}
	if err := i.callHook(ctx, "start"); err != nil {
		_ = i.callHook(ctx, "stop")
		return fmt.Errorf("integration start: %w", err)
	}
	i.started = true
	return nil
}

// Invoke calls an exported provider function by name, mainly for action and
// playback adapters. The caller supplies already-validated JSON-safe values.
func (i *Instance) Invoke(ctx context.Context, name string, args ...any) (any, error) {
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.stopped {
		return nil, ErrStopped
	}
	if !validIdentifier(name) {
		return nil, errors.New("invalid integration export name")
	}
	value := i.definition.Get(name)
	fn, ok := goja.AssertFunction(value)
	if !ok {
		return nil, fmt.Errorf("integration export %q is not a function", name)
	}
	converted := make([]goja.Value, 0, len(args)+1)
	converted = append(converted, i.api)
	for _, arg := range args {
		converted = append(converted, i.rt.ToValue(arg))
	}
	value, err := i.call(ctx, func() (goja.Value, error) { return fn(i.definition, converted...) })
	if err != nil {
		return nil, err
	}
	return awaitValue(value)
}

// ExecuteAction runs the SDK action whose declared id matches actionID.
func (i *Instance) ExecuteAction(ctx context.Context, actionID string, resource, input any) (any, error) {
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.stopped {
		return nil, ErrStopped
	}
	actions, ok := i.definition.Get("actions").(*goja.Object)
	if !ok {
		return nil, fmt.Errorf("integration action %q is not declared", actionID)
	}
	var execute goja.Callable
	var actionObject *goja.Object
	for _, key := range actions.Keys() {
		candidate, ok := actions.Get(key).(*goja.Object)
		if ok && candidate.Get("id").String() == actionID {
			if fn, ok := goja.AssertFunction(candidate.Get("execute")); ok {
				execute, actionObject = fn, candidate
				break
			}
		}
	}
	if execute == nil {
		return nil, fmt.Errorf("integration action %q is not executable", actionID)
	}
	value, err := i.call(ctx, func() (goja.Value, error) {
		return execute(actionObject, i.api, i.rt.ToValue(resource), i.rt.ToValue(input))
	})
	if err != nil {
		return nil, err
	}
	return awaitValue(value)
}

// ResolvePlayback invokes the provider's optional server-side playback resolver.
func (i *Instance) ResolvePlayback(ctx context.Context, resource, identity any) (any, error) {
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.stopped {
		return nil, ErrStopped
	}
	playback, ok := i.definition.Get("playback").(*goja.Object)
	if !ok {
		return nil, errors.New("integration does not declare playback")
	}
	resolve, ok := goja.AssertFunction(playback.Get("resolve"))
	if !ok {
		return nil, errors.New("integration playback resolver is invalid")
	}
	value, err := i.call(ctx, func() (goja.Value, error) {
		return resolve(playback, i.api, i.rt.ToValue(resource), i.rt.ToValue(identity))
	})
	if err != nil {
		return nil, err
	}
	return awaitValue(value)
}

// DispatchPlaybackEvent invokes an optional listener for an active player.
func (i *Instance) DispatchPlaybackEvent(ctx context.Context, eventType string, playbackContext, event any) error {
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.stopped {
		return ErrStopped
	}
	playback, ok := i.definition.Get("playback").(*goja.Object)
	if !ok {
		return nil
	}
	listeners, ok := playback.Get("listeners").(*goja.Object)
	if !ok {
		return nil
	}
	listener, ok := goja.AssertFunction(listeners.Get(eventType))
	if !ok {
		return nil
	}
	value, err := i.call(ctx, func() (goja.Value, error) {
		return listener(playback, i.api, i.rt.ToValue(playbackContext), i.rt.ToValue(event))
	})
	if err != nil {
		return err
	}
	_, err = awaitValue(value)
	return err
}

// Stop is idempotent and invokes provider cleanup before dropping the VM.
func (i *Instance) Stop(ctx context.Context) error {
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.stopped {
		return nil
	}
	var first error
	if i.started {
		if err := i.callHook(ctx, "stop"); err != nil {
			first = err
		}
	}
	for n := len(i.disposables) - 1; n >= 0; n-- {
		if _, err := i.call(ctx, func() (goja.Value, error) { return i.disposables[n](goja.Undefined()) }); err != nil && first == nil {
			first = err
		}
	}
	if i.started {
		if err := i.callHook(ctx, "dispose"); err != nil && first == nil {
			first = err
		}
	}
	i.started = false
	i.stopped = true
	i.rt = nil
	i.definition = nil
	i.api = nil
	return first
}

func (i *Instance) callHook(ctx context.Context, name string) error {
	value := i.definition.Get(name)
	if value == nil || goja.IsUndefined(value) || goja.IsNull(value) {
		return nil
	}
	fn, ok := goja.AssertFunction(value)
	if !ok {
		return fmt.Errorf("integration hook %q is not a function", name)
	}
	result, err := i.call(ctx, func() (goja.Value, error) { return fn(i.definition, i.api) })
	if err != nil {
		return err
	}
	_, err = awaitValue(result)
	return err
}

func (i *Instance) call(ctx context.Context, fn func() (goja.Value, error)) (goja.Value, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	boundedCtx, cancel := context.WithTimeout(ctx, i.hookLimit)
	defer cancel()
	i.activeCtx = boundedCtx
	contextDone := make(chan struct{})
	stopInterrupt := context.AfterFunc(boundedCtx, func() {
		i.rt.Interrupt(boundedCtx.Err())
		close(contextDone)
	})
	defer func() {
		if !stopInterrupt() {
			<-contextDone
		}
		i.rt.ClearInterrupt()
		i.activeCtx = nil
	}()
	value, err := fn()
	if err != nil {
		var interrupted *goja.InterruptedError
		if errors.As(err, &interrupted) {
			if boundedCtx.Err() != nil {
				return nil, boundedCtx.Err()
			}
			return nil, errors.New("integration execution timed out")
		}
		return nil, err
	}
	return value, nil
}

func (i *Instance) makeAPI(config map[string]any) (*goja.Object, error) {
	api := i.rt.NewObject()
	_ = api.Set("instanceId", i.instanceID)
	_ = api.Set("config", i.rt.ToValue(config))
	secrets := i.rt.NewObject()
	_ = secrets.Set("get", i.bridge("secrets.get"))
	_ = api.Set("secrets", secrets)
	for _, namespace := range []string{"resources", "storage", "actions", "activities", "events", "http", "websocket", "mcp", "scheduler", "logger"} {
		object := i.rt.NewObject()
		_ = api.Set(namespace, object)
	}
	// Resource collection names are provider-defined. A Proxy turns every
	// collection/method lookup into an explicit bridged operation.
	resourceProxy, err := i.rt.RunString(`new Proxy({}, {get: function(_, collection) {
    if (typeof collection !== "string") return undefined;
    return new Proxy({}, {get: function(_, method) {
      if (typeof method !== "string") return undefined;
			return function() {
        var args = Array.prototype.slice.call(arguments);
        if (method === "get") return __dashwiseSync("resources." + collection + "." + method, args);
        return __dashwiseCall("resources." + collection + "." + method, args);
      };
    }});
  }})`)
	if err != nil {
		return nil, err
	}
	_ = api.Set("resources", resourceProxy)
	for _, ns := range []string{"storage", "actions", "activities", "events", "http", "websocket", "mcp", "scheduler", "logger"} {
		proxy, err := i.rt.RunString(`(function(ns) { return new Proxy({}, {get: function(_, method) {
      if (method === "then") return undefined;
      if (typeof method !== "string") return undefined;
      return function() {
        var promise = __dashwiseCall(ns + "." + method, Array.prototype.slice.call(arguments));
        if (ns !== "http" || method !== "fetch") return promise;
        return promise.then(function(response) {
          response = response || {};
          var headers = response.headers || {};
          var body = response.body;
          function header(name) {
            if (!headers) return null;
            var target = String(name).toLowerCase();
            for (var key in headers) if (String(key).toLowerCase() === target) return String(headers[key]);
            return null;
          }
          return {
            status: response.status || 200,
            statusText: response.statusText || "",
            ok: (response.status || 200) >= 200 && (response.status || 200) < 300,
            headers: { get: header },
            json: function() { return Promise.resolve(typeof body === "string" ? JSON.parse(body) : body); },
            text: function() { return Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)); },
            arrayBuffer: function() { return Promise.resolve(body); },
            body: null
          };
        });
      };
    }}); })`)
		if err != nil {
			return nil, err
		}
		fn, ok := goja.AssertFunction(proxy)
		if !ok {
			return nil, errors.New("could not initialize integration API facade")
		}
		value, err := fn(goja.Undefined(), i.rt.ToValue(ns))
		if err != nil {
			return nil, err
		}
		_ = api.Set(ns, value)
	}
	_ = api.Set("config", i.rt.ToValue(config))
	_ = api.Set("onDispose", func(call goja.FunctionCall) goja.Value {
		fn, ok := goja.AssertFunction(call.Argument(0))
		if !ok {
			panic(i.rt.NewTypeError("onDispose requires a function"))
		}
		i.disposables = append(i.disposables, fn)
		return goja.Undefined()
	})
	_ = i.rt.Set("__dashwiseCall", func(call goja.FunctionCall) goja.Value {
		operation := call.Argument(0).String()
		args, err := exportArray(call.Argument(1))
		if err != nil {
			panic(i.rt.NewGoError(err))
		}
		return i.callBridge(operation, args)
	})
	_ = i.rt.Set("__dashwiseSync", func(call goja.FunctionCall) goja.Value {
		operation := call.Argument(0).String()
		args, err := exportArray(call.Argument(1))
		if err != nil {
			panic(i.rt.NewGoError(err))
		}
		if i.host == nil {
			panic(i.rt.NewGoError(errors.New("integration host bridge is unavailable")))
		}
		ctx := i.activeCtx
		if ctx == nil {
			ctx = context.Background()
		}
		result, err := i.host.Call(ctx, i.instanceID, operation, args)
		if err != nil {
			panic(i.rt.NewGoError(err))
		}
		return i.rt.ToValue(result)
	})
	return api, nil
}

func (i *Instance) bridge(operation string) func(goja.FunctionCall) goja.Value {
	return func(call goja.FunctionCall) goja.Value {
		args := make([]any, 0, len(call.Arguments))
		for _, arg := range call.Arguments {
			args = append(args, arg.Export())
		}
		return i.callBridge(operation, args)
	}
}

func (i *Instance) callBridge(operation string, args []any) goja.Value {
	promise, resolve, reject := i.rt.NewPromise()
	if i.host == nil {
		_ = reject(i.rt.NewGoError(errors.New("integration host bridge is unavailable")))
		return i.rt.ToValue(promise)
	}
	ctx := i.activeCtx
	if ctx == nil {
		ctx = context.Background()
	}
	result, err := i.host.Call(ctx, i.instanceID, operation, args)
	if err != nil {
		_ = reject(i.rt.NewGoError(err))
		return i.rt.ToValue(promise)
	}
	_ = resolve(i.rt.ToValue(result))
	return i.rt.ToValue(promise)
}

func readManifest(rt *goja.Runtime, definition *goja.Object) (Manifest, error) {
	var out Manifest
	jsonObject := rt.Get("JSON").ToObject(rt)
	stringify, ok := goja.AssertFunction(jsonObject.Get("stringify"))
	if !ok {
		return out, errors.New("JavaScript JSON serializer is unavailable")
	}
	replacer := rt.ToValue(func(call goja.FunctionCall) goja.Value {
		if _, ok := goja.AssertFunction(call.Argument(1)); ok {
			return goja.Undefined()
		}
		return call.Argument(1)
	})
	serialized, err := stringify(jsonObject, definition, replacer)
	if err != nil {
		return out, fmt.Errorf("serialize integration definition: %w", err)
	}
	if err := json.Unmarshal([]byte(serialized.String()), &out); err != nil {
		return out, fmt.Errorf("decode integration definition: %w", err)
	}
	if !validIdentifier(out.ID) || strings.TrimSpace(out.Name) == "" || strings.TrimSpace(out.Version) == "" {
		return out, errors.New("integration definition requires a valid id, name, and version")
	}
	if out.Resources == nil {
		return out, errors.New("integration definition must declare resources")
	}
	return out, nil
}

func awaitValue(value goja.Value) (any, error) {
	if value == nil {
		return nil, nil
	}
	if object, ok := value.(*goja.Object); ok {
		if promise, ok := object.Export().(*goja.Promise); ok {
			switch promise.State() {
			case goja.PromiseStateFulfilled:
				return promise.Result().Export(), nil
			case goja.PromiseStateRejected:
				return nil, fmt.Errorf("provider promise rejected: %v", promise.Result().Export())
			default:
				return nil, errors.New("provider returned a pending Promise; host operations must settle synchronously")
			}
		}
	}
	return value.Export(), nil
}

func exportArray(value goja.Value) ([]any, error) {
	if goja.IsUndefined(value) || goja.IsNull(value) {
		return nil, nil
	}
	if out, ok := value.Export().([]any); ok {
		return out, nil
	}
	return nil, fmt.Errorf("integration bridge expected an argument array (got %T)", value.Export())
}

func validIdentifier(value string) bool {
	if value == "" || len(value) > 120 {
		return false
	}
	for n, c := range value {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || n > 0 && (c == '.' || c == '_' || c == '-')) {
			return false
		}
	}
	return true
}
