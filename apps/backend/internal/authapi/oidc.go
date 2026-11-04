package authapi

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/auth"
	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

const (
	oidcStateCookie  = "dashwise_oidc_state"
	oidcTicketCookie = "dashwise_sso_ticket"
)

type OIDCOptions struct {
	Enabled      bool
	IssuerURL    string
	ClientID     string
	ClientSecret string
	RedirectURL  string
	Scopes       []string
	SecureCookie bool
}

type oidcLogin struct {
	store        *auth.Store
	issuer       string
	secureCookie bool
	provider     *oidc.Provider
	verifier     *oidc.IDTokenVerifier
	oauth        oauth2.Config
	initMu       sync.Mutex
	initialized  bool
}

func newOIDCLogin(store *auth.Store, options OIDCOptions) (*oidcLogin, error) {
	if !options.Enabled {
		return nil, nil
	}
	issuer := strings.TrimSpace(options.IssuerURL)
	clientID := strings.TrimSpace(options.ClientID)
	clientSecret := strings.TrimSpace(options.ClientSecret)
	redirectURL := strings.TrimSpace(options.RedirectURL)
	redirect, err := url.Parse(redirectURL)
	if issuer == "" || clientID == "" || clientSecret == "" || err != nil || redirect == nil || redirect.Host == "" || (redirect.Scheme != "https" && !isLocalHTTP(redirect)) {
		return nil, errors.New("SSO requires a valid issuer, client ID, client secret, and HTTPS callback URL")
	}
	issuerURL, err := url.Parse(issuer)
	if err != nil || issuerURL.Host == "" || issuerURL.Scheme != "https" && !isLocalHTTP(issuerURL) || issuerURL.User != nil || issuerURL.Fragment != "" || issuerURL.RawQuery != "" {
		return nil, errors.New("SSO issuer must be an HTTPS URL")
	}
	scopes := []string{oidc.ScopeOpenID, oidc.ScopeEmail, oidc.ScopeProfile}
	for _, scope := range options.Scopes {
		scope = strings.TrimSpace(scope)
		if scope != "" && scope != oidc.ScopeOpenID {
			scopes = append(scopes, scope)
		}
	}
	return &oidcLogin{
		store: store, issuer: issuer, secureCookie: options.SecureCookie,
		oauth: oauth2.Config{ClientID: clientID, ClientSecret: clientSecret, RedirectURL: redirectURL, Scopes: scopes},
	}, nil
}

func (o *oidcLogin) initialize(parent context.Context) error {
	o.initMu.Lock()
	defer o.initMu.Unlock()
	if o.initialized {
		return nil
	}
	ctx, cancel := context.WithTimeout(parent, 12*time.Second)
	defer cancel()
	provider, err := oidc.NewProvider(ctx, o.issuer)
	if err != nil {
		return fmt.Errorf("discover OIDC provider: %w", err)
	}
	o.provider = provider
	o.verifier = provider.Verifier(&oidc.Config{ClientID: o.oauth.ClientID})
	o.oauth.Endpoint = provider.Endpoint()
	o.initialized = true
	return nil
}

func isLocalHTTP(value *url.URL) bool {
	if value == nil || value.Scheme != "http" {
		return false
	}
	host := strings.ToLower(value.Hostname())
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

func (o *oidcLogin) start(w http.ResponseWriter, r *http.Request) {
	if err := o.initialize(r.Context()); err != nil {
		writeError(w, http.StatusServiceUnavailable, "SSO provider is unavailable")
		return
	}
	url, state, err := o.authorizationURL(r.Context(), "", "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not start SSO login")
		return
	}
	setOIDCStateCookie(w, state, o.secureCookie)
	http.Redirect(w, r, url, http.StatusFound)
}

