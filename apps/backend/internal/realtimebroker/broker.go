// Package realtimebroker tracks authenticated activity websocket connections
// per owner and session and correlates routed shortcut executions between the
// integrations API and those websocket clients. It is the Go counterpart of
// the TypeScript activity.ts session bridge (registerSessionConnection,
// sendToSession, requestShortcutExecution, and shortcut:result handling).
package realtimebroker

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"strings"
	"sync"
	"time"
)

const (
	// shortcutResultTimeout mirrors the TypeScript SHORTCUT_RESULT_TIMEOUT_MS.
	shortcutResultTimeout = 10 * time.Second
	// maxErrorLength caps client-provided result errors, matching the
	// TypeScript error.trim().slice(0, 500) in handleActivityMessage.
	maxErrorLength = 500
	// maxShortcutIDLength mirrors the parseRoutedShortcutAction cap.
	maxShortcutIDLength = 512
	// maxOwnerSessions bounds the tracked sessions for a single owner.
	maxOwnerSessions = 64
	// maxSessionConnections bounds the number of browser tabs (duplex
	// activity websockets) counted per owner and session.
	maxSessionConnections = 4
	// maxPendingRequests bounds the correlated shortcut requests in flight.
	maxPendingRequests = 256
)

// shortcutResultMessages reuse the exact TypeScript user-facing failure texts.
const (
	msgTimedOut     = "Timed out waiting for the target session to execute the shortcut"
	msgOffline      = "Target session is offline"
	msgDisconnected = "Target session disconnected before the shortcut completed"
	msgCanceled     = "Shortcut execution was canceled"
	msgClientFailed = "The client failed to execute the shortcut"
)

// Connection is one registered websocket's send hook. Send must not be called
// concurrently by other writers than those the owning connection permits; the
// realtime API serializes websocket writes behind its single-writer mutex.
type Connection struct {
	Send func(map[string]any) error
}

// Result is the outcome of one routed shortcut execution request.
type Result struct {
	RequestID string
	Success   bool
	Error     string
}

// pendingRequest is a correlated shortcut execution waiting for a client
// result. The buffered done channel acts as a one-shot result slot: the first
// completer under the broker mutex wins and later completers read the winner.
type pendingRequest struct {
	owner     string
	sessionID string
	done      chan Result
}

// Broker owns the owner-scoped session connection registry and the correlated
// shortcut request table.
type Broker struct {
	mu      sync.Mutex
	owners  map[string]map[string]map[*Connection]struct{}
	pending map[string]*pendingRequest
}

// New creates an empty broker.
func New() *Broker {
	return &Broker{
		owners:  map[string]map[string]map[*Connection]struct{}{},
		pending: map[string]*pendingRequest{},
	}
}

