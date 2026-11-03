package jsruntime

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/dop251/goja"
	"github.com/gorilla/websocket"
)

// Provider websocket capability. Dialing and frame IO happen in trusted Go
// host code with the same SSRF pinning rules as HTTP fetch; provider code only
// ever sees a browser-shaped socket object whose events are dispatched back
// through the serialized instance queue.
const (
	maxSocketsPerInstance  = 4
	maxSocketMessageBytes  = 1 << 20
	socketConnectTimeout   = 10 * time.Second
	socketHandshakeTimeout = 10 * time.Second
	socketWriteTimeout     = 5 * time.Second
	maxSocketProtocols     = 8
	maxURLBytes            = 512
)

const (
	socketStateOpen    int32 = 1
	socketStateClosing int32 = 2
	socketStateClosed  int32 = 3
)

// jsSocket is one live connection handed to provider code.
type jsSocket struct {
	conn *websocket.Conn

	writeMu sync.Mutex
	state   atomic.Int32
	closing atomic.Bool

	listenersMu sync.Mutex
	listeners   map[string][]socketListener
}

type socketListener struct {
	value goja.Value
	fn    goja.Callable
	once  bool
}

// abort tears the transport down without dispatching further events. Used when
// the dispatch queue overflows and while the instance is shutting down.
func (s *jsSocket) abort(reason string) {
	if !s.closing.CompareAndSwap(false, true) {
		return
	}
	s.state.Store(socketStateClosed)
	_ = s.conn.Close()
}

func (s *jsSocket) addListener(eventType string, fn goja.Callable, value goja.Value, once bool) {
	s.listenersMu.Lock()
	defer s.listenersMu.Unlock()
	if s.listeners == nil {
		s.listeners = map[string][]socketListener{}
	}
	s.listeners[eventType] = append(s.listeners[eventType], socketListener{value: value, fn: fn, once: once})
}

func (s *jsSocket) removeListener(eventType string, fn goja.Value) {
	s.listenersMu.Lock()
	defer s.listenersMu.Unlock()
	entries := s.listeners[eventType]
	kept := entries[:0]
	for _, entry := range entries {
		if entry.value != nil && entry.value.SameAs(fn) {
			continue
		}
		kept = append(kept, entry)
	}
	if len(kept) == 0 {
		delete(s.listeners, eventType)
	} else {
		s.listeners[eventType] = kept
	}
}

func (s *jsSocket) snapshotListeners(eventType string) []socketListener {
	s.listenersMu.Lock()
	defer s.listenersMu.Unlock()
	if len(s.listeners[eventType]) == 0 {
		return nil
	}
	return append([]socketListener(nil), s.listeners[eventType]...)
}

// connectWebSocket implements the websocket.connect bridge. It runs on the VM
// goroutine and blocks (bounded) until the upgrade completes or fails; once it
// resolves, follow-up frames travel through the serialized dispatch queue, so
// listener registration always wins the race against the first server frames.
func (i *Instance) connectWebSocket(argsValue goja.Value) goja.Value {
	promise, resolve, reject := i.rt.NewPromise()
	fail := func(err error) {
		_ = reject(i.rt.NewGoError(err))
	}
	args, ok := argsValue.(*goja.Object)
	if !ok {
		fail(errors.New("websocket.connect requires an argument array"))
		return i.rt.ToValue(promise)
	}
	urlText := args.Get("0").String()
	protocols := socketProtocols(args.Get("1"))
	if len(protocols) > maxSocketProtocols {
		fail(errors.New("websocket.connect accepts at most 8 subprotocols"))
		return i.rt.ToValue(promise)
	}
	i.socketsMu.Lock()
	if len(i.sockets) >= maxSocketsPerInstance {
		i.socketsMu.Unlock()
		fail(fmt.Errorf("integration has reached the %d open websocket limit", maxSocketsPerInstance))
		return i.rt.ToValue(promise)
	}
	i.socketsMu.Unlock()
	dialCtx, cancel := context.WithTimeout(context.Background(), socketConnectTimeout)
	defer cancel()
	target, ips, err := safeURL(dialCtx, urlText, []string{"ws", "wss"})
	if err != nil {
		fail(err)
		return i.rt.ToValue(promise)
	}
	dialer := &websocket.Dialer{
		Proxy:            nil,
		HandshakeTimeout: socketHandshakeTimeout,
		NetDialContext:   pinnedDial(ips),
		TLSClientConfig:  &tls.Config{MinVersion: tls.VersionTLS12},
	}
	header := http.Header{}
	if len(protocols) > 0 {
		header.Set("Sec-WebSocket-Protocol", joinProtocols(protocols))
	}
	conn, _, err := dialer.DialContext(dialCtx, target.String(), header)
	if err != nil {
		fail(fmt.Errorf("websocket connect to %s failed: %w", target.Hostname(), err))
		return i.rt.ToValue(promise)
	}
	conn.SetReadLimit(maxSocketMessageBytes)
	i.socketsMu.Lock()
	if len(i.sockets) >= maxSocketsPerInstance {
		i.socketsMu.Unlock()
		_ = conn.Close()
		fail(fmt.Errorf("integration has reached the %d open websocket limit", maxSocketsPerInstance))
		return i.rt.ToValue(promise)
	}
	sock := &jsSocket{conn: conn}
	sock.state.Store(socketStateOpen)
	i.sockets[sock] = struct{}{}
	i.socketsMu.Unlock()
	object := i.buildSocketObject(sock)
	go i.readSocket(sock)
	_ = resolve(object)
	return i.rt.ToValue(promise)
}

