// Package wallpapersapi exposes authenticated wallpaper upload and retrieval.
package wallpapersapi

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resourceapi"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/wallpapers"
)

const maxImageBytes = 25 << 20

type Handler struct {
	store *wallpapers.Store
	auth  resourceapi.Authenticate
	mux   *http.ServeMux
}

func New(store *wallpapers.Store, authenticate resourceapi.Authenticate) (http.Handler, error) {
	if store == nil || authenticate == nil {
		return nil, errors.New("wallpaper API requires a store and authenticator")
	}
	h := &Handler{store: store, auth: authenticate, mux: http.NewServeMux()}
	h.mux.HandleFunc("GET /api/v1/wallpapers", h.get)
	h.mux.HandleFunc("POST /api/v1/wallpapers", h.upload)
	return h.mux, nil
}

func (h *Handler) owner(w http.ResponseWriter, r *http.Request) (string, bool) {
	if r.Header.Get("Authorization") == "" && r.URL.Query().Get("token") != "" {
		copy := r.Clone(r.Context())
		copy.Header = r.Header.Clone()
		copy.Header.Set("Authorization", "Bearer "+r.URL.Query().Get("token"))
		r = copy
	}
	owner, err := h.auth(r)
	if err != nil || strings.TrimSpace(owner) == "" {
		writeJSON(w, 401, map[string]string{"error": "authentication required"})
		return "", false
	}
	return owner, true
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	filename := r.URL.Query().Get("fileName")
	if filename == "" {
		writeJSON(w, 400, map[string]string{"error": "Missing fileName query parameter"})
		return
	}
	item, contents, err := h.store.Get(r.Context(), owner, filename)
	if errors.Is(err, wallpapers.ErrNotFound) {
		writeJSON(w, 404, map[string]string{"error": "Wallpaper not found"})
		return
	}
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "could not load wallpaper"})
		return
	}
	w.Header().Set("Content-Type", item.MIMEType)
	w.Header().Set("Cache-Control", "private, no-store")
	w.WriteHeader(200)
	_, _ = w.Write(contents)
}

func (h *Handler) upload(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var filename, contentType string
	var contents []byte
	if strings.Contains(r.Header.Get("Content-Type"), "application/json") {
		r.Body = http.MaxBytesReader(w, r.Body, ((maxImageBytes+2)/3)*4+1<<20)
		var body struct {
			FileName    string `json:"fileName"`
			MIMEType    string `json:"mimeType"`
			Content     string `json:"contentBase64"`
			ConvertWebP bool   `json:"convertToWebp"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, 400, map[string]string{"error": "Invalid JSON body"})
			return
		}
		filename, contentType = body.FileName, body.MIMEType
		var err error
		contents, err = base64.StdEncoding.DecodeString(body.Content)
		if err != nil {
			writeJSON(w, 400, map[string]string{"error": "Invalid contentBase64"})
			return
		}
		if body.ConvertWebP {
			writeJSON(w, 501, map[string]string{"error": "WebP conversion is not available in this build"})
			return
		}
	} else {
		r.Body = http.MaxBytesReader(w, r.Body, maxImageBytes+1<<20)
		if err := r.ParseMultipartForm(maxImageBytes); err != nil {
			writeJSON(w, 400, map[string]string{"error": "Invalid form data or incorrect content-type"})
			return
		}
		file, header, err := r.FormFile("image")
		if err != nil {
			writeJSON(w, 400, map[string]string{"error": "Missing image file"})
			return
		}
		defer file.Close()
		contents, err = io.ReadAll(io.LimitReader(file, maxImageBytes+1))
		if err != nil {
			writeJSON(w, 400, map[string]string{"error": "Could not read image"})
			return
		}
		filename = r.FormValue("fileName")
		if filename == "" {
			filename = header.Filename
		}
		contentType = header.Header.Get("Content-Type")
	}
	if len(contents) == 0 || len(contents) > maxImageBytes {
		writeJSON(w, 413, map[string]string{"error": "Image must be between 1 byte and 25 MB"})
		return
	}
	if contentType == "" {
		contentType = http.DetectContentType(contents)
	}
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil || !strings.HasPrefix(mediaType, "image/") {
		writeJSON(w, 400, map[string]string{"error": "Uploaded file must be an image"})
		return
	}
	if filename == "" {
		filename = "wallpaper" + filepath.Ext("image."+strings.SplitN(mediaType, "/", 2)[1])
	}
	if _, err := h.store.Save(r.Context(), owner, filename, mediaType, contents); err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"success": true, "path": "/api/v1/wallpapers?fileName=" + filename})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
