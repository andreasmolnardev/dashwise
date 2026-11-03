package jsruntime

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/dop251/goja"
)

// runtime_bridge.go installs the provider-visible globals (console, timers)
// and routes the bridge operations that are owned by the runtime instead of
// the payload host: websocket.connect, logger.*, and scheduler.timeout/cancel.
// These operations all require event dispatch back into the VM-owning
// goroutine, which the host bridge alone cannot perform.

// installGlobals defines setTimeout/clearTimeout and a minimal console on the
// runtime. Both run through the serialized dispatch queue; provider code has
// no other way to schedule work.
func (i *Instance) installGlobals() {
	rt := i.rt
	_ = rt.Set("setTimeout", func(call goja.FunctionCall) goja.Value {
		fn, ok := goja.AssertFunction(call.Argument(0))
		if !ok {
			panic(rt.NewTypeError("setTimeout requires a callback function"))
		}
		delay, err := timerDelayMs(call.Argument(1))
		if err != nil {
			panic(rt.NewTypeError(err.Error()))
		}
		item, err := i.registerTimer(time.Duration(delay)*time.Millisecond, func(ctx context.Context, instance *Instance) error {
			_, err := instance.call(ctx, func() (goja.Value, error) { return fn(goja.Undefined()) })
			return err
		}, i.leaseTimeoutID())
		if err != nil {
			panic(rt.NewGoError(err))
		}
		i.queueItem(item)
		return rt.ToValue(item.token)
	})
	_ = rt.Set("clearTimeout", func(call goja.FunctionCall) goja.Value {
		id, err := timerToken(call.Argument(0))
		if err != nil {
			return goja.Undefined()
		}
		i.removeCallbackTimer(id)
		return goja.Undefined()
	})
	crypto := rt.NewObject()
	_ = crypto.Set("randomUUID", func(goja.FunctionCall) goja.Value {
		var raw [16]byte
		if _, err := rand.Read(raw[:]); err != nil {
			panic(rt.NewGoError(err))
		}
		raw[6] = raw[6]&0x0f | 0x40
		raw[8] = raw[8]&0x3f | 0x80
		hexValue := hex.EncodeToString(raw[:])
		return rt.ToValue(hexValue[:8] + "-" + hexValue[8:12] + "-" + hexValue[12:16] + "-" + hexValue[16:20] + "-" + hexValue[20:])
	})
	_ = rt.Set("crypto", crypto)
	console := rt.NewObject()
	levels := map[string]string{"log": "info", "debug": "debug", "info": "info", "warn": "warn", "error": "error"}
	for name, level := range levels {
		_ = console.Set(name, func(call goja.FunctionCall) goja.Value {
			message, fields := i.consolePayload(call)
			i.log(level, message, fields)
			return goja.Undefined()
		})
	}
	_ = rt.Set("console", console)
}

// leaseTimeoutID allocates the next setTimeout token under the queue lock.
func (i *Instance) leaseTimeoutID() uint64 {
	i.itemsMu.Lock()
	defer i.itemsMu.Unlock()
	i.nextTimerID++
	return i.nextTimerID
}

func (i *Instance) registerTimer(delay time.Duration, invoke func(context.Context, *Instance) error, token uint64) (*dispatchItem, error) {
	i.itemsMu.Lock()
	defer i.itemsMu.Unlock()
	if len(i.callbackTimers)+len(i.schedulerTimers) >= maxTimersPerInstance {
		return nil, errors.New("instance has too many pending timers")
	}
	item := &dispatchItem{due: time.Now().Add(delay), kind: "timer", token: token, invoke: invoke}
	i.callbackTimers[token] = item
	return item, nil
}

// runtimeCall routes bridge operations owned by the runtime. A handled result
// is a Promise value resolved (or rejected) synchronously with runtime state.
func (i *Instance) runtimeCall(operation string, args goja.Value) (goja.Value, bool) {
	switch {
	case operation == "websocket.connect":
		return i.connectWebSocket(args), true
	case strings.HasPrefix(operation, "logger."):
		return i.logBridge(operation, args), true
	case operation == "scheduler.timeout":
		return i.scheduleTimeout(args), true
	case operation == "scheduler.cancel":
		return i.cancelScheduled(args), true
	}
	return nil, false
}

