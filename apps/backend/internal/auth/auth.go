// Package auth provides SQLite-backed user authentication for the Go backend.
// Session bearer tokens are only returned once and are stored as SHA-256 hashes.
package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"database/sql"
	"encoding/base32"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/mail"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/secrets"
	"github.com/andreasmolnardev/dashwise/packages/foundation"
	"golang.org/x/crypto/bcrypt"
)

var (
	ErrSignupDisabled           = errors.New("signup is disabled")
	ErrInvalidCredentials       = errors.New("invalid email or password")
	ErrEmailExists              = errors.New("email is already registered")
	ErrInvalidInput             = errors.New("invalid authentication input")
	ErrUnauthorized             = errors.New("unauthorized")
	ErrTOTPRequired             = errors.New("TOTP code required because two-factor authentication is enabled")
	ErrInvalidTOTP              = errors.New("invalid TOTP code")
	ErrInvalidSSOState          = errors.New("invalid or expired SSO state")
	ErrInvalidSSOTicket         = errors.New("invalid or expired SSO exchange ticket")
	ErrRecentOIDCReauthRequired = errors.New("Recent SSO reauthentication is required to delete this account. Reauthenticate with your identity provider, then try again.")
)

const (
	DefaultSessionLifetime = 90 * 24 * time.Hour
	DefaultPasswordCost    = 12
)

type Options struct {
	DisableSignup bool
	SessionTTL    time.Duration
	PasswordCost  int
	Clock         func() time.Time
	TOTPProtector SecretProtector
}

// SecretProtector encrypts sensitive authentication data before it reaches SQLite.
type SecretProtector interface {
	Protect([]byte) ([]byte, error)
	Reveal([]byte) ([]byte, error)
}

type User struct {
	ID           string         `json:"id"`
	Email        string         `json:"email"`
	Name         string         `json:"name"`
	CreatedAt    time.Time      `json:"createdAt"`
	UpdatedAt    time.Time      `json:"updatedAt"`
	ExternalOnly bool           `json:"externalOnly,omitempty"`
	Properties   map[string]any `json:"-"`
}

func (u User) MarshalJSON() ([]byte, error) {
	record := map[string]any{"id": u.ID, "email": u.Email, "name": u.Name, "createdAt": u.CreatedAt, "updatedAt": u.UpdatedAt}
	for name, value := range u.Properties {
		record[name] = value
	}
	if u.ExternalOnly {
		record["externalOnly"] = true
	}
	return json.Marshal(record)
}

type Session struct {
	ID          string    `json:"id"`
	SessionID   string    `json:"sessionId"`
	UserID      string    `json:"user"`
	DisplayName string    `json:"displayName"`
	ClientType  string    `json:"clientType,omitempty"`
	Platform    string    `json:"platform,omitempty"`
	CreatedAt   time.Time `json:"created"`
	ExpiresAt   time.Time `json:"expiresAt"`
	LastSeen    time.Time `json:"lastSeenAt"`
}

type AuthResult struct {
	Token     string `json:"token"`
	SessionID string `json:"sessionId"`
	User      User   `json:"user"`
}

type SignupInput struct {
	Name            string
	Email           string
	Password        string
	PasswordConfirm string
}

type PasswordChangeInput struct {
	Email           string
	OldPassword     string
	NewPassword     string
	PasswordConfirm string
}

type Store struct {
	db            *sql.DB
	foundation    *foundation.DB
	disableSignup bool
	sessionTTL    time.Duration
	passwordCost  int
	clock         func() time.Time
	totpProtector SecretProtector
}

func NewStore(db *foundation.DB, options Options) (*Store, error) {
	if db == nil || db.SQL() == nil {
		return nil, errors.New("auth store requires an open database")
	}
	if options.SessionTTL <= 0 {
		options.SessionTTL = DefaultSessionLifetime
	}
	if options.PasswordCost == 0 {
		options.PasswordCost = DefaultPasswordCost
	}
	if options.PasswordCost < bcrypt.MinCost || options.PasswordCost > bcrypt.MaxCost {
		return nil, fmt.Errorf("bcrypt password cost must be between %d and %d", bcrypt.MinCost, bcrypt.MaxCost)
	}
	if options.Clock == nil {
		options.Clock = time.Now
	}
	if options.TOTPProtector == nil {
		dataDir := os.Getenv("DATA_DIR")
		if dataDir == "" {
			dataDir = "./data"
		}
		protector, err := secrets.OpenFileProtector(filepath.Join(dataDir, "secret.key"))
		if err != nil {
			return nil, fmt.Errorf("initialize TOTP secret encryption: %w", err)
		}
		options.TOTPProtector = protector
	}
	return &Store{
		db: db.SQL(), foundation: db, disableSignup: options.DisableSignup,
		sessionTTL: options.SessionTTL, passwordCost: options.PasswordCost, totpProtector: options.TOTPProtector,
		clock: options.Clock,
	}, nil
}

