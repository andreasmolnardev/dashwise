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
	state, err := randomOAuthValue(32)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not start SSO login")
		return
	}
	nonce, err := randomOAuthValue(32)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not start SSO login")
		return
	}
	verifier := oauth2.GenerateVerifier()
	if err := o.store.StoreOIDCState(r.Context(), state, nonce, verifier); err != nil {
		writeError(w, http.StatusInternalServerError, "could not start SSO login")
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: oidcStateCookie, Value: state, Path: "/api/v1/auth/callback",
		HttpOnly: true, Secure: o.secureCookie, SameSite: http.SameSiteLaxMode,
		MaxAge: 600, Expires: time.Now().Add(10 * time.Minute),
	})
	http.Redirect(w, r, o.oauth.AuthCodeURL(state, oidc.Nonce(nonce), oauth2.S256ChallengeOption(verifier)), http.StatusFound)
}

func (o *oidcLogin) callback(w http.ResponseWriter, r *http.Request) {
	if err := o.initialize(r.Context()); err != nil {
		o.fail(w, r)
		return
	}
	state := r.URL.Query().Get("state")
	stateCookie, cookieErr := r.Cookie(oidcStateCookie)
	clearOIDCStateCookie(w, o.secureCookie)
	if cookieErr != nil || subtle.ConstantTimeCompare([]byte(state), []byte(stateCookie.Value)) != 1 {
		o.fail(w, r)
		return
	}
	nonce, verifier, err := o.store.ConsumeOIDCState(r.Context(), state)
	if err != nil {
		o.fail(w, r)
		return
	}
	if r.URL.Query().Get("error") != "" || r.URL.Query().Get("code") == "" {
		o.fail(w, r)
		return
	}
	exchangeCtx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	token, err := o.oauth.Exchange(exchangeCtx, r.URL.Query().Get("code"), oauth2.VerifierOption(verifier))
	if err != nil {
		o.fail(w, r)
		return
	}
	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok || rawIDToken == "" {
		o.fail(w, r)
		return
	}
	idToken, err := o.verifier.Verify(r.Context(), rawIDToken)
	if err != nil {
		o.fail(w, r)
		return
	}
	if subtle.ConstantTimeCompare([]byte(idToken.Nonce), []byte(nonce)) != 1 {
		o.fail(w, r)
		return
	}
	var claims struct {
		Subject       string `json:"sub"`
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
		Name          string `json:"name"`
		PreferredName string `json:"preferred_username"`
	}
	if err := idToken.Claims(&claims); err != nil || claims.Subject == "" || claims.Subject != idToken.Subject {
		o.fail(w, r)
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
		o.fail(w, r)
		return
	}
	if claims.Name == "" {
		claims.Name = claims.PreferredName
	}
	user, err := o.store.LoginExternal(r.Context(), o.issuer, claims.Subject, claims.Email, claims.Name)
	if err != nil {
		o.fail(w, r)
		return
	}
	ticket, err := o.store.CreateSSOTicket(r.Context(), user.ID)
	if err != nil {
		o.fail(w, r)
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
