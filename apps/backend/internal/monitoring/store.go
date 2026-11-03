// Package monitoring stores Dashwise HTTP monitors and System Agent hosts.
// SSH hosts and interactive shell support are intentionally not represented.
package monitoring

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/andreasmolnardev/dashwise/packages/foundation"
)

var (
	ErrNotFound = errors.New("monitoring record not found")
	ErrInvalid  = errors.New("invalid monitoring input")
)

type SecretProtector interface {
	Protect([]byte) ([]byte, error)
	Reveal([]byte) ([]byte, error)
}

type Store struct {
	db         *sql.DB
	foundation *foundation.DB
	secrets    SecretProtector
	client     *http.Client
}

type OutlierThreshold struct {
	Type  string  `json:"type"`
	Value float64 `json:"value"`
}
type ResponseFilter struct {
	AcceptStatusCodes    []int          `json:"acceptStatusCodes,omitempty"`
	AcceptBodyProperties map[string]any `json:"acceptBodyProperties,omitempty"`
}
type EndpointAuth struct {
	Type     string `json:"type"`
	Token    string `json:"token,omitempty"`
	Username string `json:"username,omitempty"`
	Password string `json:"password,omitempty"`
	Name     string `json:"name,omitempty"`
	Value    string `json:"value,omitempty"`
}

type Ping struct {
	ID         string    `json:"id"`
	MonitorID  string    `json:"monitorId"`
	Status     string    `json:"status"`
	Created    time.Time `json:"created"`
	HTTPStatus int       `json:"httpStatus,omitempty"`
	Method     string    `json:"method"`
	Endpoint   string    `json:"endpoint"`
	LatencyMS  int64     `json:"latencyMs,omitempty"`
	Error      string    `json:"error,omitempty"`
	IsOutlier  bool      `json:"isOutlier,omitempty"`
}

type PingOutlier struct {
	Created      time.Time        `json:"created"`
	LatencyMS    int64            `json:"latencyMs"`
	Threshold    OutlierThreshold `json:"threshold"`
	BaselineMS   *float64         `json:"baselineMs,omitempty"`
	DeltaMS      float64          `json:"deltaMs,omitempty"`
	DeltaPercent float64          `json:"deltaPercent,omitempty"`
}

type Monitor struct {
	ID                   string           `json:"id"`
	OwnerID              string           `json:"userId"`
	Title                string           `json:"title,omitempty"`
	Endpoint             string           `json:"endpoint"`
	Method               string           `json:"method"`
	LinkID               string           `json:"sourcelinkId,omitempty"`
	Status               string           `json:"status"`
	EndpointAuth         *EndpointAuth    `json:"endpointAuth,omitempty"`
	ResponseUpFilter     *ResponseFilter  `json:"responseUpFilter,omitempty"`
	PingOutlierThreshold OutlierThreshold `json:"pingOutlierThreshold"`
	PingAvgLatency       map[string]any   `json:"pingAvgLatency"`
	PingOutliers         []PingOutlier    `json:"pingOutliers"`
	NotifyOnStatusChange bool             `json:"notifyOnStatusChange"`
	NotifyTopicID        string           `json:"notifyTopicId,omitempty"`
	Created              time.Time        `json:"created"`
	Updated              time.Time        `json:"updated"`
	Pings                []Ping           `json:"pings"`
}

type MonitorInput struct {
	Title                 string            `json:"title"`
	Endpoint              string            `json:"endpoint"`
	Method                string            `json:"method"`
	LinkID                string            `json:"linkId"`
	EndpointAuth          *EndpointAuth     `json:"endpointAuth"`
	ClearEndpointAuth     bool              `json:"clearEndpointAuth"`
	ResponseUpFilter      *ResponseFilter   `json:"responseUpFilter"`
	AcceptedUpStatusCodes []int             `json:"acceptedUpStatusCodes"`
	PingOutlierThreshold  *OutlierThreshold `json:"pingOutlierThreshold"`
	NotifyOnStatusChange  *bool             `json:"notifyOnStatusChange"`
	NotifyTopicID         *string           `json:"notifyTopicId"`
}

type MonitorSummary struct {
	ID              string     `json:"id"`
	Status          string     `json:"status"`
	DateChanged     *time.Time `json:"dateChanged"`
	DurationChanged *float64   `json:"durationChanged"`
	Endpoint        string     `json:"endpoint,omitempty"`
}
type CheckResult struct {
	JobID           string     `json:"jobId"`
	LinkID          string     `json:"linkId,omitempty"`
	Status          string     `json:"status"`
	RawStatus       string     `json:"rawStatus"`
	Endpoint        string     `json:"endpoint"`
	CheckedAt       time.Time  `json:"checkedAt"`
	DateChanged     *time.Time `json:"dateChanged"`
	DurationChanged *float64   `json:"durationChanged"`
	HTTPStatus      int        `json:"httpStatus,omitempty"`
	Method          string     `json:"method"`
	LatencyMS       int64      `json:"latencyMs,omitempty"`
	Error           string     `json:"error,omitempty"`
}