// Initialize installs the auth-owned schema. It is idempotent and is separate
// from the application migration table so domains can own their tables.
func (s *Store) Initialize(ctx context.Context) error {
	return s.foundation.ApplyMigrations(ctx, []foundation.Migration{{
		ID: "0002_auth_schema", Name: "create authentication and user preference tables",
		Up: func(ctx context.Context, tx *sql.Tx) error {
			statements := []string{
				`
		CREATE TABLE IF NOT EXISTS auth_users (
			id TEXT PRIMARY KEY NOT NULL,
			email TEXT NOT NULL COLLATE NOCASE UNIQUE,
			name TEXT NOT NULL,
			password_hash TEXT NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			totp_secret_cipher BLOB
		);`,
				`
		CREATE TABLE IF NOT EXISTS auth_sessions (
			id TEXT PRIMARY KEY NOT NULL,
			user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
			token_hash TEXT NOT NULL UNIQUE,
			display_name TEXT NOT NULL DEFAULT 'Web browser',
			client_type TEXT NOT NULL DEFAULT 'browser',
			platform TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL,
			expires_at TEXT NOT NULL,
			last_seen_at TEXT NOT NULL,
			revoked_at TEXT
		);`,
				`CREATE INDEX IF NOT EXISTS auth_sessions_by_user ON auth_sessions(user_id, created_at DESC)`,
				`CREATE INDEX IF NOT EXISTS auth_sessions_by_expiry ON auth_sessions(expires_at)`,
				`CREATE TABLE IF NOT EXISTS auth_user_properties (
			user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
			property_name TEXT NOT NULL,
			property_json TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			PRIMARY KEY(user_id, property_name)
		)`,
			}
			for _, statement := range statements {
				if _, err := tx.ExecContext(ctx, statement); err != nil {
					return fmt.Errorf("initialize authentication schema: %w", err)
				}
			}
			for _, column := range []struct{ name, definition string }{
				{name: "display_name", definition: "TEXT NOT NULL DEFAULT 'Web browser'"},
				{name: "client_type", definition: "TEXT NOT NULL DEFAULT 'browser'"},
				{name: "platform", definition: "TEXT NOT NULL DEFAULT ''"},
			} {
				if err := ensureSessionColumn(ctx, tx, column.name, column.definition); err != nil {
					return fmt.Errorf("migrate authentication session column %q: %w", column.name, err)
				}
			}
			if err := ensureColumn(ctx, tx, "auth_users", "totp_secret_cipher", "BLOB"); err != nil {
				return fmt.Errorf("migrate TOTP secret column: %w", err)
			}
			return nil
		},
		Down: func(ctx context.Context, tx *sql.Tx) error {
			_, err := tx.ExecContext(ctx, `DROP TABLE IF EXISTS auth_user_properties; DROP TABLE IF EXISTS auth_sessions; DROP TABLE IF EXISTS auth_users;`)
			return err
		},
	}, {
		ID:   "0003_auth_totp_secret",
		Name: "encrypted TOTP secret storage",
		Up: func(ctx context.Context, tx *sql.Tx) error {
			return ensureColumn(ctx, tx, "auth_users", "totp_secret_cipher", "BLOB")
		},
	}, {
		ID: "0004_auth_oidc", Name: "OIDC identities and one-time login state",
		Up: func(ctx context.Context, tx *sql.Tx) error {
			if err := ensureColumn(ctx, tx, "auth_users", "password_login_enabled", "INTEGER NOT NULL DEFAULT 1"); err != nil {
				return fmt.Errorf("add password login flag: %w", err)
			}
			for _, statement := range []string{
				`CREATE TABLE IF NOT EXISTS auth_external_identities (issuer TEXT NOT NULL, subject TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE, email TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(issuer,subject))`,
				`CREATE INDEX IF NOT EXISTS auth_external_identities_by_user ON auth_external_identities(user_id)`,
				`CREATE TABLE IF NOT EXISTS auth_oidc_states (state_hash TEXT PRIMARY KEY NOT NULL, nonce TEXT NOT NULL, verifier TEXT NOT NULL, expires_at TEXT NOT NULL)`,
				`CREATE INDEX IF NOT EXISTS auth_oidc_states_by_expiry ON auth_oidc_states(expires_at)`,
				`CREATE TABLE IF NOT EXISTS auth_sso_tickets (ticket_hash TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL)`,
				`CREATE INDEX IF NOT EXISTS auth_sso_tickets_by_expiry ON auth_sso_tickets(expires_at)`,
			} {
				if _, err := tx.ExecContext(ctx, statement); err != nil {
					return fmt.Errorf("create OIDC authentication schema: %w", err)
				}
			}
			return nil
		},
	}, {
		ID: "0005_auth_oidc_reauthentication", Name: "OIDC reauthentication for sensitive account actions",
		Up: func(ctx context.Context, tx *sql.Tx) error {
			if err := ensureColumn(ctx, tx, "auth_sessions", "oidc_reauthenticated_at", "TEXT"); err != nil {
				return fmt.Errorf("add session OIDC reauthentication timestamp: %w", err)
			}
			for _, column := range []struct{ name, definition string }{
				{name: "purpose", definition: "TEXT NOT NULL DEFAULT 'login'"},
				{name: "user_id", definition: "TEXT"},
				{name: "session_id", definition: "TEXT"},
			} {
				if err := ensureColumn(ctx, tx, "auth_oidc_states", column.name, column.definition); err != nil {
					return fmt.Errorf("add OIDC state %s: %w", column.name, err)
				}
			}
			return nil
		},
	}})
}

// StoreOIDCState persists short-lived, single-use OAuth state and PKCE data.
func (s *Store) StoreOIDCState(ctx context.Context, state, nonce, verifier string) error {
	return s.storeOIDCState(ctx, state, nonce, verifier, "login", "", "")
}

// StoreOIDCReauthState binds a forced identity-provider interaction to the
// currently authenticated user and session.
func (s *Store) StoreOIDCReauthState(ctx context.Context, state, nonce, verifier, userID, sessionID string) error {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(sessionID) == "" {
		return ErrInvalidSSOState
	}
	return s.storeOIDCState(ctx, state, nonce, verifier, "delete-account", userID, sessionID)
}

func (s *Store) storeOIDCState(ctx context.Context, state, nonce, verifier, purpose, userID, sessionID string) error {
	if state == "" || nonce == "" || verifier == "" {
		return ErrInvalidSSOState
	}
	now := s.now().UTC()
	_, err := s.db.ExecContext(ctx, `INSERT INTO auth_oidc_states(state_hash,nonce,verifier,expires_at,purpose,user_id,session_id) VALUES(?,?,?,?,?,NULLIF(?,''),NULLIF(?,''))`, hashToken(state), nonce, verifier, now.Add(10*time.Minute).Format(time.RFC3339Nano), purpose, userID, sessionID)
	if err != nil {
		return fmt.Errorf("store OIDC state: %w", err)
	}
	_, _ = s.db.ExecContext(ctx, `DELETE FROM auth_oidc_states WHERE expires_at<=?`, now.Format(time.RFC3339Nano))
	return nil
}

type OIDCState struct {
	Nonce, Verifier, Purpose, UserID, SessionID string
}

// ConsumeOIDCState removes and returns valid state data exactly once.
func (s *Store) ConsumeOIDCState(ctx context.Context, state string) (nonce, verifier string, err error) {
	consumed, err := s.ConsumeOIDCStateData(ctx, state)
	return consumed.Nonce, consumed.Verifier, err
}

