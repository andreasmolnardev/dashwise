// Package linksapi exposes the existing Dashwise Links HTTP contract over the
// SQLite-backed links domain. The link metadata endpoint lives in metadata.go.
package linksapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/andreasmolnardev/dashwise/apps/backend/internal/links"
	"github.com/andreasmolnardev/dashwise/apps/backend/internal/resourceapi"
)

const maxBodyBytes = 1 << 20

type Handler struct {
	store *links.Store
	auth  resourceapi.Authenticate
	mux   *http.ServeMux
}

func New(store *links.Store, authenticate resourceapi.Authenticate) (http.Handler, error) {
	if store == nil || authenticate == nil {
		return nil, errors.New("links API requires a store and authenticator")
	}
	h := &Handler{store: store, auth: authenticate, mux: http.NewServeMux()}
	h.mux.HandleFunc("GET /api/v1/links/collections", h.listCollections)
	h.mux.HandleFunc("POST /api/v1/links/collections", h.createCollection)
	h.mux.HandleFunc("PUT /api/v1/links/collections/{collectionId}", h.updateCollection)
	h.mux.HandleFunc("DELETE /api/v1/links/collections/{collectionId}", h.deleteCollection)
	h.mux.HandleFunc("DELETE /api/v1/links/dev/user-links", h.deleteDevelopmentUserLinks)
	h.mux.HandleFunc("GET /api/v1/links/home", h.homeLinks)
	h.mux.HandleFunc("POST /api/v1/links/home/groups/cleanup", h.cleanupGroups)
	h.mux.HandleFunc("GET /api/v1/links/home/groups", h.listGroups)
	h.mux.HandleFunc("POST /api/v1/links/home/groups", h.createGroup)
	h.mux.HandleFunc("PUT /api/v1/links/home/groups", h.renameGroup)
	h.mux.HandleFunc("DELETE /api/v1/links/home/groups/{groupName}", h.deleteGroup)
	h.mux.HandleFunc("GET /api/v1/links/folders", h.listFolders)
	h.mux.HandleFunc("POST /api/v1/links/folders", h.createFolder)
	h.mux.HandleFunc("PUT /api/v1/links/folders/{folderId}/icon", h.updateFolderIcon)
	h.mux.HandleFunc("GET /api/v1/links/items", h.listItems)
	h.mux.HandleFunc("POST /api/v1/links/items", h.createItem)
	h.mux.HandleFunc("PUT /api/v1/links/items/{linkId}", h.updateItem)
	h.mux.HandleFunc("DELETE /api/v1/links/items/{linkId}", h.deleteItem)
	h.mux.HandleFunc("POST /api/v1/links/reorder", h.reorder)
	h.mux.HandleFunc("GET /api/v1/links/tags", h.listTags)
	h.mux.HandleFunc("POST /api/v1/links/tags", h.createTag)
	h.mux.HandleFunc("PUT /api/v1/links/tags/{tagId}", h.updateTag)
	h.mux.HandleFunc("GET /api/v1/links/rss", h.listRSS)
	h.mux.HandleFunc("POST /api/v1/links/rss", h.createRSS)
	h.mux.HandleFunc("PUT /api/v1/links/rss/{feedId}", h.updateRSS)
	h.mux.HandleFunc("DELETE /api/v1/links/rss/{feedId}", h.deleteRSS)
	h.mux.HandleFunc("GET /api/v1/links/rss/{feedId}", h.publicRSS)
	h.mux.HandleFunc("GET /api/v1/links/metadata", h.linkMetadata)
	return h.mux, nil
}

func (h *Handler) deleteDevelopmentUserLinks(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	counts, err := h.store.DeleteDevelopmentUserLinks(r.Context(), owner)
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, counts)
}

func (h *Handler) listCollections(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	items, err := h.store.ListCollections(r.Context(), owner)
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *Handler) createCollection(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var input struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Icon        string `json:"icon"`
	}
	if !h.decode(w, r, &input) {
		return
	}
	item, err := h.store.CreateCollection(r.Context(), owner, links.CollectionInput{Name: input.Name, Description: input.Description, Icon: input.Icon})
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (h *Handler) updateCollection(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var envelope struct {
		Data struct {
			Name        *string `json:"name"`
			Description *string `json:"description"`
			Icon        *string `json:"icon"`
		} `json:"data"`
	}
	if !h.decode(w, r, &envelope) {
		return
	}
	d := envelope.Data
	item, err := h.store.UpdateCollection(r.Context(), owner, r.PathValue("collectionId"), links.CollectionInput{Name: value(d.Name), Description: value(d.Description), Icon: value(d.Icon)}, d.Name != nil, d.Description != nil)
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": item.ID, "name": item.Name, "description": item.Description, "type": item.Type})
}

