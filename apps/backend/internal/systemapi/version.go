package systemapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

var versionPattern = regexp.MustCompile(`^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$`)

// VersionChecker caches the latest GitHub release tag for the appInfo route.
// Checks are bounded and run outside request handling.
type VersionChecker struct {
	client  *http.Client
	version string
	repo    string

	mu     sync.RWMutex
	latest string
}

func NewVersionChecker(version, repo string) *VersionChecker {
	return &VersionChecker{
		client:  &http.Client{Timeout: 8 * time.Second},
		version: strings.TrimSpace(version),
		repo:    strings.Trim(strings.TrimSpace(repo), "/"),
	}
}

func (c *VersionChecker) UpdateAvailable() any {
	c.mu.RLock()
	latest := c.latest
	c.mu.RUnlock()
	if latest == "" || compareVersions(latest, c.version) <= 0 {
		return false
	}
	return latest
}

func (c *VersionChecker) Run(ctx context.Context) error {
	if c == nil {
		return errors.New("version checker is nil")
	}
	if err := c.Refresh(ctx); err != nil && ctx.Err() == nil {
		slog.Warn("initial GitHub release check failed", "error", err)
	}
	ticker := time.NewTicker(6 * time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if err := c.Refresh(ctx); err != nil && ctx.Err() == nil {
				slog.Warn("GitHub release check failed", "error", err)
			}
		}
	}
}

func (c *VersionChecker) Refresh(ctx context.Context) error {
	if c == nil || c.client == nil || c.repo == "" {
		return errors.New("version checker is not configured")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.github.com/repos/"+c.repo+"/releases/latest", nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "Dashwise")
	resp, err := c.client.Do(req)
	if err != nil {
		return fmt.Errorf("check GitHub release: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("GitHub release check returned HTTP %d", resp.StatusCode)
	}
	var release struct {
		TagName string `json:"tag_name"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&release); err != nil {
		return fmt.Errorf("decode GitHub release: %w", err)
	}
	if _, ok := parsedVersion(release.TagName); !ok {
		return errors.New("GitHub latest release tag is not a semantic version")
	}
	c.mu.Lock()
	c.latest = strings.TrimSpace(release.TagName)
	c.mu.Unlock()
	return nil
}

type semanticVersion struct {
	major, minor, patch uint64
	pre                 []string
}

func parsedVersion(value string) (semanticVersion, bool) {
	parts := versionPattern.FindStringSubmatch(strings.TrimSpace(value))
	if len(parts) != 5 {
		return semanticVersion{}, false
	}
	major, err := strconv.ParseUint(parts[1], 10, 64)
	if err != nil {
		return semanticVersion{}, false
	}
	minor, err := strconv.ParseUint(parts[2], 10, 64)
	if err != nil {
		return semanticVersion{}, false
	}
	patch, err := strconv.ParseUint(parts[3], 10, 64)
	if err != nil {
		return semanticVersion{}, false
	}
	version := semanticVersion{major: major, minor: minor, patch: patch}
	if parts[4] != "" {
		version.pre = strings.Split(parts[4], ".")
	}
	return version, true
}

func compareVersions(left, right string) int {
	a, okA := parsedVersion(left)
	b, okB := parsedVersion(right)
	if !okA || !okB {
		return 0
	}
	for _, pair := range [][2]uint64{{a.major, b.major}, {a.minor, b.minor}, {a.patch, b.patch}} {
		if pair[0] < pair[1] {
			return -1
		}
		if pair[0] > pair[1] {
			return 1
		}
	}
	if len(a.pre) == 0 && len(b.pre) == 0 {
		return 0
	}
	if len(a.pre) == 0 {
		return 1
	}
	if len(b.pre) == 0 {
		return -1
	}
	for i := 0; i < len(a.pre) && i < len(b.pre); i++ {
		leftPart, rightPart := a.pre[i], b.pre[i]
		leftNumber, leftErr := strconv.ParseUint(leftPart, 10, 64)
		rightNumber, rightErr := strconv.ParseUint(rightPart, 10, 64)
		switch {
		case leftErr == nil && rightErr == nil:
			if leftNumber < rightNumber {
				return -1
			}
			if leftNumber > rightNumber {
				return 1
			}
		case leftErr == nil:
			return -1
		case rightErr == nil:
			return 1
		default:
			if leftPart < rightPart {
				return -1
			}
			if leftPart > rightPart {
				return 1
			}
		}
	}
	if len(a.pre) < len(b.pre) {
		return -1
	}
	if len(a.pre) > len(b.pre) {
		return 1
	}
	return 0
}