// ConsumeOIDCStateData removes and returns valid state data exactly once.
func (s *Store) ConsumeOIDCStateData(ctx context.Context, state string) (OIDCState, error) {
	if state == "" {
		return OIDCState{}, ErrInvalidSSOState
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return OIDCState{}, err
	}
	defer tx.Rollback()
	var expiresAt string
	var consumed OIDCState
	err = tx.QueryRowContext(ctx, `SELECT nonce,verifier,expires_at,purpose,COALESCE(user_id,''),COALESCE(session_id,'') FROM auth_oidc_states WHERE state_hash=?`, hashToken(state)).Scan(&consumed.Nonce, &consumed.Verifier, &expiresAt, &consumed.Purpose, &consumed.UserID, &consumed.SessionID)
	if errors.Is(err, sql.ErrNoRows) {
		return OIDCState{}, ErrInvalidSSOState
	}
	if err != nil {
		return OIDCState{}, fmt.Errorf("read OIDC state: %w", err)
	}
	expires, err := parseTime(expiresAt)
	if err != nil || !expires.After(s.now()) {
		return OIDCState{}, ErrInvalidSSOState
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM auth_oidc_states WHERE state_hash=?`, hashToken(state)); err != nil {
		return OIDCState{}, fmt.Errorf("consume OIDC state: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return OIDCState{}, fmt.Errorf("commit OIDC state: %w", err)
	}
	return consumed, nil
}

// MarkOIDCReauthenticated records a recent, verified external identity
// interaction for the exact active device session that initiated it.
func (s *Store) MarkOIDCReauthenticated(ctx context.Context, userID, sessionID, issuer, subject string, authenticatedAt time.Time) error {
	now := s.now().UTC()
	if userID == "" || sessionID == "" || issuer == "" || subject == "" || authenticatedAt.After(now.Add(time.Minute)) || now.Sub(authenticatedAt) > 10*time.Minute {
		return ErrRecentOIDCReauthRequired
	}
	result, err := s.db.ExecContext(ctx, `UPDATE auth_sessions SET oidc_reauthenticated_at=? WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>? AND EXISTS (SELECT 1 FROM auth_external_identities WHERE user_id=? AND issuer=? AND subject=?)`, authenticatedAt.UTC().Format(time.RFC3339Nano), sessionID, userID, now.Format(time.RFC3339Nano), userID, issuer, subject)
	if err != nil {
		return fmt.Errorf("record OIDC reauthentication: %w", err)
	}
	changed, err := result.RowsAffected()
	if err != nil || changed != 1 {
		return ErrInvalidSSOState
	}
	return nil
}

func (s *Store) RequireRecentOIDCReauthentication(ctx context.Context, userID, sessionID string) error {
	var value sql.NullString
	if err := s.db.QueryRowContext(ctx, `SELECT oidc_reauthenticated_at FROM auth_sessions WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>?`, sessionID, userID, s.now().UTC().Format(time.RFC3339Nano)).Scan(&value); err != nil {
		return ErrRecentOIDCReauthRequired
	}
	if !value.Valid {
		return ErrRecentOIDCReauthRequired
	}
	parsed, err := parseTime(value.String)
	if err != nil || parsed.After(s.now().Add(time.Minute)) || s.now().Sub(parsed) > 10*time.Minute {
		return ErrRecentOIDCReauthRequired
	}
	return nil
}

func (s *Store) IsExternalIdentity(ctx context.Context, userID, issuer, subject string) bool {
	var exists int
	err := s.db.QueryRowContext(ctx, `SELECT 1 FROM auth_external_identities WHERE user_id=? AND issuer=? AND subject=?`, userID, issuer, subject).Scan(&exists)
	return err == nil
}

// LoginExternal links a verified external identity to an account. Existing
// accounts are matched only by verified email addresses supplied by the
// configured identity provider; the browser session is issued after ticket exchange.
func (s *Store) LoginExternal(ctx context.Context, issuer, subject, email, name string) (User, error) {
	issuer = strings.TrimSpace(issuer)
	subject = strings.TrimSpace(subject)
	normalizedEmail, err := normalizeEmail(email)
	if issuer == "" || subject == "" || err != nil || len(issuer) > 2048 || len(subject) > 512 {
		return User{}, ErrInvalidCredentials
	}
	name = strings.TrimSpace(name)
	if len(name) > 200 {
		name = name[:200]
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return User{}, fmt.Errorf("begin external login: %w", err)
	}
	defer tx.Rollback()
	var user User
	var createdAt, updatedAt string
	err = tx.QueryRowContext(ctx, `SELECT u.id,u.email,u.name,u.created_at,u.updated_at FROM auth_external_identities e JOIN auth_users u ON u.id=e.user_id WHERE e.issuer=? AND e.subject=?`, issuer, subject).Scan(&user.ID, &user.Email, &user.Name, &createdAt, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		err = tx.QueryRowContext(ctx, `SELECT id,email,name,created_at,updated_at FROM auth_users WHERE email=? COLLATE NOCASE`, normalizedEmail).Scan(&user.ID, &user.Email, &user.Name, &createdAt, &updatedAt)
		if errors.Is(err, sql.ErrNoRows) {
			if s.disableSignup {
				return User{}, ErrSignupDisabled
			}
			user.ID, err = randomID(16)
			if err != nil {
				return User{}, err
			}
			if name == "" {
				name = defaultName(normalizedEmail)
			}
			// No password is issued to an external-only account. This random
			// bcrypt value cannot be used as a credential and preserves the
			// existing non-null schema invariant.
			secret := make([]byte, 32)
			if _, err := rand.Read(secret); err != nil {
				return User{}, fmt.Errorf("generate external account secret: %w", err)
			}
			hash, err := bcrypt.GenerateFromPassword(secret, s.passwordCost)
			if err != nil {
				return User{}, fmt.Errorf("protect external account secret: %w", err)
			}
			now := s.now().UTC().Format(time.RFC3339Nano)
			if _, err := tx.ExecContext(ctx, `INSERT INTO auth_users(id,email,name,password_hash,created_at,updated_at,password_login_enabled) VALUES(?,?,?,?,?,?,0)`, user.ID, normalizedEmail, name, string(hash), now, now); err != nil {
				return User{}, fmt.Errorf("create external account: %w", err)
			}
			user.Email, user.Name, createdAt, updatedAt = normalizedEmail, name, now, now
		} else if err != nil {
			return User{}, fmt.Errorf("find external account: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO auth_external_identities(issuer,subject,user_id,email,created_at) VALUES(?,?,?,?,?)`, issuer, subject, user.ID, normalizedEmail, s.now().UTC().Format(time.RFC3339Nano)); err != nil {
			return User{}, fmt.Errorf("link external identity: %w", err)
		}
	} else if err != nil {
		return User{}, fmt.Errorf("find external identity: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return User{}, fmt.Errorf("commit external login: %w", err)
	}
	if user.CreatedAt, err = parseTime(createdAt); err != nil {
		return User{}, err
	}
	if user.UpdatedAt, err = parseTime(updatedAt); err != nil {
		return User{}, err
	}
	user, err = s.loadProperties(ctx, user)
	if err != nil {
		return User{}, err
	}
	return user, nil
}

