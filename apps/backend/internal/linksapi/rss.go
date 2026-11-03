package linksapi

import (
	"bytes"
	"encoding/xml"
	"net/http"
	"strings"
	"time"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/links"
)

type rssInput struct {
	Name         string   `json:"name"`
	ListID       string   `json:"listId"`
	TagIDs       []string `json:"tagIds"`
	LinkIDs      []string `json:"linkIds"`
	RequiresAuth bool     `json:"requiresAuth"`
}

func (h *Handler) listRSS(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	items, err := h.store.ListRSSFeeds(r.Context(), owner)
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, 200, items)
}
func (h *Handler) createRSS(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var in rssInput
	if !h.decode(w, r, &in) {
		return
	}
	item, err := h.store.CreateRSSFeed(r.Context(), owner, links.RSSInput{Name: in.Name, ListID: in.ListID, TagIDs: in.TagIDs, LinkIDs: in.LinkIDs, RequiresAuth: in.RequiresAuth})
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, 200, item)
}
func (h *Handler) updateRSS(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var in rssInput
	if !h.decode(w, r, &in) {
		return
	}
	item, err := h.store.UpdateRSSFeed(r.Context(), owner, r.PathValue("feedId"), links.RSSInput{Name: in.Name, ListID: in.ListID, TagIDs: in.TagIDs, LinkIDs: in.LinkIDs, RequiresAuth: in.RequiresAuth})
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, 200, item)
}
func (h *Handler) deleteRSS(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	id := r.PathValue("feedId")
	if err := h.store.DeleteRSSFeed(r.Context(), owner, id); err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, 200, map[string]string{"id": id})
}
func (h *Handler) publicRSS(w http.ResponseWriter, r *http.Request) {
	feed, err := h.store.GetRSSFeedPublic(r.Context(), r.PathValue("feedId"))
	if err != nil {
		h.fail(w, err)
		return
	}
	if feed.RequiresAuth {
		owner, ok := h.owner(w, r)
		if !ok {
			return
		}
		if owner != feed.User {
			writeError(w, 401, "Unauthorized")
			return
		}
	}
	items, err := h.store.RSSItems(r.Context(), feed)
	if err != nil {
		h.fail(w, err)
		return
	}
	var buffer bytes.Buffer
	buffer.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n<rss version=\"2.0\">\n<channel>\n")
	writeXMLTag(&buffer, "title", feed.Name)
	writeXMLTag(&buffer, "link", requestOrigin(r))
	writeXMLTag(&buffer, "description", "Links from Dashwise")
	writeXMLTag(&buffer, "lastBuildDate", time.Now().UTC().Format(time.RFC1123Z))
	for _, item := range items {
		buffer.WriteString("<item>\n")
		writeXMLTag(&buffer, "title", item.Title)
		writeXMLTag(&buffer, "link", item.URL)
		writeXMLTagAttr(&buffer, "guid", item.ID, `isPermaLink="false"`)
		writeXMLTag(&buffer, "description", item.Description)
		writeXMLTag(&buffer, "pubDate", item.Updated.UTC().Format(time.RFC1123Z))
		buffer.WriteString("</item>\n")
	}
	buffer.WriteString("</channel>\n</rss>")
	w.Header().Set("Content-Type", "application/rss+xml; charset=utf-8")
	if feed.RequiresAuth {
		w.Header().Set("Cache-Control", "private, no-store")
	} else {
		w.Header().Set("Cache-Control", "public, max-age=300")
	}
	w.WriteHeader(200)
	_, _ = w.Write(buffer.Bytes())
}
func writeXMLTag(buffer *bytes.Buffer, name, value string) { writeXMLTagAttr(buffer, name, value, "") }
func writeXMLTagAttr(buffer *bytes.Buffer, name, value, attributes string) {
	buffer.WriteString("  <" + name)
	if attributes != "" {
		buffer.WriteByte(' ')
		buffer.WriteString(attributes)
	}
	buffer.WriteByte('>')
	_ = xml.EscapeText(buffer, []byte(value))
	buffer.WriteString("</" + name + ">\n")
}
func requestOrigin(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	if proto := strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")); proto == "http" || proto == "https" {
		scheme = proto
	}
	host := strings.TrimSpace(r.Header.Get("X-Forwarded-Host"))
	if host == "" {
		host = r.Host
	}
	return scheme + "://" + host
}