func socketProtocols(raw goja.Value) []string {
	if raw == nil || goja.IsUndefined(raw) || goja.IsNull(raw) {
		return nil
	}
	exported := raw.Export()
	quoted, _ := exported.(string)
	if len(quoted) > 0 && len(quoted) <= 64 {
		return []string{quoted}
	}
	items, _ := exported.([]any)
	protocols := make([]string, 0, len(items))
	for _, item := range items {
		protocol, _ := item.(string)
		if protocol == "" || len(protocol) > 64 {
			continue
		}
		protocols = append(protocols, protocol)
	}
	return protocols
}

func joinProtocols(protocols []string) string {
	out := ""
	for n, protocol := range protocols {
		if n > 0 {
			out += ", "
		}
		out += protocol
	}
	return out
}

// buildSocketObject exposes the browser-shaped WebSocket surface to provider
// code. Events travel only through the serialized instance queue.
func (i *Instance) buildSocketObject(sock *jsSocket) *goja.Object {
	rt := i.rt
	object := rt.NewObject()
	_ = object.Set("OPEN", socketStateOpen)
	_ = object.Set("CLOSING", socketStateClosing)
	_ = object.Set("CLOSED", socketStateClosed)
	i.defineLiveProperty(object, "readyState", func() int { return int(sock.state.Load()) })
	_ = object.Set("addEventListener", func(call goja.FunctionCall) goja.Value {
		eventType := call.Argument(0).String()
		value := call.Argument(1)
		fn, ok := goja.AssertFunction(value)
		if !ok {
			panic(rt.NewTypeError("addEventListener requires an event type and callback"))
		}
		once := false
		if options, ok := call.Argument(2).Export().(map[string]any); ok {
			if flag, ok := options["once"].(bool); ok {
				once = flag
			}
		}
		sock.addListener(eventType, fn, value, once)
		return goja.Undefined()
	})
	_ = object.Set("removeEventListener", func(call goja.FunctionCall) goja.Value {
		fn := call.Argument(1)
		if _, ok := goja.AssertFunction(fn); ok {
			sock.removeListener(call.Argument(0).String(), fn)
		}
		return goja.Undefined()
	})
	_ = object.Set("send", func(call goja.FunctionCall) goja.Value {
		if sock.state.Load() != socketStateOpen {
			panic(rt.NewGoError(errors.New("websocket is not open")))
		}
		payload, ok := call.Argument(0).Export().(string)
		if !ok || len(payload) > maxSocketMessageBytes {
			panic(rt.NewTypeError("websocket.send requires a string body under 1 MB"))
		}
		sock.writeMu.Lock()
		_ = sock.conn.SetWriteDeadline(time.Now().Add(socketWriteTimeout))
		err := sock.conn.WriteMessage(websocket.TextMessage, []byte(payload))
		sock.writeMu.Unlock()
		if err != nil {
			// Let the reader observe the transport damage and announce close.
			i.log("debug", "provider websocket send failed", map[string]any{"error": err.Error()})
		}
		return goja.Undefined()
	})
	_ = object.Set("close", func(call goja.FunctionCall) goja.Value {
		if !sock.closing.CompareAndSwap(false, true) {
			return goja.Undefined()
		}
		sock.state.Store(socketStateClosing)
		sock.writeMu.Lock()
		_ = sock.conn.SetWriteDeadline(time.Now().Add(socketWriteTimeout))
		_ = sock.conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""), time.Now().Add(socketWriteTimeout))
		sock.writeMu.Unlock()
		err := sock.conn.Close()
		sock.state.Store(socketStateClosed)
		if err != nil && !errors.Is(err, websocket.ErrCloseSent) {
			i.log("debug", "provider websocket close reported an error", map[string]any{"error": err.Error()})
		}
		i.dispatchSocketEvent(sock, "close", "", 1000, "")
		i.removeSocket(sock)
		return goja.Undefined()
	})
	return object
}