// CreateSSOTicket creates a short-lived one-use browser handoff credential.
func (s *Store) CreateSSOTicket(ctx context.Context, userID string) (string, error) {
	ticket, err := randomID(32)
	if err != nil {
		return "", err
	}
	now := s.now().UTC()
	_, err = s.db.ExecContext(ctx, `INSERT INTO auth_sso_tickets(ticket_hash,user_id,expires_at) VALUES(?,?,?)`, hashToken(ticket), userID, now.Add(2*time.Minute).Format(time.RFC3339Nano))
	if err != nil {
		return "", fmt.Errorf("create SSO exchange ticket: %w", err)
	}
	_, _ = s.db.ExecContext(ctx, `DELETE FROM auth_sso_tickets WHERE expires_at<=?`, now.Format(time.RFC3339Nano))
	return ticket, nil
}

// ExchangeSSOTicket consumes a one-use browser ticket and issues a normal
// Dashwise session token.
func (s *Store) ExchangeSSOTicket(ctx context.Context, ticket string) (AuthResult, error) {
	if ticket == "" {
		return AuthResult{}, ErrInvalidSSOTicket
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return AuthResult{}, err
	}
	defer tx.Rollback()
	var user User
	var createdAt, updatedAt, expiresAt string
	err = tx.QueryRowContext(ctx, `SELECT u.id,u.email,u.name,u.created_at,u.updated_at,t.expires_at FROM auth_sso_tickets t JOIN auth_users u ON u.id=t.user_id WHERE t.ticket_hash=?`, hashToken(ticket)).Scan(&user.ID, &user.Email, &user.Name, &createdAt, &updatedAt, &expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return AuthResult{}, ErrInvalidSSOTicket
	}
	if err != nil {
		return AuthResult{}, fmt.Errorf("read SSO ticket: %w", err)
	}
	expires, err := parseTime(expiresAt)
	if err != nil || !expires.After(s.now()) {
		return AuthResult{}, ErrInvalidSSOTicket
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM auth_sso_tickets WHERE ticket_hash=?`, hashToken(ticket)); err != nil {
		return AuthResult{}, fmt.Errorf("consume SSO ticket: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return AuthResult{}, fmt.Errorf("commit SSO ticket: %w", err)
	}
	if user.CreatedAt, err = parseTime(createdAt); err != nil {
		return AuthResult{}, err
	}
	if user.UpdatedAt, err = parseTime(updatedAt); err != nil {
		return AuthResult{}, err
	}
	user, err = s.loadProperties(ctx, user)
	if err != nil {
		return AuthResult{}, err
	}
	return s.createSession(ctx, user)
}

func (s *Store) Signup(ctx context.Context, input SignupInput) (AuthResult, error) {
	if s.disableSignup {
		return AuthResult{}, ErrSignupDisabled
	}
	email, err := normalizeEmail(input.Email)
	if err != nil {
		return AuthResult{}, err
	}
	if input.Password == "" || input.PasswordConfirm == "" {
		return AuthResult{}, fmt.Errorf("%w: email and password are required", ErrInvalidInput)
	}
	if input.Password != input.PasswordConfirm {
		return AuthResult{}, fmt.Errorf("%w: passwords do not match", ErrInvalidInput)
	}
	if err := validatePassword(input.Password); err != nil {
		return AuthResult{}, err
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		name = defaultName(email)
	}
	if len(name) > 200 {
		return AuthResult{}, fmt.Errorf("%w: name is too long", ErrInvalidInput)
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(input.Password), s.passwordCost)
	if err != nil {
		return AuthResult{}, fmt.Errorf("hash password: %w", err)
	}
	userID, err := randomID(16)
	if err != nil {
		return AuthResult{}, err
	}
	now := s.now().Format(time.RFC3339Nano)
	_, err = s.db.ExecContext(ctx, `INSERT INTO auth_users(id,email,name,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?)`, userID, email, name, string(hash), now, now)
	if err != nil {
		if isUniqueConstraint(err) {
			return AuthResult{}, ErrEmailExists
		}
		return AuthResult{}, fmt.Errorf("create user: %w", err)
	}
	user, err := s.loadProperties(ctx, User{ID: userID, Email: email, Name: name, CreatedAt: s.now().UTC(), UpdatedAt: s.now().UTC()})
	if err != nil {
		return AuthResult{}, err
	}
	return AuthResult{User: user}, nil
}

func (s *Store) Login(ctx context.Context, email, password string, totp ...string) (AuthResult, error) {
	normalized, err := normalizeEmail(email)
	if err != nil || password == "" {
		return AuthResult{}, ErrInvalidCredentials
	}
	var user User
	var hash, createdAt, updatedAt string
	var passwordLoginEnabled int
	var totpSecretCipher []byte
	err = s.db.QueryRowContext(ctx, `SELECT id,email,name,password_hash,created_at,updated_at,totp_secret_cipher,password_login_enabled FROM auth_users WHERE email = ? COLLATE NOCASE`, normalized).
		Scan(&user.ID, &user.Email, &user.Name, &hash, &createdAt, &updatedAt, &totpSecretCipher, &passwordLoginEnabled)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return AuthResult{}, ErrInvalidCredentials
		}
		return AuthResult{}, fmt.Errorf("find user: %w", err)
	}
	if passwordLoginEnabled == 0 || bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) != nil {
		return AuthResult{}, ErrInvalidCredentials
	}
	if len(totpSecretCipher) > 0 {
		code := ""
		if len(totp) > 0 {
			code = totp[0]
		}
		if err := s.verifyTOTP(totpSecretCipher, code); err != nil {
			return AuthResult{}, err
		}
	}
	user.CreatedAt, err = parseTime(createdAt)
	if err != nil {
		return AuthResult{}, err
	}
	user.UpdatedAt, err = parseTime(updatedAt)
	if err != nil {
		return AuthResult{}, err
	}
	user, err = s.loadProperties(ctx, user)
	if err != nil {
		return AuthResult{}, err
	}
	return s.createSession(ctx, user)
}

// SetTOTPSecret stores an account's base32 TOTP secret using the configured
// authenticated-encryption key. Passing an empty value disables TOTP.
func (s *Store) SetTOTPSecret(ctx context.Context, userID, secret string) error {
	if strings.TrimSpace(userID) == "" {
		return ErrUnauthorized
	}
	var encrypted any
	if strings.TrimSpace(secret) != "" {
		normalized, _, err := decodeTOTPSecret(secret)
		if err != nil {
			return fmt.Errorf("%w: TOTP secret is invalid", ErrInvalidInput)
		}
		ciphertext, err := s.totpProtector.Protect([]byte(normalized))
		if err != nil {
			return fmt.Errorf("encrypt TOTP secret: %w", err)
		}
		encrypted = ciphertext
	}
	result, err := s.db.ExecContext(ctx, `UPDATE auth_users SET totp_secret_cipher=?,updated_at=? WHERE id=?`, encrypted, s.now().Format(time.RFC3339Nano), userID)
	if err != nil {
		return fmt.Errorf("save TOTP secret: %w", err)
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return ErrUnauthorized
	}
	return nil
}

func (s *Store) verifyTOTP(ciphertext []byte, code string) error {
	if strings.TrimSpace(code) == "" {
		return ErrTOTPRequired
	}
	if len(code) != 6 {
		return ErrInvalidTOTP
	}
	for _, digit := range code {
		if digit < '0' || digit > '9' {
			return ErrInvalidTOTP
		}
	}
	secret, err := s.totpProtector.Reveal(ciphertext)
	if err != nil {
		return fmt.Errorf("decrypt TOTP secret: %w", err)
	}
	_, decoded, err := decodeTOTPSecret(string(secret))
	if err != nil {
		return fmt.Errorf("stored TOTP secret is invalid: %w", err)
	}
	current := s.now().Unix() / 30
	for step := current - 1; step <= current+1; step++ {
		candidate := totpCode(decoded, step)
		if hmac.Equal([]byte(candidate), []byte(code)) {
			return nil
		}
	}
	return ErrInvalidTOTP
}

func decodeTOTPSecret(secret string) (string, []byte, error) {
	normalized := strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(secret), " ", ""))
	if normalized == "" || len(normalized) > 256 {
		return "", nil, errors.New("invalid secret length")
	}
	decoded, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(strings.TrimRight(normalized, "="))
	if err != nil || len(decoded) < 10 {
		return "", nil, errors.New("invalid base32 secret")
	}
	return strings.TrimRight(normalized, "="), decoded, nil
}

func totpCode(secret []byte, step int64) string {
	var counter [8]byte
	for i := len(counter) - 1; i >= 0; i-- {
		counter[i] = byte(step)
		step >>= 8
	}
	hash := hmac.New(sha1.New, secret)
	_, _ = hash.Write(counter[:])
	digest := hash.Sum(nil)
	offset := digest[len(digest)-1] & 0x0f
	value := (uint32(digest[offset])&0x7f)<<24 |
		(uint32(digest[offset+1])&0xff)<<16 |
		(uint32(digest[offset+2])&0xff)<<8 |
		(uint32(digest[offset+3]) & 0xff)
	return fmt.Sprintf("%06d", value%1_000_000)
}

// Validate checks token validity, refreshes last-seen time, and returns only
// public identity/session fields.
func (s *Store) Validate(ctx context.Context, token string) (User, Session, error) {
	if !strings.HasPrefix(token, "dws_") || len(token) > 128 {
		return User{}, Session{}, ErrUnauthorized
	}
	var user User
	var session Session
	var createdAt, updatedAt, sessionCreated, expiresAt, lastSeen string
	err := s.db.QueryRowContext(ctx, `
		SELECT u.id,u.email,u.name,u.created_at,u.updated_at,s.id,s.display_name,s.client_type,s.platform,s.created_at,s.expires_at,s.last_seen_at
		FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id
		WHERE s.token_hash=? AND s.revoked_at IS NULL
	`, hashToken(token)).Scan(&user.ID, &user.Email, &user.Name, &createdAt, &updatedAt, &session.ID, &session.DisplayName, &session.ClientType, &session.Platform, &sessionCreated, &expiresAt, &lastSeen)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return User{}, Session{}, ErrUnauthorized
		}
		return User{}, Session{}, fmt.Errorf("validate session: %w", err)
	}
	user.CreatedAt, err = parseTime(createdAt)
	if err != nil {
		return User{}, Session{}, err
	}
	user.UpdatedAt, err = parseTime(updatedAt)
	if err != nil {
		return User{}, Session{}, err
	}
	user, err = s.loadProperties(ctx, user)
	if err != nil {
		return User{}, Session{}, err
	}
	session.CreatedAt, err = parseTime(sessionCreated)
	if err != nil {
		return User{}, Session{}, err
	}
	session.ExpiresAt, err = parseTime(expiresAt)
	if err != nil {
		return User{}, Session{}, err
	}
	session.LastSeen, err = parseTime(lastSeen)
	if err != nil {
		return User{}, Session{}, err
	}
	if !session.ExpiresAt.After(s.now()) || !session.LastSeen.Add(30*24*time.Hour).After(s.now()) {
		return User{}, Session{}, ErrUnauthorized
	}
	updated := s.now().UTC().Format(time.RFC3339Nano)
	if _, err := s.db.ExecContext(ctx, `UPDATE auth_sessions SET last_seen_at=? WHERE id=? AND revoked_at IS NULL`, updated, session.ID); err != nil {
		return User{}, Session{}, fmt.Errorf("refresh session: %w", err)
	}
	session.UserID = user.ID
	session.SessionID = session.ID
	session.LastSeen = s.now().UTC()
	return user, session, nil
}

func (s *Store) Logout(ctx context.Context, userID, sessionID string) error {
	if userID == "" || sessionID == "" {
		return ErrUnauthorized
	}
	result, err := s.db.ExecContext(ctx, `UPDATE auth_sessions SET revoked_at=? WHERE user_id=? AND id=? AND revoked_at IS NULL`, s.now().UTC().Format(time.RFC3339Nano), userID, sessionID)
	if err != nil {
		return fmt.Errorf("revoke session: %w", err)
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return ErrUnauthorized
	}
	return nil
}

func (s *Store) ListSessions(ctx context.Context, userID string) ([]Session, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id,user_id,display_name,client_type,platform,created_at,expires_at,last_seen_at
		FROM auth_sessions WHERE user_id=? AND revoked_at IS NULL AND expires_at>? AND last_seen_at>? ORDER BY last_seen_at DESC
	`, userID, s.now().Format(time.RFC3339Nano), s.now().Add(-30*24*time.Hour).Format(time.RFC3339Nano))
	if err != nil {
		return nil, fmt.Errorf("list sessions: %w", err)
	}
	defer rows.Close()
	sessions := make([]Session, 0)
	for rows.Next() {
		var session Session
		var createdAt, expiresAt, lastSeen string
		if err := rows.Scan(&session.ID, &session.UserID, &session.DisplayName, &session.ClientType, &session.Platform, &createdAt, &expiresAt, &lastSeen); err != nil {
			return nil, fmt.Errorf("read session: %w", err)
		}
		session.SessionID = session.ID
		if session.CreatedAt, err = parseTime(createdAt); err != nil {
			return nil, err
		}
		if session.ExpiresAt, err = parseTime(expiresAt); err != nil {
			return nil, err
		}
		if session.LastSeen, err = parseTime(lastSeen); err != nil {
			return nil, err
		}
		sessions = append(sessions, session)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate sessions: %w", err)
	}
	return sessions, nil
}

