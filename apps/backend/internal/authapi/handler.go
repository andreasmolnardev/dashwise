// Package authapi adapts the SQLite authentication store to the Dashwise HTTP API.
package authapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/auth"
)

const maxBodyBytes = 1 << 20

type Handler struct {
	store *auth.Store
	mux   *http.ServeMux
}

type Options struct {
	OIDC OIDCOptions
}

func New(store *auth.Store, options ...Options) (http.Handler, error) {
	if store == nil {
		return nil, errors.New("authentication API requires a store")
	}
	optionsValue := Options{}
	if len(options) > 0 {
		optionsValue = options[0]
	}
	oidcHandler, err := newOIDCLogin(store, optionsValue.OIDC)
	if err != nil {
		return nil, err
	}
	h := &Handler{store: store, mux: http.NewServeMux()}
	if oidcHandler != nil {
		h.mux.HandleFunc("GET /api/v1/auth/sso", oidcHandler.start)
		h.mux.HandleFunc("POST /api/v1/auth/sso/reauth", oidcHandler.reauthenticate)
		h.mux.HandleFunc("GET /api/v1/auth/callback", oidcHandler.callback)
		h.mux.HandleFunc("POST /api/v1/auth/sso/exchange", oidcHandler.exchange)
	} else {
		h.mux.HandleFunc("GET /api/v1/auth/sso", h.ssoDisabled)
		h.mux.HandleFunc("POST /api/v1/auth/sso/reauth", h.ssoDisabled)
		h.mux.HandleFunc("GET /api/v1/auth/callback", h.ssoDisabled)
		h.mux.HandleFunc("POST /api/v1/auth/sso/exchange", h.ssoDisabled)
	}
	h.mux.HandleFunc("POST /api/v1/auth/signup", h.signup)
	h.mux.HandleFunc("POST /api/v1/auth/login", h.login)
	h.mux.HandleFunc("POST /api/v1/auth/validate-auth", h.validate)
	h.mux.HandleFunc("POST /api/v1/auth/logout", h.logout)
	h.mux.HandleFunc("POST /api/v1/auth/change-password", h.changePassword)
	h.mux.HandleFunc("DELETE /api/v1/auth/delete-account", h.deleteAccount)
	h.mux.HandleFunc("PATCH /api/v1/auth/update-user-property", h.updateUserProperty)
	h.mux.HandleFunc("GET /api/v1/auth/me", h.me)
	h.mux.HandleFunc("GET /api/v1/sessions", h.listSessions)
	h.mux.HandleFunc("DELETE /api/v1/sessions/{sessionId}", h.revokeSession)
	h.mux.HandleFunc("GET /api/v1/sessions/current", h.currentSession)
	h.mux.HandleFunc("PATCH /api/v1/sessions/current", h.renameCurrentSession)
	h.mux.HandleFunc("GET /api/v1/auth/api-credentials", h.listAPICredentials)
	h.mux.HandleFunc("POST /api/v1/auth/api-credentials", h.createAPICredential)
	h.mux.HandleFunc("DELETE /api/v1/auth/api-credentials/{id}", h.revokeAPICredential)
	return h.mux, nil
}