// Register records conn under owner and sessionID. The returned unregister
// function is safe to call multiple times and from defers. Registration fails
// once the caller's session or connection caps are exhausted.
func (b *Broker) Register(owner, sessionID string, conn *Connection) (unregister func(), ok bool) {
	if b == nil || owner == "" || sessionID == "" || conn == nil || conn.Send == nil {
		return func() {}, false
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	owners := b.owners
	sessions, exists := owners[owner]
	if !exists {
		owners[owner] = map[string]map[*Connection]struct{}{}
		sessions = owners[owner]
	}
	conns, exists := sessions[sessionID]
	if !exists {
		if len(sessions) >= maxOwnerSessions {
			removeOwnerIfEmptyLocked(owners, owner)
			return func() {}, false
		}
		conns = map[*Connection]struct{}{}
		sessions[sessionID] = conns
	}
	if len(conns) >= maxSessionConnections {
		removeSessionIfEmptyLocked(owners, owner, sessionID)
		return func() {}, false
	}
	conns[conn] = struct{}{}
	return func() { b.Unregister(owner, sessionID, conn) }, true
}

// Unregister removes conn from owner and sessionID. When it was the last
// connection for the session, pending shortcut requests waiting on that
// session fail as disconnected, matching unregisterSessionConnection.
func (b *Broker) Unregister(owner, sessionID string, conn *Connection) {
	if b == nil || conn == nil || owner == "" || sessionID == "" {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	sessions, exists := b.owners[owner]
	if !exists {
		return
	}
	conns, exists := sessions[sessionID]
	if !exists {
		return
	}
	delete(conns, conn)
	if len(conns) > 0 {
		return
	}
	removeSessionIfEmptyLocked(b.owners, owner, sessionID)
	for requestID, request := range b.pending {
		if request.owner == owner && request.sessionID == sessionID {
			b.completeLocked(request, requestID, Result{RequestID: requestID, Error: msgDisconnected})
		}
	}
}

// IsSessionConnected reports whether at least one websocket connection is
// registered for the owner and session.
func (b *Broker) IsSessionConnected(owner, sessionID string) bool {
	if b == nil || owner == "" || sessionID == "" {
		return false
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.owners[owner][sessionID]) > 0
}

// Send delivers message to every connection registered under owner and
// sessionID. Failed sends unregister their connection. It reports whether any
// delivery succeeded, matching sendToSession.
func (b *Broker) Send(owner, sessionID string, message map[string]any) bool {
	if b == nil || owner == "" || sessionID == "" {
		return false
	}
	b.mu.Lock()
	conns := make([]*Connection, 0, len(b.owners[owner][sessionID]))
	for conn := range b.owners[owner][sessionID] {
		conns = append(conns, conn)
	}
	b.mu.Unlock()
	sent := false
	for _, conn := range conns {
		if err := conn.Send(message); err != nil {
			b.Unregister(owner, sessionID, conn)
			continue
		}
		sent = true
	}
	return sent
}

// RequestExecution sends a shortcut:execute message to the target session and
// waits for the correlated shortcut:result, a timeout, or cancellation. The
// requestId is unique per call so duplicate results and stray messages from
// other owners or sessions can never complete someone else's request.
func (b *Broker) RequestExecution(ctx context.Context, owner, sessionID, shortcutID string) Result {
	requestID := newRequestID()
	failed := func(message string) Result {
		return Result{RequestID: requestID, Error: message}
	}
	if err := ctx.Err(); err != nil {
		return failed(msgCanceled)
	}
	if owner == "" || sessionID == "" || requestID == "" {
		return failed("could not start shortcut execution")
	}
	if shortcutID = limitText(strings.TrimSpace(shortcutID), maxShortcutIDLength); shortcutID == "" {
		return failed("Invalid shortcut action")
	}
	request := &pendingRequest{owner: owner, sessionID: sessionID, done: make(chan Result, 1)}
	b.mu.Lock()
	full := len(b.pending) >= maxPendingRequests
	if !full {
		b.pending[requestID] = request
	}
	b.mu.Unlock()
	if full {
		return failed("Too many concurrent shortcut executions")
	}
	if !b.Send(owner, sessionID, map[string]any{
		"type":       "shortcut:execute",
		"requestId":  requestID,
		"shortcutId": shortcutID,
	}) {
		// Concurrent unregister may already have reported a disconnect; the
		// once-shot result slot keeps whichever outcome happened first.
		return complete(b, request, requestID, Result{RequestID: requestID, Error: msgOffline})
	}
	timer := time.NewTimer(shortcutResultTimeout)
	defer timer.Stop()
	select {
	case final := <-request.done:
		return final
	case <-timer.C:
		return complete(b, request, requestID, Result{RequestID: requestID, Error: msgTimedOut})
	case <-ctx.Done():
		return complete(b, request, requestID, Result{RequestID: requestID, Error: msgCanceled})
	}
}

// HandleResult resolves a pending shortcut request from a websocket client,
// mirroring handleActivityMessage. It only completes the request when the
// message matches the requesting owner and session and the sending connection
// is still registered for that session; duplicates return false.
func (b *Broker) HandleResult(owner, sessionID string, conn *Connection, requestID string, success bool, errorText string) bool {
	if b == nil || owner == "" || sessionID == "" || conn == nil {
		return false
	}
	requestID = strings.TrimSpace(requestID)
	if requestID == "" {
		return false
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	request, exists := b.pending[requestID]
	if !exists || request.owner != owner || request.sessionID != sessionID {
		return false
	}
	conns, registered := b.owners[owner][sessionID]
	if !registered || !hasConnection(conns, conn) {
		return false
	}
	result := Result{RequestID: requestID}
	if success {
		result.Success = true
	} else {
		result.Error = limitText(strings.TrimSpace(errorText), maxErrorLength)
		if result.Error == "" {
			result.Error = msgClientFailed
		}
	}
	return b.completeLocked(request, requestID, result) == result
}

// complete is the unlocked wrapper around completeLocked used by the
// RequestExecution waiter goroutine.
func complete(b *Broker, request *pendingRequest, requestID string, result Result) Result {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.completeLocked(request, requestID, result)
}

// completeLocked resolves a pending request at most once. When another
// completer already stored a result, the stored winner is drained and
// returned so every caller observes the same outcome.
func (b *Broker) completeLocked(request *pendingRequest, requestID string, result Result) Result {
	select {
	case request.done <- result:
		delete(b.pending, requestID)
		return result
	default:
	}
	select {
	case winner := <-request.done:
		return winner
	default:
	}
	return result
}

func hasConnection(conns map[*Connection]struct{}, conn *Connection) bool {
	_, found := conns[conn]
	return found
}

func removeSessionIfEmptyLocked(owners map[string]map[string]map[*Connection]struct{}, owner, sessionID string) {
	sessions, exists := owners[owner]
	if !exists {
		return
	}
	if conns, exists := sessions[sessionID]; exists && len(conns) == 0 {
		delete(sessions, sessionID)
	}
	removeOwnerIfEmptyLocked(owners, owner)
}

func removeOwnerIfEmptyLocked(owners map[string]map[string]map[*Connection]struct{}, owner string) {
	if sessions, exists := owners[owner]; exists && len(sessions) == 0 {
		delete(owners, owner)
	}
}

// newRequestID derives a unique correlation ID per execution request.
func newRequestID() string {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return ""
	}
	return hex.EncodeToString(bytes)
}

// limitText truncates to at most limit runes for bounded message payloads.
func limitText(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}