// HasActiveSession reports whether the user currently holds a live
// (non-revoked, unexpired) session with the given ID. Routed shortcut actions
// use it to verify the target session before delivering work over its
// websocket, matching the TypeScript getSessionById lookup.
func (s *Store) HasActiveSession(ctx context.Context, userID, sessionID string) (bool, error) {
	if userID == "" || sessionID == "" {
		return false, nil
	}
	var count int
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(1) FROM auth_sessions WHERE user_id=? AND id=? AND revoked_at IS NULL AND expires_at>?`,
		userID, sessionID, s.now().UTC().Format(time.RFC3339Nano),
	).Scan(&count); err != nil {
		return false, fmt.Errorf("check session: %w", err)
	}
	return count > 0, nil
}

func (s *Store) RenameSession(ctx context.Context, userID, sessionID, displayName string) (Session, error) {
	displayName = strings.TrimSpace(displayName)
	if len(displayName) < 1 || len(displayName) > 100 {
		return Session{}, fmt.Errorf("%w: display name must be between 1 and 100 characters", ErrInvalidInput)
	}
	now := s.now().UTC().Format(time.RFC3339Nano)
	result, err := s.db.ExecContext(ctx, `UPDATE auth_sessions SET display_name=?,last_seen_at=? WHERE user_id=? AND id=? AND revoked_at IS NULL`, displayName, now, userID, sessionID)
	if err != nil {
		return Session{}, fmt.Errorf("rename session: %w", err)
	}
	count, err := result.RowsAffected()
	if err != nil {
		return Session{}, err
	}
	if count == 0 {
		return Session{}, ErrUnauthorized
	}
	var session Session
	var createdAt, expiresAt, lastSeen string
	err = s.db.QueryRowContext(ctx, `SELECT id,user_id,display_name,client_type,platform,created_at,expires_at,last_seen_at FROM auth_sessions WHERE user_id=? AND id=?`, userID, sessionID).Scan(&session.ID, &session.UserID, &session.DisplayName, &session.ClientType, &session.Platform, &createdAt, &expiresAt, &lastSeen)
	if err != nil {
		return Session{}, fmt.Errorf("load renamed session: %w", err)
	}
	session.SessionID = session.ID
	if session.CreatedAt, err = parseTime(createdAt); err != nil {
		return Session{}, err
	}
	if session.ExpiresAt, err = parseTime(expiresAt); err != nil {
		return Session{}, err
	}
	if session.LastSeen, err = parseTime(lastSeen); err != nil {
		return Session{}, err
	}
	return session, nil
}

func (s *Store) ChangePassword(ctx context.Context, userID string, input PasswordChangeInput) error {
	if userID == "" {
		return ErrUnauthorized
	}
	email, err := normalizeEmail(input.Email)
	if err != nil {
		return err
	}
	if input.NewPassword == "" || input.PasswordConfirm == "" || input.NewPassword != input.PasswordConfirm {
		return fmt.Errorf("%w: new passwords do not match", ErrInvalidInput)
	}
	if err := validatePassword(input.NewPassword); err != nil {
		return err
	}
	var currentEmail, currentHash string
	var passwordLoginEnabled int
	if err := s.db.QueryRowContext(ctx, `SELECT email,password_hash,password_login_enabled FROM auth_users WHERE id=?`, userID).Scan(&currentEmail, &currentHash, &passwordLoginEnabled); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrUnauthorized
		}
		return fmt.Errorf("load user password: %w", err)
	}
	if !strings.EqualFold(currentEmail, email) || (passwordLoginEnabled != 0 && bcrypt.CompareHashAndPassword([]byte(currentHash), []byte(input.OldPassword)) != nil) {
		return ErrInvalidCredentials
	}
	newHash, err := bcrypt.GenerateFromPassword([]byte(input.NewPassword), s.passwordCost)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}
	now := s.now().UTC().Format(time.RFC3339Nano)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `UPDATE auth_users SET password_hash=?,password_login_enabled=1,updated_at=? WHERE id=?`, string(newHash), now, userID); err != nil {
		return fmt.Errorf("update password: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE auth_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL`, now, userID); err != nil {
		return fmt.Errorf("revoke user sessions: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit password change: %w", err)
	}
	return nil
}

