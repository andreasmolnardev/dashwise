// Package deviceauth implements short-lived device authorization requests.
package deviceauth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net"
	"regexp"
	"strings"
	"time"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/auth"
	"github.com/andreasmolnardev/dashwise/packages/foundation"
)

const (
	DefaultTTL        = 5 * time.Minute
	maxPending        = 1000
	maxSockets        = 500
	maxCreatePerMin   = 10
	maxEntryPerMinute = 20
)

var codePattern = regexp.MustCompile(`^[A-Z0-9]{3}-[A-Z0-9]{3}$`)
var codeAlphabet = []byte("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")

var (
	ErrInvalidCode = errors.New("invalid or expired device code")
	ErrRateLimited = errors.New("too many device login requests")
	ErrUnavailable = errors.New("device login is temporarily unavailable")
)

type Store struct {
	db   *foundation.DB
	auth *auth.Store
	ttl  time.Duration
	now  func() time.Time
}

type DeviceRequest struct {
	ID        string    `json:"id"`
	Code      string    `json:"code"`
	CreatedAt time.Time `json:"createdAt"`
	ExpiresAt time.Time `json:"expiresAt"`
	IP        string    `json:"ip"`
	UserAgent string    `json:"userAgent"`
}

type CreatedRequest struct {
	ID        string    `json:"requestId"`
	Code      string    `json:"code"`
	Secret    string    `json:"secret"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type Approved struct {
	Token     string    `json:"token"`
	SessionID string    `json:"sessionId"`
	User      auth.User `json:"user"`
}

func New(db *foundation.DB, authStore *auth.Store, ttl time.Duration) (*Store, error) {
	if db == nil || db.SQL() == nil || authStore == nil {
		return nil, errors.New("device auth requires an open database and auth store")
	}
	if ttl <= 0 || ttl > 30*time.Minute {
		ttl = DefaultTTL
	}
	return &Store{db: db, auth: authStore, ttl: ttl, now: time.Now}, nil
}

func (s *Store) Initialize(ctx context.Context) error {
	if err := s.db.ApplyMigrations(ctx, []foundation.Migration{{ID: "0016_device_auth", Name: "short-lived device authorization requests", Up: func(ctx context.Context, tx *sql.Tx) error {
		for _, q := range []string{
			`CREATE TABLE IF NOT EXISTS device_auth_requests(id TEXT PRIMARY KEY NOT NULL,code_hash TEXT NOT NULL UNIQUE,secret_hash BLOB NOT NULL,ip TEXT NOT NULL,user_agent TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',socket_authenticated INTEGER NOT NULL DEFAULT 0,approved_user_id TEXT NOT NULL DEFAULT '')`,
			`CREATE INDEX IF NOT EXISTS device_auth_by_expiry ON device_auth_requests(expires_at,status)`,
			`CREATE TABLE IF NOT EXISTS device_auth_rate_events(id INTEGER PRIMARY KEY AUTOINCREMENT,ip TEXT NOT NULL,operation TEXT NOT NULL,occurred_at TEXT NOT NULL)`,
			`CREATE INDEX IF NOT EXISTS device_auth_rate_by_ip_time ON device_auth_rate_events(ip,operation,occurred_at)`,
		} {
			if _, err := tx.ExecContext(ctx, q); err != nil {
				return err
			}
		}
		return nil
	}}}); err != nil {
		return err
	}
	// Pending sockets do not survive a process restart. Invalidate their codes
	// so an approver cannot receive a misleading success for a disconnected device.
	_, err := s.db.SQL().ExecContext(ctx, `UPDATE device_auth_requests SET status='cancelled' WHERE status='pending'`)
	return err
}

