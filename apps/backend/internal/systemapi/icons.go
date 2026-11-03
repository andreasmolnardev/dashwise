package systemapi

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	iconArchiveURL      = "https://codeload.github.com/selfhst/icons/tar.gz/refs/heads/main"
	maxIconArchiveBytes = 128 << 20
	maxIconExpanded     = 512 << 20
)

func (h *Handler) pullIcons(w http.ResponseWriter, r *http.Request) {
	if !h.owner(w, r) {
		return
	}
	if !h.iconsMu.TryLock() {
		writeJSON(w, http.StatusConflict, map[string]string{"status": "busy", "message": "icon refresh is already running"})
		return
	}
	defer h.iconsMu.Unlock()
	if err := h.refreshIcons(r.Context()); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"status": "error", "message": "could not refresh icons"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func (h *Handler) refreshIcons(parent context.Context) error {
	ctx, cancel := context.WithTimeout(parent, 2*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, iconArchiveURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "Dashwise/2 icon refresh")
	resp, err := (&http.Client{Timeout: 2 * time.Minute}).Do(req)
	if err != nil {
		return fmt.Errorf("download icons: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download icons returned HTTP %d", resp.StatusCode)
	}
	if resp.ContentLength > maxIconArchiveBytes {
		return fmt.Errorf("icon archive exceeds size limit")
	}
	root := filepath.Dir(h.iconsDir)
	if err := os.MkdirAll(root, 0o755); err != nil {
		return fmt.Errorf("create icon directory: %w", err)
	}
	tempRoot, err := os.MkdirTemp(root, ".icons-refresh-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tempRoot)
	staged := filepath.Join(tempRoot, "icons")
	if err := os.MkdirAll(staged, 0o755); err != nil {
		return err
	}
	compressed := &io.LimitedReader{R: resp.Body, N: maxIconArchiveBytes + 1}
	gz, err := gzip.NewReader(compressed)
	if err != nil {
		return fmt.Errorf("open icon archive: %w", err)
	}
	defer gz.Close()
	if err := extractIconArchive(tar.NewReader(gz), staged); err != nil {
		return err
	}
	if compressed.N <= 0 {
		return fmt.Errorf("icon archive exceeds size limit")
	}
	backup := filepath.Join(tempRoot, "previous-icons")
	hadExisting := false
	if _, err := os.Stat(h.iconsDir); err == nil {
		if err := os.Rename(h.iconsDir, backup); err != nil {
			return fmt.Errorf("preserve existing icons: %w", err)
		}
		hadExisting = true
	} else if !os.IsNotExist(err) {
		return err
	}
	if err := os.Rename(staged, h.iconsDir); err != nil {
		if hadExisting {
			_ = os.Rename(backup, h.iconsDir)
		}
		return fmt.Errorf("install refreshed icons: %w", err)
	}
	return nil
}

func extractIconArchive(reader *tar.Reader, target string) error {
	seen := map[string]bool{}
	var expanded int64
	files := 0
	for {
		header, err := reader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("read icon archive: %w", err)
		}
		files++
		if files > 50000 {
			return fmt.Errorf("icon archive contains too many entries")
		}
		name := filepath.ToSlash(filepath.Clean(header.Name))
		parts := strings.Split(name, "/")
		if len(parts) < 2 || parts[0] == "." || parts[0] == ".." || strings.HasPrefix(name, "/") {
			return fmt.Errorf("invalid icon archive path")
		}
		rel := strings.Join(parts[1:], "/")
		if rel == "" || !(strings.HasPrefix(rel, "svg/") || strings.HasPrefix(rel, "webp/") || strings.HasPrefix(rel, "png/") || rel == "tags.json" || rel == "index.json") {
			continue
		}
		destination := filepath.Join(target, filepath.FromSlash(rel))
		if !within(target, destination) {
			return fmt.Errorf("icon archive path escapes target")
		}
		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(destination, 0o755); err != nil {
				return err
			}
		case tar.TypeReg, tar.TypeRegA:
			if header.Size < 0 || header.Size > maxIconExpanded || expanded+header.Size > maxIconExpanded {
				return fmt.Errorf("expanded icon archive exceeds size limit")
			}
			if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
				return err
			}
			file, err := os.OpenFile(destination, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
			if err != nil {
				return err
			}
			written, copyErr := io.CopyN(file, reader, header.Size)
			closeErr := file.Close()
			if copyErr != nil {
				return copyErr
			}
			if closeErr != nil {
				return closeErr
			}
			expanded += written
			if rel == "tags.json" || rel == "index.json" {
				seen[rel] = true
			} else {
				seen[strings.SplitN(rel, "/", 2)[0]] = true
			}
		}
	}
	for _, required := range []string{"svg", "webp", "png", "tags.json", "index.json"} {
		if !seen[required] {
			return fmt.Errorf("icon archive is missing %s", required)
		}
	}
	return nil
}

func within(root, candidate string) bool {
	rel, err := filepath.Rel(root, candidate)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}