func (h *Handler) deleteCollection(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	if err := h.store.DeleteCollection(r.Context(), owner, r.PathValue("collectionId")); err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, nil)
}

func (h *Handler) homeLinks(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	items, err := h.store.HomeLinks(r.Context(), owner)
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *Handler) listGroups(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	items, err := h.store.HomeGroups(r.Context(), owner)
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *Handler) createGroup(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	if !h.decode(w, r, &body) {
		return
	}
	folder, err := h.store.CreateHomeGroup(r.Context(), owner, body.Name)
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": folder.ID, "name": folder.Name})
}

func (h *Handler) renameGroup(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var body struct {
		CurrentName string `json:"currentName"`
		Name        string `json:"name"`
	}
	if !h.decode(w, r, &body) {
		return
	}
	oldName := strings.TrimSpace(body.CurrentName)
	folder, err := h.store.RenameHomeGroup(r.Context(), owner, oldName, body.Name)
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"oldName": oldName, "name": folder.Name})
}

func (h *Handler) deleteGroup(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	name := r.PathValue("groupName")
	result, err := h.deleteGroupTree(r.Context(), owner, name)
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) cleanupGroups(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	groups, err := h.store.HomeGroups(r.Context(), owner)
	if err != nil {
		h.fail(w, err)
		return
	}
	deleted := []string{}
	for _, name := range groups {
		count, err := h.deleteEmptyGroup(r.Context(), owner, name)
		if err != nil {
			if errors.Is(err, links.ErrNotFound) {
				continue
			}
			h.fail(w, err)
			return
		}
		if count {
			deleted = append(deleted, name)
		}
	}
	writeJSON(w, http.StatusOK, map[string][]string{"deletedGroups": deleted})
}

func (h *Handler) deleteEmptyGroup(ctx context.Context, owner, name string) (bool, error) {
	collection, err := h.store.HomeCollection(ctx, owner)
	if err != nil {
		return false, err
	}
	folders, err := h.store.ListFolders(ctx, owner, collection.ID)
	if err != nil {
		return false, err
	}
	items, err := h.store.ListItems(ctx, owner, collection.ID, nil)
	if err != nil {
		return false, err
	}
	root, subtree := findFolderTree(folders, name)
	if root.ID == "" {
		return false, links.ErrNotFound
	}
	ids := map[string]bool{}
	for _, f := range subtree {
		ids[f.ID] = true
	}
	for _, item := range items {
		if ids[item.Folder] {
			return false, nil
		}
	}
	for i := len(subtree) - 1; i >= 0; i-- {
		if err := h.store.DeleteFolder(ctx, owner, subtree[i].ID); err != nil {
			return false, err
		}
	}
	return true, nil
}

func (h *Handler) deleteGroupTree(ctx context.Context, owner, name string) (map[string]any, error) {
	collection, err := h.store.HomeCollection(ctx, owner)
	if err != nil {
		return nil, err
	}
	folders, err := h.store.ListFolders(ctx, owner, collection.ID)
	if err != nil {
		return nil, err
	}
	items, err := h.store.ListItems(ctx, owner, collection.ID, nil)
	if err != nil {
		return nil, err
	}
	root, subtree := findFolderTree(folders, name)
	if root.ID == "" {
		return nil, links.ErrNotFound
	}
	ids := map[string]bool{}
	for _, f := range subtree {
		ids[f.ID] = true
	}
	deleted := 0
	for _, item := range items {
		if ids[item.Folder] {
			if err := h.store.DeleteItem(ctx, owner, item.ID); err != nil {
				return nil, err
			}
			deleted++
		}
	}
	for i := len(subtree) - 1; i >= 0; i-- {
		if err := h.store.DeleteFolder(ctx, owner, subtree[i].ID); err != nil {
			return nil, err
		}
	}
	return map[string]any{"deletedGroup": root.Name, "deletedLinks": deleted}, nil
}

func findFolderTree(folders []links.Folder, name string) (links.Folder, []links.Folder) {
	var root links.Folder
	for _, f := range folders {
		if f.ParentFolder == "" && strings.EqualFold(strings.TrimSpace(f.Name), strings.TrimSpace(name)) {
			root = f
			break
		}
	}
	if root.ID == "" {
		return root, nil
	}
	children := map[string][]links.Folder{}
	for _, f := range folders {
		children[f.ParentFolder] = append(children[f.ParentFolder], f)
	}
	tree := []links.Folder{}
	stack := []links.Folder{root}
	for len(stack) > 0 {
		last := len(stack) - 1
		f := stack[last]
		stack = stack[:last]
		tree = append(tree, f)
		stack = append(stack, children[f.ID]...)
	}
	return root, tree
}