func (h *Handler) listAPICredentials(w http.ResponseWriter, r *http.Request) {
	user, _, ok := h.authenticate(w, r)
	if !ok {
		return
	}
	credentials, err := h.store.ListAPICredentials(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list API credentials")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"credentials": credentials})
}

func (h *Handler) createAPICredential(w http.ResponseWriter, r *http.Request) {
	user, _, ok := h.authenticate(w, r)
	if !ok {
		return
	}
	var input struct {
		Name          string `json:"name"`
		ExpiresInDays int    `json:"expiresInDays"`
	}
	if !decode(w, r, &input) {
		return
	}
	created, err := h.store.CreateAPICredential(r.Context(), user.ID, input.Name, input.ExpiresInDays)
	if errors.Is(err, auth.ErrInvalidInput) {
		writeError(w, http.StatusBadRequest, "name must be 1 to 80 characters and expiry must be 1 to 365 days")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not create API credential")
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (h *Handler) revokeAPICredential(w http.ResponseWriter, r *http.Request) {
	user, _, ok := h.authenticate(w, r)
	if !ok {
		return
	}
	if err := h.store.RevokeAPICredential(r.Context(), user.ID, r.PathValue("id")); errors.Is(err, auth.ErrAPICredentialNotFound) {
		writeError(w, http.StatusNotFound, "API credential not found")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "could not revoke API credential")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) ssoDisabled(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotFound, "SSO is not configured")
}

func (h *Handler) signup(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Name            string `json:"_name"`
		Email           string `json:"email"`
		Password        string `json:"password"`
		PasswordConfirm string `json:"passwordConfirm"`
	}
	if !decode(w, r, &input) {
		return
	}
	result, err := h.store.Signup(r.Context(), auth.SignupInput{
		Name: input.Name, Email: input.Email, Password: input.Password, PasswordConfirm: input.PasswordConfirm,
	})
	if err != nil {
		writeAuthError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": result.User})
}

func (h *Handler) login(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		TOTP     string `json:"totp"`
	}
	if !decode(w, r, &input) {
		return
	}
	result, err := h.store.Login(r.Context(), input.Email, input.Password, input.TOTP)
	if err != nil {
		writeAuthError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) validate(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Token     string `json:"token"`
		SessionID string `json:"sessionId"`
		Auth      *struct {
			Token     string `json:"token"`
			SessionID string `json:"sessionId"`
		} `json:"auth"`
	}
	if !decode(w, r, &input) {
		return
	}
	token := bearer(r)
	if token == "" {
		token = input.Token
	}
	if token == "" && input.Auth != nil {
		token = input.Auth.Token
	}
	providedSessionID := strings.TrimSpace(r.Header.Get("X-Session-Id"))
	if providedSessionID == "" {
		providedSessionID = strings.TrimSpace(input.SessionID)
	}
	if providedSessionID == "" && input.Auth != nil {
		providedSessionID = input.Auth.SessionID
	}
	user, session, err := h.store.Validate(r.Context(), token)
	if err != nil {
		writeAuthError(w, err)
		return
	}
	if providedSessionID != "" && providedSessionID != session.ID {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "token": token, "user": user, "sessionId": session.ID})
}

