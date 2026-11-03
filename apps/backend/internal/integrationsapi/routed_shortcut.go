package integrationsapi

import (
	"net/http"
	"regexp"
	"strings"
)

// routedShortcutTarget is the parsed target of a routed shortcut action,
// matching the TypeScript RoutedShortcutAction.
type routedShortcutTarget struct {
	sessionID  string
	shortcutID string
}

// maxRoutedShortcutIDLength mirrors the TypeScript shortcut ID cap.
const maxRoutedShortcutIDLength = 512

// routedSessionIDPattern matches the TS sessionId validation.
var routedSessionIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`)

func hasRoutedShortcutPrefix(action string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(action)), "shortcut:")
}

// parseRoutedShortcutAction mirrors the TypeScript parseRoutedShortcutAction
// for "shortcut:<sessionId>.<shortcutId>" actions: the session ID is bounded
// to 128 characters and the shortcut ID to 512 with no control characters.
func parseRoutedShortcutAction(action string) (routedShortcutTarget, bool) {
	trimmed := strings.TrimSpace(action)
	if !hasRoutedShortcutPrefix(trimmed) {
		return routedShortcutTarget{}, false
	}
	remainder := trimmed[len("shortcut:"):]
	dot := strings.IndexByte(remainder, '.')
	if dot < 0 {
		return routedShortcutTarget{}, false
	}
	sessionID := strings.TrimSpace(remainder[:dot])
	shortcutID := strings.TrimSpace(remainder[dot+1:])
	if !routedSessionIDPattern.MatchString(sessionID) {
		return routedShortcutTarget{}, false
	}
	if shortcutID == "" || len([]rune(shortcutID)) > maxRoutedShortcutIDLength ||
		strings.ContainsFunc(shortcutID, func(r rune) bool { return r < 32 || r == 127 }) {
		return routedShortcutTarget{}, false
	}
	return routedShortcutTarget{sessionID: sessionID, shortcutID: shortcutID}, true
}

// executeRoutedShortcut delivers a shortcut to the target browser session over
// its activity websocket and waits for the correlated result, returning the
// same success/error HTTP behavior as the TypeScript executeRoutedShortcut:
// 400 invalid action, 404 unknown session, 503 offline session, 502 failed
// execution, and 200 {success, requestId} on success.
func (h *Handler) executeRoutedShortcut(w http.ResponseWriter, r *http.Request, owner, action string) {
	target, ok := parseRoutedShortcutAction(action)
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid shortcut action"})
		return
	}
	if h.sessions == nil || h.broker == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Target session is unavailable"})
		return
	}
	active, err := h.sessions.HasActiveSession(r.Context(), owner, target.sessionID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not check target session"})
		return
	}
	if !active {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Target session is unavailable"})
		return
	}
	if !h.broker.IsSessionConnected(owner, target.sessionID) {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Target session is offline"})
		return
	}
	result := h.broker.RequestExecution(r.Context(), owner, target.sessionID, target.shortcutID)
	if !result.Success {
		errorText := result.Error
		if errorText == "" {
			errorText = "Shortcut execution failed"
		}
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": errorText, "requestId": result.RequestID})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "requestId": result.RequestID})
}