func (h *Handler) listFolders(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	listID := r.URL.Query().Get("listId")
	if listID == "" {
		writeError(w, http.StatusBadRequest, "listId is required")
		return
	}
	items, err := h.store.ListFolders(r.Context(), owner, listID)
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *Handler) createFolder(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var body struct {
		List         string `json:"list"`
		Name         string `json:"name"`
		ParentFolder string `json:"parentFolder"`
		Icon         string `json:"icon"`
	}
	if !h.decode(w, r, &body) {
		return
	}
	folder, err := h.store.CreateFolder(r.Context(), owner, links.FolderInput{List: body.List, Name: body.Name, ParentFolder: body.ParentFolder, Icon: body.Icon})
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": folder.ID, "name": folder.Name, "icon": folder.Icon, "parentFolder": optional(folder.ParentFolder), "list": folder.List})
}

func (h *Handler) updateFolderIcon(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var envelope struct {
		Data struct {
			Icon *string `json:"icon"`
		} `json:"data"`
	}
	if !h.decode(w, r, &envelope) {
		return
	}
	folder, err := h.store.SetFolderIcon(r.Context(), owner, r.PathValue("folderId"), value(envelope.Data.Icon))
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": folder.ID, "name": folder.Name, "icon": folder.Icon})
}

func (h *Handler) listItems(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	listID := r.URL.Query().Get("listId")
	if listID == "" {
		writeError(w, http.StatusBadRequest, "listId is required")
		return
	}
	var folderID *string
	if value, exists := r.URL.Query()["folderId"]; exists {
		v := value[len(value)-1]
		folderID = &v
	}
	items, err := h.store.ListItems(r.Context(), owner, listID, folderID)
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *Handler) createItem(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var body struct {
		URL           string               `json:"url"`
		Title         string               `json:"title"`
		IconURL       string               `json:"iconUrl"`
		Description   string               `json:"description"`
		Collection    string               `json:"collection"`
		Folder        string               `json:"folder"`
		LinkGroup     string               `json:"linkGroup"`
		Tags          []string             `json:"tags"`
		SecondaryURLs []links.SecondaryURL `json:"secondaryUrls"`
	}
	if !h.decode(w, r, &body) {
		return
	}
	input := links.ItemInput{URL: body.URL, Title: body.Title, IconURL: body.IconURL, Description: body.Description, Collection: body.Collection, Folder: body.Folder, Tags: body.Tags, SecondaryURLs: body.SecondaryURLs}
	if strings.TrimSpace(body.Collection) == "" {
		collection, err := h.store.HomeCollection(r.Context(), owner)
		if err != nil {
			h.fail(w, err)
			return
		}
		input.Collection = collection.ID
		group := strings.TrimSpace(body.LinkGroup)
		if group != "" {
			folder, err := h.store.CreateHomeGroup(r.Context(), owner, group)
			if err != nil {
				h.fail(w, err)
				return
			}
			input.Folder = folder.ID
			if child := strings.TrimSpace(body.Folder); child != "" {
				folders, err := h.store.ListFolders(r.Context(), owner, collection.ID)
				if err != nil {
					h.fail(w, err)
					return
				}
				input.Folder = ""
				for _, f := range folders {
					if f.ParentFolder == folder.ID && strings.EqualFold(f.Name, child) {
						input.Folder = f.ID
						break
					}
				}
				if input.Folder == "" {
					f, err := h.store.CreateFolder(r.Context(), owner, links.FolderInput{List: collection.ID, ParentFolder: folder.ID, Name: child})
					if err != nil {
						h.fail(w, err)
						return
					}
					input.Folder = f.ID
				}
			}
		}
	}
	item, err := h.store.CreateItem(r.Context(), owner, input)
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (h *Handler) updateItem(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var body struct {
		URL           *string               `json:"url"`
		Title         *string               `json:"title"`
		IconURL       *string               `json:"iconUrl"`
		Description   *string               `json:"description"`
		Collection    *string               `json:"collection"`
		Folder        *string               `json:"folder"`
		LinkGroup     *string               `json:"linkGroup"`
		Tags          *[]string             `json:"tags"`
		SecondaryURLs *[]links.SecondaryURL `json:"secondaryUrls"`
	}
	if !h.decode(w, r, &body) {
		return
	}
	id := r.PathValue("linkId")
	collections, err := h.store.ListCollections(r.Context(), owner)
	if err != nil {
		h.fail(w, err)
		return
	}
	var existing *links.Item
	for _, collection := range collections {
		items, listErr := h.store.ListItems(r.Context(), owner, collection.ID, nil)
		if listErr != nil {
			h.fail(w, listErr)
			return
		}
		for i := range items {
			if items[i].ID == id {
				existing = &items[i]
				break
			}
		}
		if existing != nil {
			break
		}
	}
	if existing == nil {
		h.fail(w, links.ErrNotFound)
		return
	}
	patch := links.ItemPatch{URL: body.URL, Title: body.Title, IconURL: body.IconURL, Description: body.Description, Tags: body.Tags, SecondaryURLs: body.SecondaryURLs}
	isHome := false
	for _, c := range collections {
		if c.ID == existing.Collection && c.Type == "home" {
			isHome = true
			break
		}
	}
	if isHome && (body.LinkGroup != nil || body.Folder != nil) {
		collection, err := h.store.HomeCollection(r.Context(), owner)
		if err != nil {
			h.fail(w, err)
			return
		}
		groupName := ""
		if body.LinkGroup != nil {
			groupName = strings.TrimSpace(*body.LinkGroup)
		}
		folderID := ""
		if groupName != "" {
			group, err := h.store.CreateHomeGroup(r.Context(), owner, groupName)
			if err != nil {
				h.fail(w, err)
				return
			}
			folderID = group.ID
			if body.Folder != nil && strings.TrimSpace(*body.Folder) != "" {
				folders, err := h.store.ListFolders(r.Context(), owner, collection.ID)
				if err != nil {
					h.fail(w, err)
					return
				}
				childName := strings.TrimSpace(*body.Folder)
				for _, f := range folders {
					if f.ParentFolder == group.ID && strings.EqualFold(f.Name, childName) {
						folderID = f.ID
						break
					}
				}
				if folderID == group.ID {
					child, err := h.store.CreateFolder(r.Context(), owner, links.FolderInput{List: collection.ID, ParentFolder: group.ID, Name: childName})
					if err != nil {
						h.fail(w, err)
						return
					}
					folderID = child.ID
				}
			}
		}
		patch.Collection = &collection.ID
		patch.Folder = &folderID
	} else {
		patch.Collection = body.Collection
		patch.Folder = body.Folder
	}
	_, err = h.store.UpdateItem(r.Context(), owner, id, patch)
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, nil)
}