func (o *oidcLogin) reauthenticate(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	if token == "" {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	user, session, err := o.store.Validate(r.Context(), token)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	if provided := strings.TrimSpace(r.Header.Get("X-Session-Id")); provided == "" || provided != session.ID {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	if !user.ExternalOnly {
		writeError(w, http.StatusBadRequest, "SSO reauthentication is only available for external-only accounts")
		return
	}
	if err := o.initialize(r.Context()); err != nil {
		writeError(w, http.StatusServiceUnavailable, "SSO provider is unavailable")
		return
	}
	authorizationURL, state, err := o.authorizationURL(r.Context(), user.ID, session.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not start SSO reauthentication")
		return
	}
	setOIDCStateCookie(w, state, o.secureCookie)
	writeJSON(w, http.StatusOK, map[string]string{"url": authorizationURL})
}

func (o *oidcLogin) authorizationURL(ctx context.Context, reauthUserID, reauthSessionID string) (string, string, error) {
	state, err := randomOAuthValue(32)
	if err != nil {
		return "", "", err
	}
	nonce, err := randomOAuthValue(32)
	if err != nil {
		return "", "", err
	}
	verifier := oauth2.GenerateVerifier()
	if reauthUserID != "" {
		err = o.store.StoreOIDCReauthState(ctx, state, nonce, verifier, reauthUserID, reauthSessionID)
	} else {
		err = o.store.StoreOIDCState(ctx, state, nonce, verifier)
	}
	if err != nil {
		return "", "", err
	}
	returnURL := o.oauth.AuthCodeURL(state, oidc.Nonce(nonce), oauth2.S256ChallengeOption(verifier))
	if reauthUserID != "" {
		returnURL = o.oauth.AuthCodeURL(state, oidc.Nonce(nonce), oauth2.S256ChallengeOption(verifier), oauth2.SetAuthURLParam("prompt", "login"), oauth2.SetAuthURLParam("max_age", "0"))
	}
	return returnURL, state, nil
}

func setOIDCStateCookie(w http.ResponseWriter, state string, secure bool) {
	// On same-origin deployments this cookie adds browser binding to state. The
	// reauthentication flow also binds its unguessable, single-use state to the
	// initiating user and session for cross-origin frontend deployments.
	http.SetCookie(w, &http.Cookie{
		Name: oidcStateCookie, Value: state, Path: "/api/v1/auth/callback",
		HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode,
		MaxAge: 600, Expires: time.Now().Add(10 * time.Minute),
	})
}

func (o *oidcLogin) callback(w http.ResponseWriter, r *http.Request) {
	if err := o.initialize(r.Context()); err != nil {
		o.fail(w, r)
		return
	}
	state := r.URL.Query().Get("state")
	stateCookie, cookieErr := r.Cookie(oidcStateCookie)
	clearOIDCStateCookie(w, o.secureCookie)
	if state == "" {
		o.fail(w, r)
		return
	}
	stateData, err := o.store.ConsumeOIDCStateData(r.Context(), state)
	if err != nil {
		o.fail(w, r)
		return
	}
	if cookieErr == nil && subtle.ConstantTimeCompare([]byte(state), []byte(stateCookie.Value)) != 1 || cookieErr != nil && stateData.Purpose != "delete-account" {
		o.failFlow(w, r, stateData.Purpose)
		return
	}
	nonce, verifier := stateData.Nonce, stateData.Verifier
	if stateData.Purpose != "login" && stateData.Purpose != "delete-account" {
		o.fail(w, r)
		return
	}
	if r.URL.Query().Get("error") != "" || r.URL.Query().Get("code") == "" {
		o.failFlow(w, r, stateData.Purpose)
		return
	}
	exchangeCtx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	token, err := o.oauth.Exchange(exchangeCtx, r.URL.Query().Get("code"), oauth2.VerifierOption(verifier))
	if err != nil {
		o.failFlow(w, r, stateData.Purpose)
		return
	}
	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok || rawIDToken == "" {
		o.failFlow(w, r, stateData.Purpose)
		return
	}
	idToken, err := o.verifier.Verify(r.Context(), rawIDToken)
	if err != nil {
		o.failFlow(w, r, stateData.Purpose)
		return
	}
	if subtle.ConstantTimeCompare([]byte(idToken.Nonce), []byte(nonce)) != 1 {
		o.failFlow(w, r, stateData.Purpose)
		return
	}
	var claims struct {
		Subject       string `json:"sub"`
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
		Name          string `json:"name"`
		PreferredName string `json:"preferred_username"`
		AuthTime      int64  `json:"auth_time"`
	}
	if err := idToken.Claims(&claims); err != nil || claims.Subject == "" || claims.Subject != idToken.Subject {
		o.failFlow(w, r, stateData.Purpose)
		return
	}
	if stateData.Purpose == "delete-account" {
		authenticatedAt := time.Unix(claims.AuthTime, 0).UTC()
		if stateData.UserID == "" || stateData.SessionID == "" || claims.AuthTime == 0 || !o.store.IsExternalIdentity(r.Context(), stateData.UserID, o.issuer, claims.Subject) {
			o.failFlow(w, r, stateData.Purpose)
			return
		}
		if err := o.store.MarkOIDCReauthenticated(r.Context(), stateData.UserID, stateData.SessionID, o.issuer, claims.Subject, authenticatedAt); err != nil {
			o.failFlow(w, r, stateData.Purpose)
			return
		}
		http.Redirect(w, r, "/settings/account?reauth=success", http.StatusSeeOther)
		return
	}
	if claims.Email == "" || !claims.EmailVerified {
		userInfo, userInfoErr := o.provider.UserInfo(exchangeCtx, oauth2.StaticTokenSource(token))
		if userInfoErr == nil && userInfo.Subject == idToken.Subject {
			var userInfoClaims struct {
				Email         string `json:"email"`
				EmailVerified bool   `json:"email_verified"`
				Name          string `json:"name"`
				PreferredName string `json:"preferred_username"`
			}
			if userInfo.Claims(&userInfoClaims) == nil {
				if userInfoClaims.EmailVerified {
					claims.Email = userInfoClaims.Email
					claims.EmailVerified = true
				}
				if claims.Name == "" {
					claims.Name = userInfoClaims.Name
				}
				if claims.PreferredName == "" {
					claims.PreferredName = userInfoClaims.PreferredName
				}
			}
		}
	}
	if claims.Email == "" || !claims.EmailVerified {
		o.failFlow(w, r, stateData.Purpose)
		return
	}
	if claims.Name == "" {
		claims.Name = claims.PreferredName
	}
	user, err := o.store.LoginExternal(r.Context(), o.issuer, claims.Subject, claims.Email, claims.Name)
	if err != nil {
		o.failFlow(w, r, stateData.Purpose)
		return
	}
	ticket, err := o.store.CreateSSOTicket(r.Context(), user.ID)
	if err != nil {
		o.failFlow(w, r, stateData.Purpose)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: oidcTicketCookie, Value: ticket, Path: "/api/v1/auth/sso/exchange",
		HttpOnly: true, Secure: o.secureCookie, SameSite: http.SameSiteLaxMode,
		MaxAge: 120, Expires: time.Now().Add(2 * time.Minute),
	})
	http.Redirect(w, r, "/auth/sso/callback", http.StatusSeeOther)
}

func (o *oidcLogin) exchange(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(oidcTicketCookie)
	clearOIDCTicketCookie(w, o.secureCookie)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "SSO login expired; please try again")
		return
	}
	result, err := o.store.ExchangeSSOTicket(r.Context(), cookie.Value)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "SSO login expired; please try again")
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (o *oidcLogin) fail(w http.ResponseWriter, r *http.Request) {
	clearOIDCStateCookie(w, o.secureCookie)
	clearOIDCTicketCookie(w, o.secureCookie)
	http.Redirect(w, r, "/auth/login?sso=failed", http.StatusSeeOther)
}

func (o *oidcLogin) failFlow(w http.ResponseWriter, r *http.Request, purpose string) {
	clearOIDCStateCookie(w, o.secureCookie)
	clearOIDCTicketCookie(w, o.secureCookie)
	if purpose == "delete-account" {
		http.Redirect(w, r, "/settings/account?reauth=failed", http.StatusSeeOther)
		return
	}
	o.fail(w, r)
}

func clearOIDCStateCookie(w http.ResponseWriter, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name: oidcStateCookie, Value: "", Path: "/api/v1/auth/callback",
		HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode,
		MaxAge: -1, Expires: time.Unix(1, 0),
	})
}

func clearOIDCTicketCookie(w http.ResponseWriter, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name: oidcTicketCookie, Value: "", Path: "/api/v1/auth/sso/exchange",
		HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode,
		MaxAge: -1, Expires: time.Unix(1, 0),
	})
}

func randomOAuthValue(size int) (string, error) {
	value := make([]byte, size)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}