// scheduleTimeout implements integrations.scheduler.timeout(name, delayMs,
// task). Re-registering the same name cancels the previous pending task, which
// mirrors the TypeScript runtime contract.
func (i *Instance) scheduleTimeout(args goja.Value) goja.Value {
	rt := i.rt
	promise, resolve, reject := rt.NewPromise()
	invalid := func(err error) {
		_ = reject(rt.NewGoError(err))
	}
	argsObject, ok := args.(*goja.Object)
	if !ok {
		invalid(errors.New("scheduler.timeout requires (name, delayMs, task)"))
		return rt.ToValue(promise)
	}
	name := strings.TrimSpace(argsObject.Get("0").String())
	if name == "" || len(name) > 256 {
		invalid(errors.New("scheduler timeout name must contain 1 to 256 bytes"))
		return rt.ToValue(promise)
	}
	delay, err := timerDelayMs(argsObject.Get("1"))
	if err != nil {
		invalid(err)
		return rt.ToValue(promise)
	}
	task, ok := goja.AssertFunction(argsObject.Get("2"))
	if !ok {
		invalid(errors.New("scheduler timeout requires a task callback"))
		return rt.ToValue(promise)
	}
	i.itemsMu.Lock()
	if len(i.callbackTimers)+len(i.schedulerTimers) >= maxTimersPerInstance {
		i.itemsMu.Unlock()
		invalid(errors.New("instance has too many pending timers"))
		return rt.ToValue(promise)
	}
	if pending := i.schedulerTimers[name]; pending != nil {
		i.dropItemLocked(pending)
		delete(i.schedulerTimers, name)
	}
	item := &dispatchItem{
		due:  time.Now().Add(time.Duration(delay) * time.Millisecond),
		kind: "scheduler",
		invoke: func(ctx context.Context, instance *Instance) error {
			// The signal object mirrors the SDK AbortSignal shape; the timer
			// is canceled wholesale once the instance stops.
			signal := instance.rt.NewObject()
			_ = signal.Set("aborted", instance.stopped)
			_, err := instance.call(ctx, func() (goja.Value, error) { return task(signal) })
			return err
		},
	}
	i.schedulerTimers[name] = item
	i.itemsMu.Unlock()
	i.queueItem(item)
	_ = resolve(goja.Undefined())
	return rt.ToValue(promise)
}

// cancelScheduled implements integrations.scheduler.cancel(name).
func (i *Instance) cancelScheduled(args goja.Value) goja.Value {
	rt := i.rt
	promise, resolve, _ := rt.NewPromise()
	if argsObject, ok := args.(*goja.Object); ok {
		i.removeScheduledTimer(strings.TrimSpace(argsObject.Get("0").String()))
	}
	_ = resolve(goja.Undefined())
	return rt.ToValue(promise)
}

// logBridge implements integrations.logger.debug/info/warn/error(message,
// metadata).
func (i *Instance) logBridge(operation string, args goja.Value) goja.Value {
	promise, resolve, _ := i.rt.NewPromise()
	level := strings.TrimPrefix(operation, "logger.")
	switch level {
	case "debug", "info", "warn", "error":
	default:
		i.log("warn", "integration requested an unknown logger level", map[string]any{"level": level})
	}
	message, fields := i.logPayload(args)
	i.log(level, message, fields)
	_ = resolve(goja.Undefined())
	return i.rt.ToValue(promise)
}

// logPayload extracts (message, metadata) from a bridge argument array and
// applies a shallow secret redaction pass to the metadata object.
func (i *Instance) logPayload(args goja.Value) (string, map[string]any) {
	argsObject, ok := args.(*goja.Object)
	if !ok {
		return "", nil
	}
	message := argsObject.Get("0").String()
	fields := objectValue(argsObject.Get("1").Export())
	safe := make(map[string]any, len(fields))
	for key, value := range fields {
		if sensitiveLogKey(key) {
			continue
		}
		safe[key] = value
	}
	return message, safe
}

func (i *Instance) consolePayload(call goja.FunctionCall) (string, map[string]any) {
	message := call.Argument(0).String()
	fields := objectValue(call.Argument(1).Export())
	return message, fields
}

func sensitiveLogKey(key string) bool {
	key = strings.ToLower(key)
	return strings.Contains(key, "password") || strings.Contains(key, "secret") ||
		strings.Contains(key, "token") || strings.Contains(key, "authorization") ||
		strings.Contains(key, "credential") || strings.Contains(key, "apikey")
}

// timerDelayMs validates a numeric timer delay coming from provider code.
func timerDelayMs(value goja.Value) (int64, error) {
	invalid := errors.New("timer delay must be a finite number between 0 and 2147483647ms")
	switch raw := value.Export().(type) {
	case nil:
		return 0, nil
	case int64:
		if raw < 0 || raw > maxTimerDelayMs {
			return 0, invalid
		}
		return raw, nil
	case int:
		if raw < 0 || raw > maxTimerDelayMs {
			return 0, invalid
		}
		return int64(raw), nil
	case float64:
		if raw != raw || raw < 0 || raw > maxTimerDelayMs {
			return 0, invalid
		}
		return int64(raw), nil
	case string:
		if raw == "" {
			return 0, nil
		}
		parsed, err := strconv.ParseFloat(raw, 64)
		if err != nil || parsed != parsed || parsed < 0 || parsed > maxTimerDelayMs {
			return 0, invalid
		}
		return int64(parsed), nil
	default:
		return 0, invalid
	}
}

// timerToken parses a clearTimeout token, returning 0 for ignored arguments.
func timerToken(value goja.Value) (uint64, error) {
	switch raw := value.Export().(type) {
	case int64:
		if raw <= 0 {
			return 0, errors.New("invalid timer token")
		}
		return uint64(raw), nil
	case int:
		if raw <= 0 {
			return 0, errors.New("invalid timer token")
		}
		return uint64(raw), nil
	case float64:
		if raw <= 0 || raw != float64(int64(raw)) {
			return 0, errors.New("invalid timer token")
		}
		return uint64(raw), nil
	default:
		return 0, errors.New("invalid timer token")
	}
}

// StoppingHost receives end-of-lifecycle cleanup after provider hooks settle.
type StoppingHost interface {
	Stop(context.Context) error
}
