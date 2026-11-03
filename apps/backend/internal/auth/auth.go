// Package auth provides SQLite-backed user authentication for the Go backend.
// Session bearer tokens are only returned once and are stored as SHA-256 hashes.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"time"

	"github.com/andreasmolnardev/dashwise/packages/foundation"
	"golang.org/x/crypto/bcrypt"
)

var (
	ErrSignupDisabled     = errors.New("signup is disabled")
	ErrInvalidCredentials = errors.New("invalid email or password")
	ErrEmailExists        = errors.New("email is already registered")
	ErrInvalidInput       = errors.New("invalid authentication input")
	ErrUnauthorized       = errors.New("unauthorized")
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
}

type User struct {
	ID         string         `json:"id"`
	Email      string         `json:"email"`
	Name       string         `json:"name"`
	CreatedAt  time.Time      `json:"createdAt"`
	UpdatedAt  time.Time      `json:"updatedAt"`
	Properties map[string]any `json:"-"`
}

func (u User) MarshalJSON() ([]byte, error) {
	record := map[string]any{"id": u.ID, "email": u.Email, "name": u.Name, "createdAt": u.CreatedAt, "updatedAt": u.UpdatedAt}
	for name, value := range u.Properties {
		record[name] = value
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
	return &Store{
		db: db.SQL(), foundation: db, disableSignup: options.DisableSignup,
		sessionTTL: options.SessionTTL, passwordCost: options.PasswordCost,
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
			updated_at TEXT NOT NULL
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
			return nil
		},
		Down: func(ctx context.Context, tx *sql.Tx) error {
			_, err := tx.ExecContext(ctx, `DROP TABLE IF EXISTS auth_user_properties; DROP TABLE IF EXISTS auth_sessions; DROP TABLE IF EXISTS auth_users;`)
			return err
		},
	}})
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

func (s *Store) Login(ctx context.Context, email, password string) (AuthResult, error) {
	normalized, err := normalizeEmail(email)
	if err != nil || password == "" {
		return AuthResult{}, ErrInvalidCredentials
	}
	var user User
	var hash, createdAt, updatedAt string
	err = s.db.QueryRowContext(ctx, `SELECT id,email,name,password_hash,created_at,updated_at FROM auth_users WHERE email = ? COLLATE NOCASE`, normalized).
		Scan(&user.ID, &user.Email, &user.Name, &hash, &createdAt, &updatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return AuthResult{}, ErrInvalidCredentials
		}
		return AuthResult{}, fmt.Errorf("find user: %w", err)
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) != nil {
		return AuthResult{}, ErrInvalidCredentials
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
	if err := s.db.QueryRowContext(ctx, `SELECT email,password_hash FROM auth_users WHERE id=?`, userID).Scan(&currentEmail, &currentHash); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrUnauthorized
		}
		return fmt.Errorf("load user password: %w", err)
	}
	if !strings.EqualFold(currentEmail, email) || bcrypt.CompareHashAndPassword([]byte(currentHash), []byte(input.OldPassword)) != nil {
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
	if _, err := tx.ExecContext(ctx, `UPDATE auth_users SET password_hash=?,updated_at=? WHERE id=?`, string(newHash), now, userID); err != nil {
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

func (s *Store) UpdateUserProperty(ctx context.Context, userID, propertyName string, value any) (User, error) {
	switch propertyName {
	case "appearancePreferences", "localizationPreferences", "screensaverPreferences", "searchPreferences", "global":
	default:
		return User{}, fmt.Errorf("%w: property %q cannot be changed", ErrInvalidInput, propertyName)
	}
	if userID == "" {
		return User{}, ErrUnauthorized
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