func (s *Store) Create(ctx context.Context, socketCount int, ip, userAgent string) (CreatedRequest, error) {
	if socketCount >= maxSockets {
		return CreatedRequest{}, ErrUnavailable
	}
	now := s.now().UTC()
	if err := s.enforceRate(ctx, ip, "create", maxCreatePerMin, now); err != nil {
		return CreatedRequest{}, err
	}
	if _, err := s.db.SQL().ExecContext(ctx, `DELETE FROM device_auth_requests WHERE expires_at<=? OR status!='pending'`, now.Format(time.RFC3339Nano)); err != nil {
		return CreatedRequest{}, err
	}
	var active int
	if err := s.db.SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM device_auth_requests WHERE status='pending' AND expires_at>?`, now.Format(time.RFC3339Nano)).Scan(&active); err != nil {
		return CreatedRequest{}, err
	}
	if active >= maxPending {
		return CreatedRequest{}, ErrUnavailable
	}
	id, err := randomText(16)
	if err != nil {
		return CreatedRequest{}, err
	}
	secretBytes := make([]byte, 32)
	if _, err := rand.Read(secretBytes); err != nil {
		return CreatedRequest{}, err
	}
	secret := base64.RawURLEncoding.EncodeToString(secretBytes)
	code, err := s.uniqueCode(ctx)
	if err != nil {
		return CreatedRequest{}, err
	}
	expires := now.Add(s.ttl)
	_, err = s.db.SQL().ExecContext(ctx, `INSERT INTO device_auth_requests(id,code_hash,secret_hash,ip,user_agent,created_at,expires_at,status) VALUES(?,?,?,?,?,?,?,'pending')`, id, hash(code), hashBytes([]byte(secret)), normalizeIP(ip), truncate(userAgent, 300), now.Format(time.RFC3339Nano), expires.Format(time.RFC3339Nano))
	if err != nil {
		return CreatedRequest{}, err
	}
	return CreatedRequest{ID: id, Code: code, Secret: secret, ExpiresAt: expires}, nil
}

func (s *Store) Lookup(ctx context.Context, code, ip string) (DeviceRequest, error) {
	if err := s.enforceRate(ctx, ip, "entry", maxEntryPerMinute, s.now().UTC()); err != nil {
		return DeviceRequest{}, ErrInvalidCode
	}
	return s.find(ctx, code)
}

func (s *Store) Approve(ctx context.Context, code, ip, userID, approverSessionID, userAgent string) (Approved, error) {
	if userID == "" {
		return Approved{}, auth.ErrUnauthorized
	}
	if err := s.enforceRate(ctx, ip, "entry", maxEntryPerMinute, s.now().UTC()); err != nil {
		return Approved{}, ErrInvalidCode
	}
	request, err := s.find(ctx, code)
	if err != nil {
		return Approved{}, err
	}
	var authenticated int
	if err := s.db.SQL().QueryRowContext(ctx, `SELECT socket_authenticated FROM device_auth_requests WHERE id=? AND status='pending'`, request.ID).Scan(&authenticated); err != nil || authenticated == 0 {
		return Approved{}, ErrInvalidCode
	}
	user, err := s.auth.UserByID(ctx, userID)
	if err != nil {
		return Approved{}, auth.ErrUnauthorized
	}
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return Approved{}, err
	}
	token := "dws_" + base64.RawURLEncoding.EncodeToString(tokenBytes)
	sessionID, err := randomText(16)
	if err != nil {
		return Approved{}, err
	}
	now := s.now().UTC()
	expires := now.Add(auth.DefaultSessionLifetime)
	platform := truncate(userAgent, 300)
	tx, err := s.db.SQL().BeginTx(ctx, nil)
	if err != nil {
		return Approved{}, err
	}
	defer func() { _ = tx.Rollback() }()
	result, err := tx.ExecContext(ctx, `UPDATE device_auth_requests SET status='approved',approved_user_id=? WHERE id=? AND status='pending' AND socket_authenticated=1 AND expires_at>?`, userID, request.ID, now.Format(time.RFC3339Nano))
	if err != nil {
		return Approved{}, err
	}
	count, _ := result.RowsAffected()
	if count != 1 {
		return Approved{}, ErrInvalidCode
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO auth_sessions(id,user_id,token_hash,display_name,client_type,platform,created_at,expires_at,last_seen_at) VALUES(?,?,?,'Device login','device-code',?,?,?,?)`, sessionID, userID, hash(token), platform, now.Format(time.RFC3339Nano), expires.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano))
	if err != nil {
		return Approved{}, err
	}
	if err := tx.Commit(); err != nil {
		return Approved{}, err
	}
	_ = approverSessionID // reserved for future audit-event persistence
	return Approved{Token: token, SessionID: sessionID, User: user}, nil
}

func (s *Store) Cancel(ctx context.Context, code, ip string) (DeviceRequest, error) {
	if err := s.enforceRate(ctx, ip, "entry", maxEntryPerMinute, s.now().UTC()); err != nil {
		return DeviceRequest{}, ErrInvalidCode
	}
	request, err := s.find(ctx, code)
	if err != nil {
		return DeviceRequest{}, err
	}
	result, err := s.db.SQL().ExecContext(ctx, `UPDATE device_auth_requests SET status='cancelled' WHERE id=? AND status='pending'`, request.ID)
	if err != nil {
		return DeviceRequest{}, err
	}
	n, _ := result.RowsAffected()
	if n != 1 {
		return DeviceRequest{}, ErrInvalidCode
	}
	return request, nil
}