// defineLiveProperty defines a numeric property whose reads call back into Go.
// The getter is installed from provider-visible JavaScript via
// Object.defineProperty so reads behave like normal property access.
func (i *Instance) defineLiveProperty(object *goja.Object, name string, read func() int) {
	fn, ok := i.definePropertyHelper()
	if !ok {
		_ = object.Set(name, read())
		return
	}
	_, err := fn(goja.Undefined(), object, i.rt.ToValue(name), i.rt.ToValue(read))
	if err != nil {
		_ = object.Set(name, read())
	}
}

func (i *Instance) definePropertyHelper() (goja.Callable, bool) {
	if i.defineProperty == nil {
		value, err := i.rt.RunString(`(function(target, name, read) {
      Object.defineProperty(target, name, { get: function() { return read(); }, configurable: true });
    })`)
		if err != nil {
			return nil, false
		}
		fn, ok := goja.AssertFunction(value)
		if !ok {
			return nil, false
		}
		i.defineProperty = fn
	}
	return i.defineProperty, true
}

// dispatchSocketEvent queues one socket event for serialized delivery.
func (i *Instance) dispatchSocketEvent(sock *jsSocket, eventType, data string, code int, reason string) {
	i.queueItem(&dispatchItem{
		kind: "socket",
		sock: sock,
		invoke: func(ctx context.Context, instance *Instance) error {
			return instance.deliverSocketEvent(ctx, sock, eventType, data, code, reason)
		},
	})
}

// deliverSocketEvent invokes every listener registered for one event type on
// the VM goroutine. Runs under i.mu with a bounded ctx from the dispatch pass.
func (i *Instance) deliverSocketEvent(ctx context.Context, sock *jsSocket, eventType, data string, code int, reason string) error {
	listeners := sock.snapshotListeners(eventType)
	if len(listeners) == 0 {
		return nil
	}
	event := i.rt.NewObject()
	_ = event.Set("type", eventType)
	switch eventType {
	case "message":
		_ = event.Set("data", data)
	case "close":
		_ = event.Set("code", code)
		_ = event.Set("reason", reason)
		_ = event.Set("wasClean", code == 1000)
	}
	for _, listener := range listeners {
		_, err := i.call(ctx, func() (goja.Value, error) {
			_, invokeErr := listener.fn(goja.Undefined(), event)
			return goja.Undefined(), invokeErr
		})
		if err != nil {
			return err
		}
		if listener.once {
			i.removeOnce(sock, eventType, listener)
		}
	}
	return nil
}

// removeOnce drops a once-listener after its single delivery.
func (i *Instance) removeOnce(sock *jsSocket, eventType string, listener socketListener) {
	sock.listenersMu.Lock()
	defer sock.listenersMu.Unlock()
	entries, exists := sock.listeners[eventType]
	if !exists {
		return
	}
	kept := entries[:0]
	dropped := false
	for _, candidate := range entries {
		if !dropped && candidate.value != nil && listener.value != nil && candidate.value.SameAs(listener.value) {
			dropped = true
			continue
		}
		kept = append(kept, candidate)
	}
	if len(kept) == 0 {
		delete(sock.listeners, eventType)
	} else {
		sock.listeners[eventType] = kept
	}
}

// readSocket pumps frames from the transport into the serialized dispatch
// queue. It terminates when the transport fails or the instance disposes.
func (i *Instance) readSocket(sock *jsSocket) {
	defer i.removeSocket(sock)
	for {
		messageType, payload, err := sock.conn.ReadMessage()
		if err != nil {
			i.onSocketReadFailure(sock, err)
			return
		}
		if i.disposed.Load() {
			return
		}
		if messageType != websocket.TextMessage && messageType != websocket.BinaryMessage {
			continue
		}
		i.dispatchSocketEvent(sock, "message", string(payload), 0, "")
	}
}

// onSocketReadFailure announces an unexpected transport close. Provider- or
// instance-initiated closes have already announced once and are skipped.
func (i *Instance) onSocketReadFailure(sock *jsSocket, err error) {
	if sock.state.Swap(socketStateClosed) == socketStateClosed {
		return
	}
	code := websocket.CloseAbnormalClosure
	reason := ""
	var closeError *websocket.CloseError
	if errors.As(err, &closeError) {
		code = closeError.Code
		reason = closeError.Text
	}
	i.dispatchSocketEvent(sock, "close", "", code, reason)
}

func (i *Instance) removeSocket(sock *jsSocket) {
	i.socketsMu.Lock()
	defer i.socketsMu.Unlock()
	delete(i.sockets, sock)
}