type Host struct {
	ID            string         `json:"id"`
	OwnerID       string         `json:"userId"`
	Name          string         `json:"name"`
	Hostname      string         `json:"hostname"`
	Port          int            `json:"port"`
	Type          string         `json:"type"`
	AuthType      string         `json:"authType"`
	Status        string         `json:"status"`
	SystemInfo    map[string]any `json:"systemInfo,omitempty"`
	Created       time.Time      `json:"created"`
	Updated       time.Time      `json:"updated"`
	HasCredential bool           `json:"hasCredential"`
}
type HostInput struct {
	Name    string `json:"name"`
	URL     string `json:"url"`
	LiveURL string `json:"liveUrl"`
	Token   string `json:"token"`
}
type HostStats struct {
	HostID    string         `json:"hostId"`
	Stats     map[string]any `json:"stats"`
	UpdatedAt time.Time      `json:"updatedAt"`
}

func NewStore(db *foundation.DB, secrets SecretProtector) (*Store, error) {
	if db == nil || db.SQL() == nil {
		return nil, errors.New("monitoring store requires an open database")
	}
	return &Store{db: db.SQL(), foundation: db, secrets: secrets, client: &http.Client{Timeout: 10 * time.Second}}, nil
}

func (s *Store) Initialize(ctx context.Context) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS monitors(id TEXT PRIMARY KEY NOT NULL,owner_id TEXT NOT NULL,title TEXT NOT NULL DEFAULT '',endpoint TEXT NOT NULL,method TEXT NOT NULL DEFAULT 'GET',link_id TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'initiated',endpoint_auth BLOB,response_filter_json TEXT NOT NULL DEFAULT '{}',outlier_json TEXT NOT NULL DEFAULT '{"type":"absolute","value":0}',avg_latency_json TEXT NOT NULL DEFAULT '{"avgMs":0,"samples":0}',notify_on_change INTEGER NOT NULL DEFAULT 0,notify_topic_id TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`,
		`CREATE INDEX IF NOT EXISTS monitors_by_owner ON monitors(owner_id,created_at DESC)`,
		`CREATE INDEX IF NOT EXISTS monitors_by_link ON monitors(owner_id,link_id)`,
		`CREATE TABLE IF NOT EXISTS monitor_pings(id TEXT PRIMARY KEY NOT NULL,monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,status TEXT NOT NULL,created_at TEXT NOT NULL,http_status INTEGER NOT NULL DEFAULT 0,method TEXT NOT NULL,endpoint TEXT NOT NULL,latency_ms INTEGER NOT NULL DEFAULT 0,error TEXT NOT NULL DEFAULT '',is_outlier INTEGER NOT NULL DEFAULT 0)`,
		`CREATE INDEX IF NOT EXISTS monitor_pings_by_monitor_time ON monitor_pings(monitor_id,created_at DESC)`,
		`CREATE TABLE IF NOT EXISTS monitoring_hosts(id TEXT PRIMARY KEY NOT NULL,owner_id TEXT NOT NULL,name TEXT NOT NULL,hostname TEXT NOT NULL,port INTEGER NOT NULL,system_info_json TEXT NOT NULL DEFAULT '{}',credential BLOB,status TEXT NOT NULL DEFAULT 'unknown',created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`,
		`CREATE INDEX IF NOT EXISTS monitoring_hosts_by_owner ON monitoring_hosts(owner_id,name COLLATE NOCASE)`,
		`CREATE TABLE IF NOT EXISTS monitoring_host_stats(host_id TEXT PRIMARY KEY NOT NULL REFERENCES monitoring_hosts(id) ON DELETE CASCADE,stats_json TEXT NOT NULL,updated_at TEXT NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS monitoring_host_history(id INTEGER PRIMARY KEY AUTOINCREMENT,host_id TEXT NOT NULL REFERENCES monitoring_hosts(id) ON DELETE CASCADE,sampled_at TEXT NOT NULL,source TEXT NOT NULL,stats_json TEXT NOT NULL)`,
		`CREATE INDEX IF NOT EXISTS monitoring_host_history_by_host ON monitoring_host_history(host_id,sampled_at DESC)`,
	}
	return s.foundation.ApplyMigrations(ctx, []foundation.Migration{{
		ID:   "0002_monitoring_schema",
		Name: "monitoring definitions and telemetry",
		Up: func(ctx context.Context, tx *sql.Tx) error {
			for _, statement := range statements {
				if _, err := tx.ExecContext(ctx, statement); err != nil {
					return fmt.Errorf("initialize monitoring schema: %w", err)
				}
			}
			// Older development schemas were created before outlier flags existed.
			rows, err := tx.QueryContext(ctx, `PRAGMA table_info(monitor_pings)`)
			if err != nil {
				return err
			}
			hasOutlier := false
			for rows.Next() {
				var cid, notnull, pk int
				var name, typ string
				var dflt any
				if err := rows.Scan(&cid, &name, &typ, &notnull, &dflt, &pk); err != nil {
					_ = rows.Close()
					return err
				}
				if name == "is_outlier" {
					hasOutlier = true
				}
			}
			if err := rows.Err(); err != nil {
				_ = rows.Close()
				return err
			}
			if err := rows.Close(); err != nil {
				return err
			}
			if !hasOutlier {
				if _, err := tx.ExecContext(ctx, `ALTER TABLE monitor_pings ADD COLUMN is_outlier INTEGER NOT NULL DEFAULT 0`); err != nil {
					return err
				}
			}
			return nil
		},
		Down: func(ctx context.Context, tx *sql.Tx) error {
			for _, table := range []string{"monitoring_host_history", "monitoring_host_stats", "monitoring_hosts", "monitor_pings", "monitors"} {
				if _, err := tx.ExecContext(ctx, "DROP TABLE IF EXISTS "+table); err != nil {
					return err
				}
			}
			return nil
		},
	}})
}

func (s *Store) CreateMonitor(ctx context.Context, owner string, in MonitorInput) (Monitor, error) {
	if strings.TrimSpace(owner) == "" {
		return Monitor{}, invalid("owner is required")
	}
	endpoint, err := validateEndpoint(in.Endpoint)
	if err != nil {
		return Monitor{}, err
	}
	method := normalizeMethod(in.Method)
	linkID := strings.TrimSpace(in.LinkID)
	if linkID == "" {
		return Monitor{}, invalid("link selection is required")
	}
	filter := normalizeFilter(in.ResponseUpFilter, in.AcceptedUpStatusCodes)
	threshold := OutlierThreshold{Type: "absolute", Value: 0}
	if in.PingOutlierThreshold != nil {
		threshold = *in.PingOutlierThreshold
	}
	if err := validateThreshold(threshold); err != nil {
		return Monitor{}, err
	}
	id, err := randomID()
	if err != nil {
		return Monitor{}, err
	}
	monitor := Monitor{ID: id, OwnerID: owner, Title: strings.TrimSpace(in.Title), Endpoint: endpoint, Method: method, LinkID: linkID, Status: "initiated", ResponseUpFilter: &filter, PingOutlierThreshold: threshold, PingAvgLatency: map[string]any{"avgMs": 0, "samples": 0}, PingOutliers: []PingOutlier{}, Pings: []Ping{}, Created: time.Now().UTC(), Updated: time.Now().UTC()}
	if in.NotifyOnStatusChange != nil {
		monitor.NotifyOnStatusChange = *in.NotifyOnStatusChange
	}
	if in.NotifyTopicID != nil {
		monitor.NotifyTopicID = strings.TrimSpace(*in.NotifyTopicID)
	}
	var authBytes []byte
	if in.EndpointAuth != nil {
		authBytes, err = s.protectAuth(*in.EndpointAuth)
		if err != nil {
			return Monitor{}, err
		}
		monitor.EndpointAuth = in.EndpointAuth
	}
	filterJSON, _ := json.Marshal(filter)
	thresholdJSON, _ := json.Marshal(threshold)
	avgJSON, _ := json.Marshal(monitor.PingAvgLatency)
	now := monitor.Created.Format(time.RFC3339Nano)
	_, err = s.db.ExecContext(ctx, `INSERT INTO monitors(id,owner_id,title,endpoint,method,link_id,status,endpoint_auth,response_filter_json,outlier_json,avg_latency_json,notify_on_change,notify_topic_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?)`, monitor.ID, owner, monitor.Title, endpoint, method, linkID, monitor.Status, authBytes, string(filterJSON), string(thresholdJSON), string(avgJSON), boolInt(monitor.NotifyOnStatusChange), monitor.NotifyTopicID, now, now)
	if err != nil {
		return Monitor{}, fmt.Errorf("create monitor: %w", err)
	}
	return monitor, nil
}

func (s *Store) UpdateMonitor(ctx context.Context, owner, id string, in MonitorInput) (Monitor, error) {
	m, err := s.GetMonitor(ctx, owner, id)
	if err != nil {
		return Monitor{}, err
	}
	if strings.TrimSpace(in.Endpoint) != "" {
		m.Endpoint, err = validateEndpoint(in.Endpoint)
		if err != nil {
			return Monitor{}, err
		}
	}
	if strings.TrimSpace(in.Method) != "" {
		m.Method = normalizeMethod(in.Method)
	}
	if in.Title != "" {
		m.Title = strings.TrimSpace(in.Title)
	}
	if in.ClearEndpointAuth {
		if _, e := s.db.ExecContext(ctx, `UPDATE monitors SET endpoint_auth=NULL WHERE owner_id=? AND id=?`, owner, id); e != nil {
			return Monitor{}, e
		}
		m.EndpointAuth = nil
	} else if in.EndpointAuth != nil {
		authBytes, e := s.protectAuth(*in.EndpointAuth)
		if e != nil {
			return Monitor{}, e
		}
		if _, e = s.db.ExecContext(ctx, `UPDATE monitors SET endpoint_auth=? WHERE owner_id=? AND id=?`, authBytes, owner, id); e != nil {
			return Monitor{}, e
		}
		m.EndpointAuth = in.EndpointAuth
	}
	if in.ResponseUpFilter != nil || in.AcceptedUpStatusCodes != nil {
		f := normalizeFilter(in.ResponseUpFilter, in.AcceptedUpStatusCodes)
		m.ResponseUpFilter = &f
	}
	if in.PingOutlierThreshold != nil {
		if err := validateThreshold(*in.PingOutlierThreshold); err != nil {
			return Monitor{}, err
		}
		m.PingOutlierThreshold = *in.PingOutlierThreshold
	}
	if in.NotifyOnStatusChange != nil {
		m.NotifyOnStatusChange = *in.NotifyOnStatusChange
	}
	if in.NotifyTopicID != nil {
		m.NotifyTopicID = strings.TrimSpace(*in.NotifyTopicID)
	}
	filterJSON, _ := json.Marshal(m.ResponseUpFilter)
	thresholdJSON, _ := json.Marshal(m.PingOutlierThreshold)
	now := time.Now().UTC()
	m.Updated = now
	_, err = s.db.ExecContext(ctx, `UPDATE monitors SET title=?,endpoint=?,method=?,response_filter_json=?,outlier_json=?,notify_on_change=?,notify_topic_id=?,updated_at=? WHERE owner_id=? AND id=?`, m.Title, m.Endpoint, m.Method, string(filterJSON), string(thresholdJSON), boolInt(m.NotifyOnStatusChange), m.NotifyTopicID, now.Format(time.RFC3339Nano), owner, id)
	return m, err
}

func (s *Store) GetMonitor(ctx context.Context, owner, id string) (Monitor, error) {
	row := s.db.QueryRowContext(ctx, `SELECT id,owner_id,title,endpoint,method,link_id,status,endpoint_auth,response_filter_json,outlier_json,avg_latency_json,notify_on_change,notify_topic_id,created_at,updated_at FROM monitors WHERE owner_id=? AND id=?`, owner, id)
	return s.scanMonitor(ctx, row, true)
}
func (s *Store) ListMonitors(ctx context.Context, owner string) ([]Monitor, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,owner_id,title,endpoint,method,link_id,status,endpoint_auth,response_filter_json,outlier_json,avg_latency_json,notify_on_change,notify_topic_id,created_at,updated_at FROM monitors WHERE owner_id=? ORDER BY created_at DESC`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Monitor{}
	for rows.Next() {
		m, err := s.scanMonitor(ctx, rows, false)
		if err != nil {
			return nil, err
		}
		m.Pings, err = s.ListPings(ctx, m.ID, 100)
		if err != nil {
			return nil, err
		}
		m.PingOutliers = collectOutliers(m.Pings, m.PingOutlierThreshold, number(m.PingAvgLatency["avgMs"]))
		out = append(out, m)
	}
	return out, rows.Err()
}
func (s *Store) DeleteMonitor(ctx context.Context, owner, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM monitors WHERE owner_id=? AND id=?`, owner, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) RunCheck(ctx context.Context, owner, id string) (CheckResult, error) {
	m, err := s.GetMonitor(ctx, owner, id)
	if err != nil {
		return CheckResult{}, err
	}
	return s.check(ctx, m)
}
func (s *Store) RunAll(ctx context.Context, owner string) ([]CheckResult, error) {
	monitors, err := s.ListMonitors(ctx, owner)
	if err != nil {
		return nil, err
	}
	out := make([]CheckResult, 0, len(monitors))
	for _, m := range monitors {
		result, err := s.check(ctx, m)
		if err != nil {
			return nil, err
		}
		out = append(out, result)
	}
	return out, nil
}

func (s *Store) check(ctx context.Context, m Monitor) (CheckResult, error) {
	started := time.Now()
	req, err := http.NewRequestWithContext(ctx, m.Method, m.Endpoint, nil)
	if err != nil {
		return CheckResult{}, invalid("invalid monitor request")
	}
	if m.EndpointAuth != nil {
		applyAuth(req, *m.EndpointAuth)
	}
	response, requestErr := s.client.Do(req)
	latency := time.Since(started).Milliseconds()
	result := CheckResult{JobID: m.ID, LinkID: m.LinkID, Endpoint: m.Endpoint, Method: m.Method, CheckedAt: time.Now().UTC(), LatencyMS: latency}
	pingID, err := randomID()
	if err != nil {
		return CheckResult{}, err
	}
	ping := Ping{ID: pingID, MonitorID: m.ID, Created: result.CheckedAt, Method: m.Method, Endpoint: m.Endpoint, LatencyMS: latency}
	if requestErr != nil {
		result.RawStatus = "unhealthy"
		result.Status = "down"
		result.Error = requestErr.Error()
		ping.Status = "unhealthy"
		ping.Error = requestErr.Error()
	} else {
		defer response.Body.Close()
		body, readErr := io.ReadAll(io.LimitReader(response.Body, (1<<20)+1))
		if readErr != nil || len(body) > 1<<20 {
			result.Error = "response body exceeds 1 MB"
		}
		up := acceptStatus(m.ResponseUpFilter, response.StatusCode) && acceptBody(m.ResponseUpFilter, body, response.Header.Get("Content-Type"))
		if up {
			result.RawStatus = "healthy"
			result.Status = "up"
			ping.Status = "healthy"
		} else {
			result.RawStatus = "unhealthy"
			result.Status = "down"
			ping.Status = "unhealthy"
		}
		result.HTTPStatus = response.StatusCode
		ping.HTTPStatus = response.StatusCode
	}
	baseline := number(m.PingAvgLatency["avgMs"])
	threshold := m.PingOutlierThreshold
	switch threshold.Type {
	case "absolute":
		ping.IsOutlier = float64(latency) > threshold.Value
	case "relative":
		ping.IsOutlier = baseline > 0 && float64(latency) > baseline*(1+threshold.Value/100)
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO monitor_pings(id,monitor_id,status,created_at,http_status,method,endpoint,latency_ms,error,is_outlier) VALUES(?,?,?,?,?,?,?,?,?,?)`, ping.ID, ping.MonitorID, ping.Status, ping.Created.Format(time.RFC3339Nano), ping.HTTPStatus, ping.Method, ping.Endpoint, ping.LatencyMS, ping.Error, boolInt(ping.IsOutlier))
	if err != nil {
		return CheckResult{}, fmt.Errorf("record monitor ping: %w", err)
	}
	if err := s.updateMonitorStatus(ctx, m, ping); err != nil {
		return CheckResult{}, err
	}
	summary, err := s.StatusSummary(ctx, m.OwnerID, m.ID)
	if err == nil {
		result.DateChanged = summary.DateChanged
		result.DurationChanged = summary.DurationChanged
	}
	return result, nil
}

func (s *Store) updateMonitorStatus(ctx context.Context, m Monitor, p Ping) error {
	avg := map[string]any{}
	_ = json.Unmarshal(mustJSON(m.PingAvgLatency), &avg)
	samples := number(avg["samples"])
	previous := number(avg["avgMs"])
	nextSamples := samples + 1
	avg = map[string]any{"avgMs": (previous*samples + float64(p.LatencyMS)) / nextSamples, "samples": nextSamples}
	avgJSON, _ := json.Marshal(avg)
	now := p.Created.Format(time.RFC3339Nano)
	_, err := s.db.ExecContext(ctx, `UPDATE monitors SET status=?,avg_latency_json=?,updated_at=? WHERE owner_id=? AND id=?`, p.Status, string(avgJSON), now, m.OwnerID, m.ID)
	return err
}

func (s *Store) StatusSummary(ctx context.Context, owner, id string) (MonitorSummary, error) {
	m, err := s.GetMonitor(ctx, owner, id)
	if err != nil {
		return MonitorSummary{}, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT status,created_at FROM monitor_pings WHERE monitor_id=? ORDER BY created_at DESC LIMIT 2`, id)
	if err != nil {
		return MonitorSummary{}, err
	}
	defer rows.Close()
	type point struct {
		status string
		at     time.Time
	}
	points := []point{}
	for rows.Next() {
		var p point
		var stamp string
		if err := rows.Scan(&p.status, &stamp); err != nil {
			return MonitorSummary{}, err
		}
		p.at, err = time.Parse(time.RFC3339Nano, stamp)
		if err != nil {
			return MonitorSummary{}, err
		}
		points = append(points, p)
	}
	summary := MonitorSummary{ID: m.ID, Status: m.Status, Endpoint: m.Endpoint}
	if len(points) > 0 {
		summary.DateChanged = &points[0].at
	}
	if len(points) > 1 && points[0].status != points[1].status {
		duration := points[0].at.Sub(points[1].at).Seconds()
		summary.DurationChanged = &duration
	}
	return summary, rows.Err()
}
func (s *Store) Status(ctx context.Context, owner, onlyID string) (map[string]MonitorSummary, error) {
	list, err := s.ListMonitors(ctx, owner)
	if err != nil {
		return nil, err
	}
	out := map[string]MonitorSummary{}
	for _, m := range list {
		if onlyID != "" && m.ID != onlyID && m.LinkID != onlyID {
			continue
		}
		summary, err := s.StatusSummary(ctx, owner, m.ID)
		if err != nil {
			return nil, err
		}
		key := m.LinkID
		if key == "" {
			key = m.ID
		}
		out[key] = summary
	}
	return out, nil
}

func (s *Store) CreateHost(ctx context.Context, owner string, input HostInput) (Host, error) {
	if strings.TrimSpace(owner) == "" || strings.TrimSpace(input.Name) == "" {
		return Host{}, invalid("owner and host name are required")
	}
	origin, host, port, err := validateAgentURL(input.URL)
	if err != nil {
		return Host{}, err
	}
	if strings.TrimSpace(input.Token) == "" {
		return Host{}, invalid("System Agent token is required")
	}
	if s.secrets == nil {
		return Host{}, errors.New("monitoring credential encryption is not configured")
	}
	credential, err := s.secrets.Protect([]byte(input.Token))
	if err != nil {
		return Host{}, err
	}
	info := map[string]any{"url": origin}
	if input.LiveURL != "" {
		live, err := validateLiveURL(input.LiveURL)
		if err != nil {
			return Host{}, err
		}
		info["liveUrl"] = live
	}
	infoJSON, _ := json.Marshal(info)
	now := time.Now().UTC()
	id, err := randomID()
	if err != nil {
		return Host{}, err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO monitoring_hosts(id,owner_id,name,hostname,port,system_info_json,credential,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'unknown',?,?)`, id, owner, strings.TrimSpace(input.Name), host, port, infoJSON, credential, now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano))
	if err != nil {
		return Host{}, err
	}
	return s.GetHost(ctx, owner, id)
}
func (s *Store) ListHosts(ctx context.Context, owner string) ([]Host, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,owner_id,name,hostname,port,system_info_json,credential,status,created_at,updated_at FROM monitoring_hosts WHERE owner_id=? ORDER BY name COLLATE NOCASE`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Host{}
	for rows.Next() {
		h, err := scanHost(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, h)
	}
	return items, rows.Err()
}
func (s *Store) GetHost(ctx context.Context, owner, id string) (Host, error) {
	return scanHost(s.db.QueryRowContext(ctx, `SELECT id,owner_id,name,hostname,port,system_info_json,credential,status,created_at,updated_at FROM monitoring_hosts WHERE owner_id=? AND id=?`, owner, id))
}
func (s *Store) AgentToken(ctx context.Context, owner, id string) (string, error) {
	if s.secrets == nil {
		return "", errors.New("monitoring credential encryption is not configured")
	}
	var credential []byte
	if err := s.db.QueryRowContext(ctx, `SELECT credential FROM monitoring_hosts WHERE owner_id=? AND id=?`, owner, id).Scan(&credential); errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	} else if err != nil {
		return "", err
	}
	raw, err := s.secrets.Reveal(credential)
	return string(raw), err
}

func (s *Store) AgentTokenForHost(ctx context.Context, id string) (string, error) {
	if s.secrets == nil {
		return "", errors.New("monitoring credential encryption is not configured")
	}
	var credential []byte
	if err := s.db.QueryRowContext(ctx, `SELECT credential FROM monitoring_hosts WHERE id=?`, id).Scan(&credential); errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	} else if err != nil {
		return "", err
	}
	raw, err := s.secrets.Reveal(credential)
	return string(raw), err
}

func (s *Store) ListAllHosts(ctx context.Context) ([]Host, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,owner_id,name,hostname,port,system_info_json,credential,status,created_at,updated_at FROM monitoring_hosts ORDER BY owner_id,name COLLATE NOCASE`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Host{}
	for rows.Next() {
		host, err := scanHost(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, host)
	}
	return items, rows.Err()
}
func (s *Store) UpdateHost(ctx context.Context, owner, id string, input HostInput) (Host, error) {
	old, err := s.GetHost(ctx, owner, id)
	if err != nil {
		return Host{}, err
	}
	name := old.Name
	if input.Name != "" {
		name = strings.TrimSpace(input.Name)
	}
	info := old.SystemInfo
	if info == nil {
		info = map[string]any{}
	}
	host, port := old.Hostname, old.Port
	if input.URL != "" {
		origin, h, p, err := validateAgentURL(input.URL)
		if err != nil {
			return Host{}, err
		}
		host, port = h, p
		info["url"] = origin
	}
	if input.LiveURL != "" {
		live, err := validateLiveURL(input.LiveURL)
		if err != nil {
			return Host{}, err
		}
		info["liveUrl"] = live
	}
	var credential any
	if input.Token != "" {
		if s.secrets == nil {
			return Host{}, errors.New("monitoring credential encryption is not configured")
		}
		credential, err = s.secrets.Protect([]byte(input.Token))
		if err != nil {
			return Host{}, err
		}
	}
	infoJSON, _ := json.Marshal(info)
	_, err = s.db.ExecContext(ctx, `UPDATE monitoring_hosts SET name=?,hostname=?,port=?,system_info_json=?,credential=COALESCE(?,credential),updated_at=? WHERE owner_id=? AND id=?`, name, host, port, infoJSON, credential, time.Now().UTC().Format(time.RFC3339Nano), owner, id)
	if err != nil {
		return Host{}, err
	}
	return s.GetHost(ctx, owner, id)
}
func (s *Store) DeleteHost(ctx context.Context, owner, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM monitoring_hosts WHERE owner_id=? AND id=?`, owner, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}
func (s *Store) SaveHostStats(ctx context.Context, hostID, source string, stats map[string]any) error {
	if source != "http" && source != "websocket" {
		return invalid("metric source must be http or websocket")
	}
	encoded, err := json.Marshal(stats)
	if err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `INSERT INTO monitoring_host_stats(host_id,stats_json,updated_at) VALUES(?,?,?) ON CONFLICT(host_id) DO UPDATE SET stats_json=excluded.stats_json,updated_at=excluded.updated_at`, hostID, string(encoded), now); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO monitoring_host_history(host_id,sampled_at,source,stats_json) VALUES(?,?,?,?)`, hostID, now, source, string(encoded)); err != nil {
		return err
	}
	return tx.Commit()
}
func (s *Store) GetHostStats(ctx context.Context, owner, id string) (HostStats, error) {
	if _, err := s.GetHost(ctx, owner, id); err != nil {
		return HostStats{}, err
	}
	var out HostStats
	var encoded, stamp string
	err := s.db.QueryRowContext(ctx, `SELECT host_id,stats_json,updated_at FROM monitoring_host_stats WHERE host_id=?`, id).Scan(&out.HostID, &encoded, &stamp)
	if errors.Is(err, sql.ErrNoRows) {
		return HostStats{}, ErrNotFound
	}
	if err != nil {
		return HostStats{}, err
	}
	if err = json.Unmarshal([]byte(encoded), &out.Stats); err != nil {
		return HostStats{}, err
	}
	out.UpdatedAt, err = time.Parse(time.RFC3339Nano, stamp)
	return out, err
}
func (s *Store) HostHistory(ctx context.Context, owner, id string, from time.Time, limit int) ([]HostStats, error) {
	if _, err := s.GetHost(ctx, owner, id); err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 5000 {
		limit = 1000
	}
	rows, err := s.db.QueryContext(ctx, `SELECT host_id,stats_json,sampled_at FROM monitoring_host_history WHERE host_id=? AND sampled_at>=? ORDER BY sampled_at DESC LIMIT ?`, id, from.UTC().Format(time.RFC3339Nano), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []HostStats{}
	for rows.Next() {
		var item HostStats
		var encoded, stamp string
		if err := rows.Scan(&item.HostID, &encoded, &stamp); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(encoded), &item.Stats); err != nil {
			return nil, err
		}
		item.UpdatedAt, err = time.Parse(time.RFC3339Nano, stamp)
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *Store) PruneHostHistory(ctx context.Context, before time.Time) (int64, error) {
	result, err := s.db.ExecContext(ctx, `DELETE FROM monitoring_host_history WHERE sampled_at<?`, before.UTC().Format(time.RFC3339Nano))
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}
func (s *Store) SetHostConnection(ctx context.Context, owner, id, status string, systemInfo map[string]any) error {
	if status != "online" && status != "offline" {
		return invalid("host status must be online or offline")
	}
	h, err := s.GetHost(ctx, owner, id)
	if err != nil {
		return err
	}
	for key, value := range systemInfo {
		h.SystemInfo[key] = value
	}
	if status == "online" {
		h.SystemInfo["lastConnectedAt"] = time.Now().UTC().Format(time.RFC3339Nano)
	}
	encoded, _ := json.Marshal(h.SystemInfo)
	_, err = s.db.ExecContext(ctx, `UPDATE monitoring_hosts SET status=?,system_info_json=?,updated_at=? WHERE owner_id=? AND id=?`, status, string(encoded), time.Now().UTC().Format(time.RFC3339Nano), owner, id)
	return err
}

func (s *Store) scanMonitor(ctx context.Context, row scanner, withPings bool) (Monitor, error) {
	var m Monitor
	var authBytes []byte
	var filterJSON, thresholdJSON, avgJSON, created, updated string
	var notify int
	err := row.Scan(&m.ID, &m.OwnerID, &m.Title, &m.Endpoint, &m.Method, &m.LinkID, &m.Status, &authBytes, &filterJSON, &thresholdJSON, &avgJSON, &notify, &m.NotifyTopicID, &created, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return Monitor{}, ErrNotFound
	}
	if err != nil {
		return Monitor{}, err
	}
	if authBytes != nil {
		if s.secrets == nil {
			return Monitor{}, errors.New("monitoring credential encryption is not configured")
		}
		raw, e := s.secrets.Reveal(authBytes)
		if e != nil {
			return Monitor{}, fmt.Errorf("reveal monitor authentication: %w", e)
		}
		var a EndpointAuth
		if e = json.Unmarshal(raw, &a); e != nil {
			return Monitor{}, e
		}
		m.EndpointAuth = &a
	}
	_ = json.Unmarshal([]byte(filterJSON), &m.ResponseUpFilter)
	_ = json.Unmarshal([]byte(thresholdJSON), &m.PingOutlierThreshold)
	_ = json.Unmarshal([]byte(avgJSON), &m.PingAvgLatency)
	m.NotifyOnStatusChange = notify != 0
	m.Created, err = time.Parse(time.RFC3339Nano, created)
	if err != nil {
		return Monitor{}, err
	}
	m.Updated, err = time.Parse(time.RFC3339Nano, updated)
	if err != nil {
		return Monitor{}, err
	}
	if withPings {
		m.Pings, err = s.ListPings(ctx, m.ID, 100)
		if err != nil {
			return Monitor{}, err
		}
		m.PingOutliers = collectOutliers(m.Pings, m.PingOutlierThreshold, number(m.PingAvgLatency["avgMs"]))
	}
	return m, nil
}
func (s *Store) ListPings(ctx context.Context, monitorID string, limit int) ([]Ping, error) {
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id,monitor_id,status,created_at,http_status,method,endpoint,latency_ms,error,is_outlier FROM monitor_pings WHERE monitor_id=? ORDER BY created_at DESC LIMIT ?`, monitorID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Ping{}
	for rows.Next() {
		var p Ping
		var stamp string
		var outlier int
		if err := rows.Scan(&p.ID, &p.MonitorID, &p.Status, &stamp, &p.HTTPStatus, &p.Method, &p.Endpoint, &p.LatencyMS, &p.Error, &outlier); err != nil {
			return nil, err
		}
		p.IsOutlier = outlier != 0
		p.Created, err = time.Parse(time.RFC3339Nano, stamp)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func collectOutliers(pings []Ping, threshold OutlierThreshold, baseline float64) []PingOutlier {
	out := []PingOutlier{}
	for _, ping := range pings {
		if !ping.IsOutlier {
			continue
		}
		item := PingOutlier{Created: ping.Created, LatencyMS: ping.LatencyMS, Threshold: threshold}
		if baseline > 0 {
			item.BaselineMS = &baseline
			item.DeltaMS = float64(ping.LatencyMS) - baseline
			item.DeltaPercent = item.DeltaMS / baseline * 100
		}
		out = append(out, item)
	}
	return out
}
func scanHost(row scanner) (Host, error) {
	var h Host
	var info string
	var credential []byte
	var created, updated string
	err := row.Scan(&h.ID, &h.OwnerID, &h.Name, &h.Hostname, &h.Port, &info, &credential, &h.Status, &created, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return Host{}, ErrNotFound
	}
	if err != nil {
		return Host{}, err
	}
	if err = json.Unmarshal([]byte(info), &h.SystemInfo); err != nil {
		return Host{}, err
	}
	h.Type = "monitor"
	h.AuthType = "agent"
	h.HasCredential = len(credential) > 0
	h.Created, err = time.Parse(time.RFC3339Nano, created)
	if err != nil {
		return Host{}, err
	}
	h.Updated, err = time.Parse(time.RFC3339Nano, updated)
	return h, err
}

type scanner interface{ Scan(...any) error }

func (s *Store) protectAuth(auth EndpointAuth) ([]byte, error) {
	if s.secrets == nil {
		return nil, errors.New("monitoring credential encryption is not configured")
	}
	if err := validateAuth(auth); err != nil {
		return nil, err
	}
	raw, err := json.Marshal(auth)
	if err != nil {
		return nil, err
	}
	return s.secrets.Protect(raw)
}
func (s *Store) OpenAuth(auth []byte) (*EndpointAuth, error) {
	if len(auth) == 0 {
		return nil, nil
	}
	if s.secrets == nil {
		return nil, errors.New("monitoring credential encryption is not configured")
	}
	raw, err := s.secrets.Reveal(auth)
	if err != nil {
		return nil, err
	}
	var out EndpointAuth
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
func validateAuth(a EndpointAuth) error {
	switch a.Type {
	case "bearer":
		if a.Token == "" {
			return invalid("bearer token is required")
		}
	case "basic":
		if a.Username == "" {
			return invalid("basic username is required")
		}
	case "header":
		if a.Name == "" || strings.ContainsAny(a.Name, "\r\n:") {
			return invalid("valid authentication header name is required")
		}
	default:
		return invalid("unsupported endpoint authentication type")
	}
	return nil
}
func validateEndpoint(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil {
		return "", invalid("monitor endpoint must be an HTTP or HTTPS URL without embedded credentials")
	}
	return u.String(), nil
}
func validateAgentURL(raw string) (string, string, int, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.Path != "" && u.Path != "/" || u.RawQuery != "" || u.Fragment != "" {
		return "", "", 0, invalid("System Agent URL must be an HTTP origin without credentials or path")
	}
	port := 80
	if u.Scheme == "https" {
		port = 443
	}
	if u.Port() != "" {
		var n int
		if _, e := fmt.Sscanf(u.Port(), "%d", &n); e != nil || n < 1 || n > 65535 {
			return "", "", 0, invalid("invalid System Agent port")
		}
		port = n
	}
	return u.Scheme + "://" + u.Host, u.Hostname(), port, nil
}
func validateLiveURL(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Hostname() == "" || (u.Scheme != "ws" && u.Scheme != "wss") || u.User != nil {
		return "", invalid("live URL must be a WebSocket URL without credentials")
	}
	return u.String(), nil
}
func normalizeMethod(raw string) string {
	method := strings.ToUpper(strings.TrimSpace(raw))
	switch method {
	case "GET", "POST", "PUT", "PATCH", "DELETE":
		return method
	default:
		return "GET"
	}
}
func normalizeFilter(input *ResponseFilter, codes []int) ResponseFilter {
	if input != nil {
		out := *input
		if len(out.AcceptStatusCodes) == 0 && len(codes) > 0 {
			out.AcceptStatusCodes = codes
		}
		if len(out.AcceptStatusCodes) == 0 {
			out.AcceptStatusCodes = defaultCodes()
		}
		return out
	}
	if len(codes) == 0 {
		codes = defaultCodes()
	}
	return ResponseFilter{AcceptStatusCodes: codes}
}
func defaultCodes() []int { return []int{200, 201, 202, 203, 204, 205, 206, 207, 208, 226} }
func validateThreshold(t OutlierThreshold) error {
	if (t.Type != "absolute" && t.Type != "relative") || t.Value < 0 {
		return invalid("outlier threshold must be absolute or relative and non-negative")
	}
	return nil
}
func applyAuth(req *http.Request, a EndpointAuth) {
	switch a.Type {
	case "bearer":
		req.Header.Set("Authorization", "Bearer "+a.Token)
	case "basic":
		req.SetBasicAuth(a.Username, a.Password)
	case "header":
		req.Header.Set(a.Name, a.Value)
	}
}
func acceptStatus(filter *ResponseFilter, status int) bool {
	if filter == nil {
		return status >= 200 && status < 300
	}
	for _, code := range filter.AcceptStatusCodes {
		if code == status {
			return true
		}
	}
	return false
}
func acceptBody(filter *ResponseFilter, body []byte, contentType string) bool {
	if filter == nil || len(filter.AcceptBodyProperties) == 0 {
		return true
	}
	if len(body) == 0 || !strings.Contains(strings.ToLower(contentType), "json") {
		return false
	}
	var value any
	if json.Unmarshal(body, &value) != nil {
		return false
	}
	for path, expected := range filter.AcceptBodyProperties {
		actual, ok := jsonPath(value, path)
		if !ok || fmt.Sprint(actual) != fmt.Sprint(expected) {
			return false
		}
	}
	return true
}
func jsonPath(value any, path string) (any, bool) {
	path = strings.TrimPrefix(path, "$")
	path = strings.TrimPrefix(path, ".")
	var current any = value
	for _, part := range strings.Split(path, ".") {
		m, ok := current.(map[string]any)
		if !ok {
			return nil, false
		}
		current, ok = m[part]
		if !ok {
			return nil, false
		}
	}
	return current, true
}
func normalizeStatus(status string) string {
	if status == "" {
		return "initiated"
	}
	return status
}
func randomID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate monitoring identifier: %w", err)
	}
	return hex.EncodeToString(b), nil
}
func boolInt(v bool) int {
	if v {
		return 1
	}
	return 0
}
func invalid(message string) error { return fmt.Errorf("%w: %s", ErrInvalid, message) }
func mustJSON(value any) []byte    { b, _ := json.Marshal(value); return b }
func number(value any) float64 {
	switch n := value.(type) {
	case float64:
		return n
	case int:
		return float64(n)
	}
	return 0
}