func (s *Store) UserByID(ctx context.Context, id string) (User, error) {
	var user User
	var createdAt, updatedAt string
	err := s.db.QueryRowContext(ctx, `SELECT id,email,name,created_at,updated_at FROM auth_users WHERE id=?`, id).Scan(&user.ID, &user.Email, &user.Name, &createdAt, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrUnauthorized
	}
	if err != nil {
		return User{}, fmt.Errorf("load user: %w", err)
	}
	user.CreatedAt, err = parseTime(createdAt)
	if err != nil {
		return User{}, err
	}
	user.UpdatedAt, err = parseTime(updatedAt)
	if err != nil {
		return User{}, err
	}
	return s.loadProperties(ctx, user)
}

// ListUserIDs returns the account IDs needed by internal maintenance workers.
// It deliberately does not expose email, credentials, or profile properties.
func (s *Store) ListUserIDs(ctx context.Context) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id FROM auth_users ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("list account IDs: %w", err)
	}
	defer rows.Close()
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// DeleteAccount reauthenticates the account, removes all rows that contain an
// owner_id column in one SQLite transaction, and deletes the account row. Local
// wallpaper files are removed after commit; only generated wallpaper files in
// a wallpapers directory are eligible for removal.
func (s *Store) DeleteAccount(ctx context.Context, userID, email, password, totp string, sessionIDs ...string) error {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(email) == "" {
		return fmt.Errorf("%w: email is required", ErrInvalidInput)
	}
	var storedEmail, passwordHash string
	var passwordLoginEnabled int
	var totpSecretCipher []byte
	if err := s.db.QueryRowContext(ctx, `SELECT email,password_hash,totp_secret_cipher,password_login_enabled FROM auth_users WHERE id=?`, userID).Scan(&storedEmail, &passwordHash, &totpSecretCipher, &passwordLoginEnabled); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrUnauthorized
		}
		return fmt.Errorf("load account for deletion: %w", err)
	}
	if !strings.EqualFold(strings.TrimSpace(email), storedEmail) || (passwordLoginEnabled != 0 && (password == "" || bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(password)) != nil)) {
		return ErrInvalidCredentials
	}
	if passwordLoginEnabled == 0 {
		if len(sessionIDs) == 0 || strings.TrimSpace(sessionIDs[0]) == "" {
			return ErrRecentOIDCReauthRequired
		}
		if err := s.RequireRecentOIDCReauthentication(ctx, userID, sessionIDs[0]); err != nil {
			return err
		}
	}
	if len(totpSecretCipher) > 0 {
		if err := s.verifyTOTP(totpSecretCipher, totp); err != nil {
			return err
		}
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin account deletion: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	wallpaperPaths := []string{}
	if tableExists(ctx, tx, "wallpapers") {
		rows, err := tx.QueryContext(ctx, `SELECT path FROM wallpapers WHERE owner_id=?`, userID)
		if err != nil {
			return fmt.Errorf("read account wallpapers: %w", err)
		}
		for rows.Next() {
			var path string
			if err := rows.Scan(&path); err != nil {
				_ = rows.Close()
				return err
			}
			wallpaperPaths = append(wallpaperPaths, path)
		}
		if err := rows.Err(); err != nil {
			_ = rows.Close()
			return err
		}
		_ = rows.Close()
	}

	// Change events have no owner column; delete the index rows before removing
	// their owner-scoped resource records.
	if tableExists(ctx, tx, "change_events") && tableExists(ctx, tx, "resources") {
		if _, err := tx.ExecContext(ctx, `DELETE FROM change_events WHERE resource_id IN (SELECT id FROM resources WHERE owner_id=?)`, userID); err != nil {
			return fmt.Errorf("delete account resource change history: %w", err)
		}
	}
	tables, err := ownerTables(ctx, tx)
	if err != nil {
		return err
	}
	for _, table := range tables {
		query := `DELETE FROM "` + strings.ReplaceAll(table, `"`, `""`) + `" WHERE owner_id=?`
		if _, err := tx.ExecContext(ctx, query, userID); err != nil {
			return fmt.Errorf("delete account data from %s: %w", table, err)
		}
	}
	if tableExists(ctx, tx, "device_auth_requests") {
		if _, err := tx.ExecContext(ctx, `DELETE FROM device_auth_requests WHERE approved_user_id=?`, userID); err != nil {
			return fmt.Errorf("delete account device authorization records: %w", err)
		}
	}
	result, err := tx.ExecContext(ctx, `DELETE FROM auth_users WHERE id=?`, userID)
	if err != nil {
		return fmt.Errorf("delete account identity: %w", err)
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count != 1 {
		return ErrUnauthorized
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit account deletion: %w", err)
	}
	for _, path := range wallpaperPaths {
		if !isGeneratedWallpaperPath(path) {
			continue
		}
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("remove account wallpaper file: %w", err)
		}
	}
	return nil
}

