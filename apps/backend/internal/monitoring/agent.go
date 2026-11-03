package monitoring

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const maxAgentResponseBytes = 1 << 20

// RefreshHost fetches current telemetry from one configured System Agent and
// updates its durable status and history records.
func (s *Store) RefreshHost(ctx context.Context, owner, id string) error {
	host, err := s.GetHost(ctx, owner, id)
	if err != nil {
		return err
	}
	base, err := hostBaseURL(host)
	if err != nil {
		_ = s.SetHostConnection(ctx, owner, id, "offline", nil)
		return err
	}
	token, err := s.AgentToken(ctx, owner, id)
	if err != nil {
		_ = s.SetHostConnection(ctx, owner, id, "offline", nil)
		return err
	}
	var system map[string]any
	if err := s.agentGET(ctx, base, token, "/api/v1/system", &system); err != nil {
		_ = s.SetHostConnection(ctx, owner, id, "offline", nil)
		return err
	}
	var latest any
	if err := s.agentGET(ctx, base, token, "/api/v1/metrics/latest", &latest); err != nil {
		_ = s.SetHostConnection(ctx, owner, id, "offline", nil)
		return err
	}
	entry := latestEntry(latest)
	if entry != nil {
		if err := s.SaveHostStats(ctx, id, "http", map[string]any{"current": entry, "receivedAt": time.Now().UTC().Format(time.RFC3339Nano)}); err != nil {
			return err
		}
	}
	return s.SetHostConnection(ctx, owner, id, "online", map[string]any{"agent": system})
}

func (s *Store) RefreshAllHosts(ctx context.Context) error {
	hosts, err := s.ListAllHosts(ctx)
	if err != nil {
		return err
	}
	var failures []error
	for _, host := range hosts {
		if err := s.RefreshHost(ctx, host.OwnerID, host.ID); err != nil {
			failures = append(failures, fmt.Errorf("host %s: %w", host.ID, err))
		}
	}
	return errors.Join(failures...)
}

func (s *Store) RunAgentPoller(ctx context.Context, interval time.Duration) error {
	if interval <= 0 {
		interval = 15 * time.Second
	}
	_ = s.RefreshAllHosts(ctx)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			_ = s.RefreshAllHosts(ctx)
		}
	}
}

func hostBaseURL(host Host) (string, error) {
	if raw, ok := host.SystemInfo["url"].(string); ok {
		u, err := url.Parse(raw)
		if err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Hostname() != "" && u.User == nil {
			return strings.TrimRight(u.String(), "/"), nil
		}
	}
	if host.Hostname == "" || host.Port <= 0 || host.Port > 65535 {
		return "", invalid("invalid System Agent address")
	}
	scheme := "http"
	if host.Port == 443 {
		scheme = "https"
	}
	return fmt.Sprintf("%s://%s:%d", scheme, host.Hostname, host.Port), nil
}

func (s *Store) agentGET(ctx context.Context, base, token, path string, dst any) error {
	requestCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(requestCtx, http.MethodGet, strings.TrimRight(base, "/")+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("System Agent returned HTTP %d", resp.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxAgentResponseBytes+1)).Decode(dst); err != nil {
		return err
	}
	return nil
}

func latestEntry(value any) map[string]any {
	switch item := value.(type) {
	case []any:
		if len(item) == 0 {
			return nil
		}
		return latestEntry(item[len(item)-1])
	case map[string]any:
		return item
	default:
		return nil
	}
}