func (h *Handler) deleteItem(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	if err := h.store.DeleteItem(r.Context(), owner, r.PathValue("linkId")); err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, nil)
}

func (h *Handler) reorder(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var body struct {
		Items []struct {
			ID       string `json:"id"`
			Type     string `json:"type"`
			Position int    `json:"position"`
		} `json:"items"`
	}
	if !h.decode(w, r, &body) {
		return
	}
	items := make([]links.ReorderInput, 0, len(body.Items))
	for _, i := range body.Items {
		items = append(items, links.ReorderInput{ID: i.ID, Type: i.Type, Position: i.Position})
	}
	if err := h.store.Reorder(r.Context(), owner, items); err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, nil)
}

func (h *Handler) listTags(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	items, err := h.store.ListTags(r.Context(), owner)
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}
func (h *Handler) createTag(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var body struct {
		Name  string `json:"name"`
		Color string `json:"color"`
	}
	if !h.decode(w, r, &body) {
		return
	}
	item, err := h.store.CreateTag(r.Context(), owner, links.TagInput{Name: body.Name, Color: body.Color})
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}
func (h *Handler) updateTag(w http.ResponseWriter, r *http.Request) {
	owner, ok := h.owner(w, r)
	if !ok {
		return
	}
	var envelope struct {
		Data struct {
			Name  *string `json:"name"`
			Color *string `json:"color"`
		} `json:"data"`
	}
	if !h.decode(w, r, &envelope) {
		return
	}
	d := envelope.Data
	item, err := h.store.UpdateTag(r.Context(), owner, r.PathValue("tagId"), links.TagInput{Name: value(d.Name), Color: value(d.Color)}, d.Name != nil, d.Color != nil)
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (h *Handler) owner(w http.ResponseWriter, r *http.Request) (string, bool) {
	owner, err := h.auth(r)
	if err != nil || strings.TrimSpace(owner) == "" {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return "", false
	}
	return owner, true
}
func (h *Handler) decode(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(dst); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request body")
		return false
	}
	var trailing any
	if !errors.Is(dec.Decode(&trailing), io.EOF) {
		writeError(w, http.StatusBadRequest, "request body must contain one JSON value")
		return false
	}
	return true
}
func (h *Handler) fail(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, links.ErrNotFound):
		writeError(w, http.StatusNotFound, "link record not found")
	case errors.Is(err, links.ErrInvalid):
		writeError(w, http.StatusBadRequest, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, "links request failed")
	}
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
func value(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}
func optional(v string) any {
	if v == "" {
		return nil
	}
	return v
}