func ownerTables(ctx context.Context, tx *sql.Tx) ([]string, error) {
	rows, err := tx.QueryContext(ctx, `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
	if err != nil {
		return nil, fmt.Errorf("list account data tables: %w", err)
	}
	names := []string{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			_ = rows.Close()
			return nil, err
		}
		names = append(names, name)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	_ = rows.Close()
	out := []string{}
	for _, name := range names {
		columns, err := tx.QueryContext(ctx, `PRAGMA table_info("`+strings.ReplaceAll(name, `"`, `""`)+`")`)
		if err != nil {
			return nil, fmt.Errorf("inspect account data table %s: %w", name, err)
		}
		for columns.Next() {
			var cid, notNull, primaryKey int
			var column, columnType string
			var defaultValue any
			if err := columns.Scan(&cid, &column, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
				_ = columns.Close()
				return nil, err
			}
			if column == "owner_id" {
				out = append(out, name)
				break
			}
		}
		if err := columns.Err(); err != nil {
			_ = columns.Close()
			return nil, err
		}
		_ = columns.Close()
	}
	return out, nil
}

func tableExists(ctx context.Context, tx *sql.Tx, name string) bool {
	var found int
	return tx.QueryRowContext(ctx, `SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`, name).Scan(&found) == nil
}

func isGeneratedWallpaperPath(path string) bool {
	if filepath.Base(filepath.Dir(path)) != "wallpapers" || !strings.HasPrefix(filepath.Base(path), "wallpaper-") {
		return false
	}
	return filepath.IsAbs(path)
}

func (s *Store) UpdateUserProperty(ctx context.Context, userID, propertyName string, value any) (User, error) {
	switch propertyName {
	case "appearancePreferences", "localizationPreferences", "screensaverPreferences", "searchPreferences", "newsPreferences", "global":
	default:
		return User{}, fmt.Errorf("%w: property %q cannot be changed", ErrInvalidInput, propertyName)
	}
	if userID == "" {
		return User{}, ErrUnauthorized
	}
	if propertyName == "newsPreferences" && value != nil {
		preferences, ok := value.(map[string]any)
		if !ok {
			return User{}, fmt.Errorf("%w: newsPreferences must be an object or null", ErrInvalidInput)
		}
		if destination, ok := preferences["defaultNewsPage"]; ok {
			path, ok := destination.(string)
			if !ok || len(path) > 512 || !strings.HasPrefix(path, "/apps/news/") || strings.ContainsAny(path, "?#\\") {
				return User{}, fmt.Errorf("%w: defaultNewsPage is invalid", ErrInvalidInput)
			}
		}
	}
	encoded, err := json.Marshal(value)
	if err != nil || len(encoded) > 1<<20 {
		return User{}, fmt.Errorf("%w: user property value is invalid or too large", ErrInvalidInput)
	}
	now := s.now().Format(time.RFC3339Nano)
	_, err = s.db.ExecContext(ctx, `INSERT INTO auth_user_properties(user_id,property_name,property_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id,property_name) DO UPDATE SET property_json=excluded.property_json,updated_at=excluded.updated_at`, userID, propertyName, string(encoded), now)
	if err != nil {
		return User{}, fmt.Errorf("update user property: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE auth_users SET updated_at=? WHERE id=?`, now, userID); err != nil {
		return User{}, fmt.Errorf("update user timestamp: %w", err)
	}
	return s.UserByID(ctx, userID)
}

func (s *Store) loadProperties(ctx context.Context, user User) (User, error) {
	var passwordLoginEnabled int
	if err := s.db.QueryRowContext(ctx, `SELECT password_login_enabled FROM auth_users WHERE id=?`, user.ID).Scan(&passwordLoginEnabled); err != nil {
		return User{}, fmt.Errorf("load user authentication methods: %w", err)
	}
	user.ExternalOnly = passwordLoginEnabled == 0
	rows, err := s.db.QueryContext(ctx, `SELECT property_name,property_json FROM auth_user_properties WHERE user_id=?`, user.ID)
	if err != nil {
		return User{}, fmt.Errorf("load user properties: %w", err)
	}
	defer rows.Close()
	user.Properties = make(map[string]any)
	for rows.Next() {
		var name, encoded string
		var value any
		if err := rows.Scan(&name, &encoded); err != nil {
			return User{}, err
		}
		if err := json.Unmarshal([]byte(encoded), &value); err != nil {
			return User{}, fmt.Errorf("decode user property %q: %w", name, err)
		}
		user.Properties[name] = value
	}
	if err := rows.Err(); err != nil {
		return User{}, err
	}
	return user, nil
}

func (s *Store) createSession(ctx context.Context, user User) (AuthResult, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return AuthResult{}, fmt.Errorf("generate session token: %w", err)
	}
	token := "dws_" + base64.RawURLEncoding.EncodeToString(bytes)
	sessionID, err := randomID(16)
	if err != nil {
		return AuthResult{}, err
	}
	now := s.now().UTC()
	expires := now.Add(s.sessionTTL)
	_, err = s.db.ExecContext(ctx, `INSERT INTO auth_sessions(id,user_id,token_hash,display_name,client_type,created_at,expires_at,last_seen_at) VALUES(?,?,?,'Web browser','browser',?,?,?)`, sessionID, user.ID, hashToken(token), now.Format(time.RFC3339Nano), expires.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano))
	if err != nil {
		return AuthResult{}, fmt.Errorf("create session: %w", err)
	}
	return AuthResult{Token: token, SessionID: sessionID, User: user}, nil
}