func (h *Handler) logout(w http.ResponseWriter, r *http.Request) {
	user, session, ok := h.authenticate(w, r)
	if !ok {
		return
	}
	if err := h.store.Logout(r.Context(), user.ID, session.ID); err != nil {
		writeAuthError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) changePassword(w http.ResponseWriter, r *http.Request) {
	user, session, ok := h.authenticate(w, r)
	if !ok {
		return
	}
	var input struct {
		Email           string `json:"email"`
		OldPassword     string `json:"oldPassword"`
		NewPassword     string `json:"newPassword"`
		PasswordConfirm string `json:"confirmPassword"`
	}
	if !decode(w, r, &input) {
		return
	}
	if input.Email == "" {
		input.Email = user.Email
	}
	err := h.store.ChangePassword(r.Context(), user.ID, auth.PasswordChangeInput{
		Email: input.Email, OldPassword: input.OldPassword,
		NewPassword: input.NewPassword, PasswordConfirm: input.PasswordConfirm,
	}, session.ID)
	if err != nil {
		writeAuthError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *Handler) deleteAccount(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Auth *struct {
			Token     string `json:"token"`
			SessionID string `json:"sessionId"`
		} `json:"auth"`
		Payload struct {
			Email    string `json:"email"`
			Password string `json:"password"`
			TOTP     string `json:"totp"`
		} `json:"payload"`
	}
	if !decode(w, r, &input) {
		return
	}
	token := bearer(r)
	if token == "" && input.Auth != nil {
		token = strings.TrimSpace(input.Auth.Token)
	}
	if token == "" {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	user, session, err := h.store.Validate(r.Context(), token)
	if err != nil {
		writeAuthError(w, err)
		return
	}
	providedSessionID := strings.TrimSpace(r.Header.Get("X-Session-Id"))
	if providedSessionID == "" && input.Auth != nil {
		providedSessionID = strings.TrimSpace(input.Auth.SessionID)
	}
	if providedSessionID != "" && providedSessionID != session.ID {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	if err := h.store.DeleteAccount(r.Context(), user.ID, input.Payload.Email, input.Payload.Password, input.Payload.TOTP, session.ID); err != nil {
		writeAuthError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, nil)
}

func (h *Handler) updateUserProperty(w http.ResponseWriter, r *http.Request) {
	user, _, ok := h.authenticate(w, r)
	if !ok {
		return
	}
	var input struct {
		Auth *struct {
			Token     string `json:"token"`
			SessionID string `json:"sessionId"`
		} `json:"auth"`
		PropertyName  string          `json:"propertyName"`
		PropertyValue json.RawMessage `json:"propertyValue"`
	}
	if !decode(w, r, &input) {
		return
	}
	var value any
	if len(input.PropertyValue) > 0 {
		if err := json.Unmarshal(input.PropertyValue, &value); err != nil {
			writeError(w, http.StatusBadRequest, "invalid property value")
			return
		}
	}
	updated, err := h.store.UpdateUserProperty(r.Context(), user.ID, input.PropertyName, value)
	if err != nil {
		writeAuthError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (h *Handler) me(w http.ResponseWriter, r *http.Request) {
	user, _, ok := h.authenticate(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": user})
}

func (h *Handler) listSessions(w http.ResponseWriter, r *http.Request) {
	user, _, ok := h.authenticate(w, r)
	if !ok {
		return
	}
	sessions, err := h.store.ListSessions(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list sessions")
		return
	}
	writeJSON(w, http.StatusOK, sessions)
}

func (h *Handler) revokeSession(w http.ResponseWriter, r *http.Request) {
	user, _, ok := h.authenticate(w, r)
	if !ok {
		return
	}
	if err := h.store.Logout(r.Context(), user.ID, r.PathValue("sessionId")); err != nil {
		writeAuthError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *Handler) currentSession(w http.ResponseWriter, r *http.Request) {
	_, session, ok := h.authenticate(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, session)
}

func (h *Handler) renameCurrentSession(w http.ResponseWriter, r *http.Request) {
	user, session, ok := h.authenticate(w, r)
	if !ok {
		return
	}
	var input struct {
		DisplayName string `json:"displayName"`
	}
	if !decode(w, r, &input) {
		return
	}
	updated, err := h.store.RenameSession(r.Context(), user.ID, session.ID, input.DisplayName)
	if err != nil {
		writeAuthError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (h *Handler) authenticate(w http.ResponseWriter, r *http.Request) (auth.User, auth.Session, bool) {
	token := bearer(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return auth.User{}, auth.Session{}, false
	}
	user, session, err := h.store.Validate(r.Context(), token)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return auth.User{}, auth.Session{}, false
	}
	if providedSession := strings.TrimSpace(r.Header.Get("X-Session-Id")); providedSession != "" && providedSession != session.ID {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return auth.User{}, auth.Session{}, false
	}
	return user, session, true
}

func bearer(r *http.Request) string {
	value := strings.TrimSpace(r.Header.Get("Authorization"))
	if len(value) < 7 || !strings.EqualFold(value[:7], "Bearer ") {
		return ""
	}
	return strings.TrimSpace(value[7:])
}

func decode(w http.ResponseWriter, r *http.Request, destination any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request body")
		return false
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "request body must contain a single JSON value")
		return false
	}
	return true
}

func writeAuthError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, auth.ErrUnauthorized), errors.Is(err, auth.ErrInvalidCredentials):
		writeError(w, http.StatusUnauthorized, "invalid credentials")
	case errors.Is(err, auth.ErrTOTPRequired):
		writeError(w, http.StatusUnauthorized, err.Error())
	case errors.Is(err, auth.ErrInvalidTOTP):
		writeError(w, http.StatusUnauthorized, err.Error())
	case errors.Is(err, auth.ErrRecentOIDCReauthRequired):
		writeError(w, http.StatusForbidden, err.Error())
	case errors.Is(err, auth.ErrSignupDisabled):
		writeError(w, http.StatusForbidden, "sign up is disabled")
	case errors.Is(err, auth.ErrEmailExists):
		writeError(w, http.StatusConflict, "email is already registered")
	case errors.Is(err, auth.ErrInvalidInput):
		writeError(w, http.StatusBadRequest, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, "authentication request failed")
	}
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