func (s *Store) AuthenticateSocket(ctx context.Context, id, secret string) bool {
	if id == "" || len(secret) < 20 || len(secret) > 128 {
		return false
	}
	var expected []byte
	var expires, status string
	err := s.db.SQL().QueryRowContext(ctx, `SELECT secret_hash,expires_at,status FROM device_auth_requests WHERE id=?`, id).Scan(&expected, &expires, &status)
	if err != nil || status != "pending" {
		return false
	}
	timeValue, err := time.Parse(time.RFC3339Nano, expires)
	if err != nil || !timeValue.After(s.now()) {
		return false
	}
	actual := hashBytes([]byte(secret))
	if len(expected) != len(actual) || subtle.ConstantTimeCompare(expected, actual) != 1 {
		return false
	}
	_, err = s.db.SQL().ExecContext(ctx, `UPDATE device_auth_requests SET socket_authenticated=1 WHERE id=? AND status='pending' AND expires_at>?`, id, s.now().UTC().Format(time.RFC3339Nano))
	return err == nil
}

func (s *Store) CloseRequest(ctx context.Context, id string) {
	_, _ = s.db.SQL().ExecContext(ctx, `UPDATE device_auth_requests SET status='cancelled' WHERE id=? AND status='pending'`, id)
}

func (s *Store) find(ctx context.Context, raw string) (DeviceRequest, error) {
	code := strings.ToUpper(strings.TrimSpace(raw))
	if !codePattern.MatchString(code) {
		return DeviceRequest{}, ErrInvalidCode
	}
	var item DeviceRequest
	var created, expires, status string
	err := s.db.SQL().QueryRowContext(ctx, `SELECT id,created_at,expires_at,ip,user_agent,status FROM device_auth_requests WHERE code_hash=?`, hash(code)).Scan(&item.ID, &created, &expires, &item.IP, &item.UserAgent, &status)
	if err != nil || status != "pending" {
		return DeviceRequest{}, ErrInvalidCode
	}
	item.Code = code
	item.CreatedAt, err = time.Parse(time.RFC3339Nano, created)
	if err != nil {
		return DeviceRequest{}, ErrInvalidCode
	}
	item.ExpiresAt, err = time.Parse(time.RFC3339Nano, expires)
	if err != nil || !item.ExpiresAt.After(s.now()) {
		return DeviceRequest{}, ErrInvalidCode
	}
	return item, nil
}

func (s *Store) uniqueCode(ctx context.Context) (string, error) {
	for i := 0; i < 20; i++ {
		raw := make([]byte, 6)
		if _, err := rand.Read(raw); err != nil {
			return "", err
		}
		var b strings.Builder
		for j, x := range raw {
			if j == 3 {
				b.WriteByte('-')
			}
			b.WriteByte(codeAlphabet[int(x)%len(codeAlphabet)])
		}
		code := b.String()
		var exists int
		err := s.db.SQL().QueryRowContext(ctx, `SELECT 1 FROM device_auth_requests WHERE code_hash=? AND expires_at>?`, hash(code), s.now().UTC().Format(time.RFC3339Nano)).Scan(&exists)
		if errors.Is(err, sql.ErrNoRows) {
			return code, nil
		}
		if err != nil {
			return "", err
		}
	}
	return "", errors.New("could not allocate a device code")
}
func (s *Store) enforceRate(ctx context.Context, ip, operation string, maximum int, now time.Time) error {
	ip = normalizeIP(ip)
	threshold := now.Add(-time.Minute).Format(time.RFC3339Nano)
	_, _ = s.db.SQL().ExecContext(ctx, `DELETE FROM device_auth_rate_events WHERE occurred_at<?`, now.Add(-time.Hour).Format(time.RFC3339Nano))
	var count int
	if err := s.db.SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM device_auth_rate_events WHERE ip=? AND operation=? AND occurred_at>?`, ip, operation, threshold).Scan(&count); err != nil {
		return err
	}
	if count >= maximum {
		return ErrRateLimited
	}
	_, err := s.db.SQL().ExecContext(ctx, `INSERT INTO device_auth_rate_events(ip,operation,occurred_at) VALUES(?,?,?)`, ip, operation, now.Format(time.RFC3339Nano))
	return err
}
func hash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
func hashBytes(value []byte) []byte { sum := sha256.Sum256(value); return sum[:] }
func randomText(size int) (string, error) {
	b := make([]byte, size)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
func normalizeIP(raw string) string {
	raw = strings.TrimSpace(strings.Split(raw, ",")[0])
	if host, _, err := net.SplitHostPort(raw); err == nil {
		raw = host
	}
	if parsed := net.ParseIP(raw); parsed != nil {
		return parsed.String()
	}
	if raw == "" {
		return "unknown"
	}
	return truncate(raw, 80)
}
func truncate(raw string, n int) string {
	if len(raw) > n {
		return raw[:n]
	}
	return raw
}