func normalizeEmail(value string) (string, error) {
	value = strings.TrimSpace(strings.ToLower(value))
	if len(value) > 320 || value == "" {
		return "", fmt.Errorf("%w: valid email is required", ErrInvalidInput)
	}
	parsed, err := mail.ParseAddress(value)
	if err != nil || parsed.Address != value || !strings.Contains(value, "@") {
		return "", fmt.Errorf("%w: valid email is required", ErrInvalidInput)
	}
	return value, nil
}

func validatePassword(password string) error {
	if len(password) < 8 {
		return fmt.Errorf("%w: password must be at least 8 characters", ErrInvalidInput)
	}
	if len(password) > 72 {
		return fmt.Errorf("%w: password exceeds bcrypt's 72-byte limit", ErrInvalidInput)
	}
	return nil
}

func defaultName(email string) string {
	part := strings.SplitN(email, "@", 2)[0]
	part = strings.NewReplacer(".", " ", "_", " ", "-", " ").Replace(part)
	return strings.TrimSpace(part)
}

func randomID(size int) (string, error) {
	bytes := make([]byte, size)
	if _, err := rand.Read(bytes); err != nil {
		return "", fmt.Errorf("generate random identifier: %w", err)
	}
	return hex.EncodeToString(bytes), nil
}

func hashToken(token string) string {
	hash := sha256.Sum256([]byte(token))
	return hex.EncodeToString(hash[:])
}

func parseTime(value string) (time.Time, error) {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return time.Time{}, fmt.Errorf("parse stored timestamp: %w", err)
	}
	return parsed, nil
}

func (s *Store) now() time.Time { return s.clock().UTC() }

func isUniqueConstraint(err error) bool {
	return strings.Contains(strings.ToLower(err.Error()), "unique constraint")
}

func ensureSessionColumn(ctx context.Context, tx *sql.Tx, name, definition string) error {
	rows, err := tx.QueryContext(ctx, `PRAGMA table_info(auth_sessions)`)
	if err != nil {
		return err
	}
	found := false
	for rows.Next() {
		var cid int
		var columnName, columnType string
		var notNull, primaryKey int
		var defaultValue any
		if err := rows.Scan(&cid, &columnName, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			_ = rows.Close()
			return err
		}
		if columnName == name {
			found = true
		}
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if found {
		return nil
	}
	_, err = tx.ExecContext(ctx, `ALTER TABLE auth_sessions ADD COLUMN `+name+` `+definition)
	return err
}

func ensureColumn(ctx context.Context, tx *sql.Tx, table, name, definition string) error {
	quotedTable := strings.ReplaceAll(table, `"`, `""`)
	rows, err := tx.QueryContext(ctx, `PRAGMA table_info("`+quotedTable+`")`)
	if err != nil {
		return err
	}
	found := false
	for rows.Next() {
		var cid int
		var columnName, columnType string
		var notNull, primaryKey int
		var defaultValue any
		if err := rows.Scan(&cid, &columnName, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			_ = rows.Close()
			return err
		}
		if columnName == name {
			found = true
		}
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if found {
		return nil
	}
	quotedName := strings.ReplaceAll(name, `"`, `""`)
	_, err = tx.ExecContext(ctx, `ALTER TABLE "`+quotedTable+`" ADD COLUMN "`+quotedName+`" `+definition)
	return err
}
