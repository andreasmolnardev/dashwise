// Package wallpapersapi exposes authenticated wallpaper upload and retrieval.
package wallpapersapi

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"image"
	"image/draw"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"mime"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resourceapi"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/wallpapers"
	"github.com/gen2brain/webp"
	xdraw "golang.org/x/image/draw"
)

const maxImageBytes = 25 << 20

const (
	maxWallpaperWidth  = 3840
	maxWallpaperHeight = 2160
	maxWallpaperPixels = int64(120_000_000)
)

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
	convertWebP := false
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
		convertWebP = body.ConvertWebP
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
		convertWebP = r.FormValue("convertToWebp") == "true" || r.FormValue("convertToWebp") == "1"
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
	filename = filepath.Base(strings.ReplaceAll(filename, "\\", "/"))
	if filename == "" || filename == "." || filename == "/" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid filename"})
		return
	}
	if convertWebP {
		filename = strings.TrimSuffix(filename, filepath.Ext(filename)) + ".webp"
	}
	contents, contentType, err = prepareWallpaper(contents, contentType, convertWebP)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Could not process image"})
		return
	}
	mediaType, _, err = mime.ParseMediaType(contentType)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Could not determine processed image type"})
		return
	}
	if len(contents) == 0 || len(contents) > maxImageBytes {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "Processed image exceeds 25 MB"})
		return
	}
	if _, err := h.store.Save(r.Context(), owner, filename, mediaType, contents); err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"success": true, "path": "/api/v1/wallpapers?fileName=" + url.QueryEscape(filename)})
}

func prepareWallpaper(contents []byte, contentType string, convertWebP bool) ([]byte, string, error) {
	config, _, configErr := image.DecodeConfig(bytes.NewReader(contents))
	if configErr != nil {
		if convertWebP {
			return nil, "", configErr
		}
		return contents, contentType, nil
	}
	if config.Width <= 0 || config.Height <= 0 || int64(config.Width)*int64(config.Height) > maxWallpaperPixels {
		return nil, "", errors.New("image dimensions exceed processing limit")
	}
	needsResize := config.Width > maxWallpaperWidth || config.Height > maxWallpaperHeight
	if !needsResize && !convertWebP {
		return contents, contentType, nil
	}
	source, format, err := image.Decode(bytes.NewReader(contents))
	if err != nil {
		return nil, "", err
	}
	if needsResize {
		size := fitWallpaper(config.Width, config.Height, maxWallpaperWidth, maxWallpaperHeight)
		resized := image.NewRGBA(image.Rect(0, 0, size.X, size.Y))
		xdraw.CatmullRom.Scale(resized, resized.Bounds(), source, source.Bounds(), draw.Src, nil)
		source = resized
	}
	var encoded bytes.Buffer
	if convertWebP {
		if err := webp.Encode(&encoded, source, webp.Options{Quality: 80}); err != nil {
			return nil, "", err
		}
		return encoded.Bytes(), "image/webp", nil
	}
	switch format {
	case "jpeg":
		err = jpeg.Encode(&encoded, source, &jpeg.Options{Quality: 80})
	case "png":
		err = png.Encode(&encoded, source)
	case "gif":
		err = gif.Encode(&encoded, source, nil)
	case "webp":
		err = webp.Encode(&encoded, source, webp.Options{Quality: 80})
	default:
		return nil, "", errors.New("unsupported image format for resizing")
	}
	if err != nil {
		return nil, "", err
	}
	return encoded.Bytes(), contentType, nil
}

func fitWallpaper(width, height, maxWidth, maxHeight int) image.Point {
	if width <= maxWidth && height <= maxHeight {
		return image.Pt(width, height)
	}
	widthRatio := float64(maxWidth) / float64(width)
	heightRatio := float64(maxHeight) / float64(height)
	ratio := widthRatio
	if heightRatio < ratio {
		ratio = heightRatio
	}
	return image.Pt(max(1, int(float64(width)*ratio)), max(1, int(float64(height)*ratio)))
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
