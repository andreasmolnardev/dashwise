// Package links contains Dashwise's owner-scoped Links domain backed by SQLite.
package links

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/andreasmolnardev/dashwise/packages/foundation"
)

var (
	ErrNotFound = errors.New("link record not found")
	ErrInvalid  = errors.New("invalid link input")
)

type Store struct {
	db         *sql.DB
	foundation *foundation.DB
}

type Collection struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Icon        string    `json:"icon"`
	Type        string    `json:"type"`
	Created     time.Time `json:"created"`
	Updated     time.Time `json:"updated"`
}

type Folder struct {
	ID           string    `json:"id"`
	List         string    `json:"list"`
	Name         string    `json:"name"`
	Icon         string    `json:"icon"`
	ParentFolder string    `json:"parentFolder,omitempty"`
	Position     int       `json:"position"`
	Tags         []string  `json:"tags,omitempty"`
	Created      time.Time `json:"created"`
	Updated      time.Time `json:"updated"`
}

type SecondaryURL struct {
	Name        string `json:"name"`
	URL         string `json:"url"`
	RoutingRule string `json:"routingRule"`
}

type Item struct {
	ID            string         `json:"id"`
	URL           string         `json:"url"`
	SecondaryURLs []SecondaryURL `json:"secondaryUrls,omitempty"`
	Title         string         `json:"title"`
	IconURL       string         `json:"iconUrl"`
	Description   string         `json:"description"`
	Collection    string         `json:"collection"`
	Folder        string         `json:"folder,omitempty"`
	Position      int            `json:"position"`
	Favorite      bool           `json:"favorite"`
	Tags          []string       `json:"tags,omitempty"`
	Created       time.Time      `json:"created"`
	Updated       time.Time      `json:"updated"`
}

type Tag struct {
	ID      string    `json:"id"`
	Name    string    `json:"name"`
	Color   string    `json:"color"`
	Created time.Time `json:"created"`
	Updated time.Time `json:"updated"`
}

type HomeLink struct {
	ID                  string         `json:"id"`
	URL                 string         `json:"url"`
	SecondaryURLs       []SecondaryURL `json:"secondaryUrls,omitempty"`
	Title               string         `json:"title"`
	IconURL             string         `json:"iconUrl"`
	Description         string         `json:"description"`
	Position            int            `json:"position"`
	Collection          string         `json:"collection"`
	CollectionID        string         `json:"collectionId,omitempty"`
	Folder              string         `json:"folder,omitempty"`
	FolderID            string         `json:"folderId,omitempty"`
	FolderIcon          string         `json:"folderIcon,omitempty"`
	StatusCheck         bool           `json:"statusCheck"`
	StatusCheckEndpoint string         `json:"statusCheckEndpoint,omitempty"`
	StatusCheckMethod   string         `json:"statusCheckMethod"`
	StatusCheckShowAsUp []int          `json:"statusCheckShowAsUp,omitempty"`
	Favorite            bool           `json:"favorite"`
	Tags                []string       `json:"tags,omitempty"`
	Updated             time.Time      `json:"updated"`
}

type CollectionInput struct{ Name, Description, Icon string }
type FolderInput struct {
	List, Name, Icon, ParentFolder string
	Position                       int
	Tags                           []string
}
type ItemInput struct {
	URL, Title, IconURL, Description, Collection, Folder string
	Position                                             int
	Favorite                                             bool
	Tags                                                 []string
	SecondaryURLs                                        []SecondaryURL
}
type ItemPatch struct {
	URL           *string
	Title         *string
	IconURL       *string
	Description   *string
	Collection    *string
	Folder        *string
	Position      *int
	Favorite      *bool
	Tags          *[]string
	SecondaryURLs *[]SecondaryURL
}
type TagInput struct{ Name, Color string }
type ReorderInput struct {
	ID, Type string
	Position int
}

func New(db *foundation.DB) (*Store, error) {
	if db == nil || db.SQL() == nil {
		return nil, errors.New("links store requires an open database")
	}
	return &Store{db: db.SQL(), foundation: db}, nil
}

// DeleteDevelopmentUserLinks removes only owner-created link collections and
// their contents. The home and system collections are preserved.
func (s *Store) DeleteDevelopmentUserLinks(ctx context.Context, ownerID string) (map[string]int64, error) {
	if strings.TrimSpace(ownerID) == "" {
		return nil, ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	counts := map[string]int64{}
	queries := map[string]string{
		"deletedCollections": `SELECT COUNT(*) FROM links_collections WHERE owner_id=? AND type='user-defined'`,
		"deletedFolders":     `SELECT COUNT(*) FROM links_folders f JOIN links_collections c ON c.id=f.list_id WHERE f.owner_id=? AND c.owner_id=? AND c.type='user-defined'`,
		"deletedItems":       `SELECT COUNT(*) FROM link_items i JOIN links_collections c ON c.id=i.list_id WHERE i.owner_id=? AND c.owner_id=? AND c.type='user-defined'`,
	}
	for key, query := range queries {
		var count int64
		if strings.Count(query, "?") == 1 {
			err = tx.QueryRowContext(ctx, query, ownerID).Scan(&count)
		} else {
			err = tx.QueryRowContext(ctx, query, ownerID, ownerID).Scan(&count)
		}
		if err != nil {
			return nil, fmt.Errorf("count development user links: %w", err)
		}
		counts[key] = count
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM links_collections WHERE owner_id=? AND type='user-defined'`, ownerID); err != nil {
		return nil, fmt.Errorf("delete development user links: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return counts, nil
}

// Initialize installs the Links-owned schema and can safely be called on every startup.
func (s *Store) Initialize(ctx context.Context) error {
	return s.foundation.ApplyMigrations(ctx, []foundation.Migration{{
		ID: "0010_links_domain", Name: "create owner-scoped Links tables",
		Up: func(ctx context.Context, tx *sql.Tx) error {
			statements := []string{
				`CREATE TABLE IF NOT EXISTS links_collections (
			id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL,
			name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', icon TEXT NOT NULL DEFAULT '',
			type TEXT NOT NULL CHECK(type IN ('home','user-defined','system')),
			created_at TEXT NOT NULL, updated_at TEXT NOT NULL
		)`,
				`CREATE UNIQUE INDEX IF NOT EXISTS links_home_collection_per_owner ON links_collections(owner_id) WHERE type='home'`,
				`CREATE INDEX IF NOT EXISTS links_collections_by_owner ON links_collections(owner_id,type,created_at DESC)`,
				`CREATE TABLE IF NOT EXISTS links_folders (
			id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, list_id TEXT NOT NULL REFERENCES links_collections(id) ON DELETE CASCADE,
			name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT '', parent_folder_id TEXT NOT NULL DEFAULT '',
			position INTEGER NOT NULL DEFAULT 0, tags_json TEXT NOT NULL DEFAULT '[]',
			created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
			UNIQUE(list_id,parent_folder_id,name COLLATE NOCASE)
		)`,
				`CREATE INDEX IF NOT EXISTS links_folders_by_list ON links_folders(owner_id,list_id,parent_folder_id,position,name)`,
				`CREATE TABLE IF NOT EXISTS links_tags (
			id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(owner_id,name COLLATE NOCASE)
		)`,
				`CREATE TABLE IF NOT EXISTS link_items (
			id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, list_id TEXT NOT NULL REFERENCES links_collections(id) ON DELETE CASCADE,
			url TEXT NOT NULL, title TEXT NOT NULL, icon_url TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
			folder_id TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0, favorite INTEGER NOT NULL DEFAULT 0,
			tags_json TEXT NOT NULL DEFAULT '[]', secondary_urls_json TEXT NOT NULL DEFAULT '[]',
			created_at TEXT NOT NULL, updated_at TEXT NOT NULL
		)`,
				`CREATE INDEX IF NOT EXISTS link_items_by_collection ON link_items(owner_id,list_id,folder_id,position,title COLLATE NOCASE)`,
				`CREATE INDEX IF NOT EXISTS link_items_by_owner_title ON link_items(owner_id,title COLLATE NOCASE)`,
			}
			for _, stmt := range statements {
				if _, err := tx.ExecContext(ctx, stmt); err != nil {
					return fmt.Errorf("initialize links schema: %w", err)
				}
			}
			return nil
		},
		Down: func(ctx context.Context, tx *sql.Tx) error {
			_, err := tx.ExecContext(ctx, `DROP TABLE IF EXISTS link_items; DROP TABLE IF EXISTS links_folders; DROP TABLE IF EXISTS links_tags; DROP TABLE IF EXISTS links_collections;`)
			return err
		},
	}})
}

func (s *Store) HomeCollection(ctx context.Context, ownerID string) (Collection, error) {
	if err := requireOwner(ownerID); err != nil {
		return Collection{}, err
	}
	var c Collection
	err := s.db.QueryRowContext(ctx, `SELECT id,name,description,icon,type,created_at,updated_at FROM links_collections WHERE owner_id=? AND type='home'`, ownerID).Scan(&c.ID, &c.Name, &c.Description, &c.Icon, &c.Type, &c.Created, &c.Updated)
	if err == nil {
		return c, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Collection{}, err
	}
	return s.CreateHomeCollection(ctx, ownerID)
}

func (s *Store) CreateHomeCollection(ctx context.Context, ownerID string) (Collection, error) {
	if err := requireOwner(ownerID); err != nil {
		return Collection{}, err
	}
	now := timestamp()
	id, err := newID()
	if err != nil {
		return Collection{}, err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO links_collections(id,owner_id,name,description,icon,type,created_at,updated_at) VALUES(?,?, 'Home','','','home',?,?) ON CONFLICT DO NOTHING`, id, ownerID, now, now)
	if err != nil {
		return Collection{}, fmt.Errorf("create home collection: %w", err)
	}
	return s.HomeCollectionExisting(ctx, ownerID)
}

func (s *Store) HomeCollectionExisting(ctx context.Context, ownerID string) (Collection, error) {
	var c Collection
	err := s.db.QueryRowContext(ctx, `SELECT id,name,description,icon,type,created_at,updated_at FROM links_collections WHERE owner_id=? AND type='home'`, ownerID).Scan(&c.ID, &c.Name, &c.Description, &c.Icon, &c.Type, &c.Created, &c.Updated)
	return c, err
}

func (s *Store) ListCollections(ctx context.Context, ownerID string) ([]Collection, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,name,description,icon,type,created_at,updated_at FROM links_collections WHERE owner_id=? ORDER BY created_at DESC`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Collection{}
	for rows.Next() {
		var c Collection
		if err := rows.Scan(&c.ID, &c.Name, &c.Description, &c.Icon, &c.Type, &c.Created, &c.Updated); err != nil {
			return nil, err
		}
		items = append(items, c)
	}
	return items, rows.Err()
}

func (s *Store) CreateCollection(ctx context.Context, ownerID string, input CollectionInput) (Collection, error) {
	if err := requireOwner(ownerID); err != nil {
		return Collection{}, err
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return Collection{}, invalid("collection name is required")
	}
	return s.insertCollection(ctx, ownerID, name, input.Description, input.Icon, "user-defined")
}

func (s *Store) insertCollection(ctx context.Context, ownerID, name, description, icon, kind string) (Collection, error) {
	id, err := newID()
	if err != nil {
		return Collection{}, err
	}
	now := timestamp()
	_, err = s.db.ExecContext(ctx, `INSERT INTO links_collections(id,owner_id,name,description,icon,type,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`, id, ownerID, name, description, icon, kind, now, now)
	if err != nil {
		return Collection{}, fmt.Errorf("create links collection: %w", err)
	}
	return s.collectionByID(ctx, ownerID, id)
}

func (s *Store) UpdateCollection(ctx context.Context, ownerID, id string, input CollectionInput, updateName, updateDescription bool) (Collection, error) {
	c, err := s.collectionByID(ctx, ownerID, id)
	if err != nil {
		return Collection{}, err
	}
	if c.Type == "home" {
		return Collection{}, invalid("home collection cannot be renamed")
	}
	if updateName {
		c.Name = strings.TrimSpace(input.Name)
		if c.Name == "" {
			return Collection{}, invalid("collection name is required")
		}
	}
	if updateDescription {
		c.Description = input.Description
	}
	c.Updated = time.Now().UTC()
	_, err = s.db.ExecContext(ctx, `UPDATE links_collections SET name=?,description=?,updated_at=? WHERE owner_id=? AND id=?`, c.Name, c.Description, c.Updated.Format(time.RFC3339Nano), ownerID, id)
	if err != nil {
		return Collection{}, err
	}
	return c, nil
}

func (s *Store) DeleteCollection(ctx context.Context, ownerID, id string) error {
	if _, err := s.collectionByID(ctx, ownerID, id); err != nil {
		return err
	}
	res, err := s.db.ExecContext(ctx, `DELETE FROM links_collections WHERE owner_id=? AND id=? AND type!='home'`, ownerID, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return invalid("home collection cannot be deleted")
	}
	return nil
}

func (s *Store) ListFolders(ctx context.Context, ownerID, listID string) ([]Folder, error) {
	if _, err := s.collectionByID(ctx, ownerID, listID); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id,list_id,name,icon,parent_folder_id,position,tags_json,created_at,updated_at FROM links_folders WHERE owner_id=? AND list_id=? ORDER BY position,name COLLATE NOCASE`, ownerID, listID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Folder{}
	for rows.Next() {
		f, err := scanFolder(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, f)
	}
	return items, rows.Err()
}

func (s *Store) CreateFolder(ctx context.Context, ownerID string, input FolderInput) (Folder, error) {
	if _, err := s.collectionByID(ctx, ownerID, input.List); err != nil {
		return Folder{}, err
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return Folder{}, invalid("folder name is required")
	}
	if input.ParentFolder != "" {
		parent, err := s.folderByID(ctx, ownerID, input.ParentFolder)
		if err != nil {
			return Folder{}, err
		}
		if parent.List != input.List {
			return Folder{}, invalid("parent folder must be in the same collection")
		}
	}
	if err := s.validateOwnedTags(ctx, ownerID, input.Tags); err != nil {
		return Folder{}, err
	}
	id, err := newID()
	if err != nil {
		return Folder{}, err
	}
	now := timestamp()
	tags, _ := json.Marshal(cleanStrings(input.Tags))
	_, err = s.db.ExecContext(ctx, `INSERT INTO links_folders(id,owner_id,list_id,name,icon,parent_folder_id,position,tags_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`, id, ownerID, input.List, name, input.Icon, input.ParentFolder, input.Position, string(tags), now, now)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique constraint") {
			return s.findFolderByName(ctx, ownerID, input.List, input.ParentFolder, name)
		}
		return Folder{}, fmt.Errorf("create links folder: %w", err)
	}
	return s.folderByID(ctx, ownerID, id)
}

func (s *Store) UpdateFolder(ctx context.Context, ownerID, id string, input FolderInput) (Folder, error) {
	f, err := s.folderByID(ctx, ownerID, id)
	if err != nil {
		return Folder{}, err
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return Folder{}, invalid("folder name is required")
	}
	if input.ParentFolder == id {
		return Folder{}, invalid("folder cannot be its own parent")
	}
	parent := input.ParentFolder
	if input.ParentFolder != "" {
		p, err := s.folderByID(ctx, ownerID, parent)
		if err != nil {
			return Folder{}, err
		}
		if p.List != f.List {
			return Folder{}, invalid("parent folder must be in the same collection")
		}
		for p.ID != "" {
			if p.ID == id {
				return Folder{}, invalid("folder cannot be moved under itself")
			}
			if p.ParentFolder == "" {
				break
			}
			p, err = s.folderByID(ctx, ownerID, p.ParentFolder)
			if err != nil {
				return Folder{}, err
			}
		}
	}
	if err := s.validateOwnedTags(ctx, ownerID, input.Tags); err != nil {
		return Folder{}, err
	}
	tags, _ := json.Marshal(cleanStrings(input.Tags))
	now := timestamp()
	_, err = s.db.ExecContext(ctx, `UPDATE links_folders SET name=?,icon=?,parent_folder_id=?,position=?,tags_json=?,updated_at=? WHERE owner_id=? AND id=?`, name, input.Icon, parent, input.Position, string(tags), now, ownerID, id)
	if err != nil {
		return Folder{}, err
	}
	return s.folderByID(ctx, ownerID, id)
}

func (s *Store) DeleteFolder(ctx context.Context, ownerID, id string) error {
	if _, err := s.folderByID(ctx, ownerID, id); err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	// Keep contained links and child folders visible by moving them to the parent.
	var parent string
	if err := tx.QueryRowContext(ctx, `SELECT parent_folder_id FROM links_folders WHERE owner_id=? AND id=?`, ownerID, id).Scan(&parent); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE link_items SET folder_id=?,updated_at=? WHERE owner_id=? AND folder_id=?`, parent, timestamp(), ownerID, id); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE links_folders SET parent_folder_id=?,updated_at=? WHERE owner_id=? AND parent_folder_id=?`, parent, timestamp(), ownerID, id); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM links_folders WHERE owner_id=? AND id=?`, ownerID, id); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) SetFolderIcon(ctx context.Context, ownerID, id, icon string) (Folder, error) {
	if _, err := s.folderByID(ctx, ownerID, id); err != nil {
		return Folder{}, err
	}
	_, err := s.db.ExecContext(ctx, `UPDATE links_folders SET icon=?,updated_at=? WHERE owner_id=? AND id=?`, icon, timestamp(), ownerID, id)
	if err != nil {
		return Folder{}, err
	}
	return s.folderByID(ctx, ownerID, id)
}

func (s *Store) ListItems(ctx context.Context, ownerID, listID string, folderID *string) ([]Item, error) {
	if _, err := s.collectionByID(ctx, ownerID, listID); err != nil {
		return nil, err
	}
	query := `SELECT id,url,title,icon_url,description,list_id,folder_id,position,favorite,tags_json,secondary_urls_json,created_at,updated_at FROM link_items WHERE owner_id=? AND list_id=?`
	args := []any{ownerID, listID}
	if folderID != nil {
		query += ` AND folder_id=?`
		args = append(args, *folderID)
	}
	query += ` ORDER BY position,title COLLATE NOCASE`
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Item{}
	for rows.Next() {
		i, err := scanItem(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, i)
	}
	return items, rows.Err()
}

func (s *Store) CreateItem(ctx context.Context, ownerID string, input ItemInput) (Item, error) {
	if err := requireOwner(ownerID); err != nil {
		return Item{}, err
	}
	if err := validateURL(input.URL); err != nil {
		return Item{}, err
	}
	if strings.TrimSpace(input.Title) == "" {
		return Item{}, invalid("link title is required")
	}
	if _, err := s.collectionByID(ctx, ownerID, input.Collection); err != nil {
		return Item{}, err
	}
	if input.Folder != "" {
		f, err := s.folderByID(ctx, ownerID, input.Folder)
		if err != nil {
			return Item{}, err
		}
		if f.List != input.Collection {
			return Item{}, invalid("folder must belong to the selected collection")
		}
	}
	if err := s.validateOwnedTags(ctx, ownerID, input.Tags); err != nil {
		return Item{}, err
	}
	if input.Position == 0 {
		var max sql.NullInt64
		_ = s.db.QueryRowContext(ctx, `SELECT MAX(position) FROM link_items WHERE owner_id=? AND list_id=?`, ownerID, input.Collection).Scan(&max)
		if max.Valid {
			input.Position = int(max.Int64) + 1
		}
	}
	id, err := newID()
	if err != nil {
		return Item{}, err
	}
	now := timestamp()
	tags, _ := json.Marshal(cleanStrings(input.Tags))
	secondary, err := json.Marshal(normalizeSecondary(input.SecondaryURLs))
	if err != nil {
		return Item{}, err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO link_items(id,owner_id,list_id,url,title,icon_url,description,folder_id,position,favorite,tags_json,secondary_urls_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, ownerID, input.Collection, input.URL, strings.TrimSpace(input.Title), input.IconURL, input.Description, input.Folder, input.Position, boolInt(input.Favorite), string(tags), string(secondary), now, now)
	if err != nil {
		return Item{}, fmt.Errorf("create link item: %w", err)
	}
	return s.itemByID(ctx, ownerID, id)
}

func (s *Store) UpdateItem(ctx context.Context, ownerID, id string, patch ItemPatch) (Item, error) {
	item, err := s.itemByID(ctx, ownerID, id)
	if err != nil {
		return Item{}, err
	}
	if patch.URL != nil {
		if err := validateURL(*patch.URL); err != nil {
			return Item{}, err
		}
		item.URL = *patch.URL
	}
	if patch.Title != nil {
		item.Title = strings.TrimSpace(*patch.Title)
		if item.Title == "" {
			return Item{}, invalid("link title is required")
		}
	}
	if patch.IconURL != nil {
		item.IconURL = *patch.IconURL
	}
	if patch.Description != nil {
		item.Description = *patch.Description
	}
	collectionChanged := patch.Collection != nil && *patch.Collection != item.Collection
	if collectionChanged {
		if _, err := s.collectionByID(ctx, ownerID, *patch.Collection); err != nil {
			return Item{}, err
		}
		item.Collection = *patch.Collection
	}
	if patch.Folder != nil {
		if *patch.Folder == "" {
			item.Folder = ""
		} else {
			f, err := s.folderByID(ctx, ownerID, *patch.Folder)
			if err != nil {
				return Item{}, err
			}
			if f.List != item.Collection {
				return Item{}, invalid("folder must belong to the selected collection")
			}
			item.Folder = *patch.Folder
		}
	} else if collectionChanged {
		item.Folder = ""
	}
	if patch.Position != nil {
		if *patch.Position < 0 {
			return Item{}, invalid("position must be non-negative")
		}
		item.Position = *patch.Position
	}
	if patch.Favorite != nil {
		item.Favorite = *patch.Favorite
	}
	if patch.Tags != nil {
		item.Tags = cleanStrings(*patch.Tags)
		if err := s.validateOwnedTags(ctx, ownerID, item.Tags); err != nil {
			return Item{}, err
		}
	}
	if patch.SecondaryURLs != nil {
		item.SecondaryURLs = normalizeSecondary(*patch.SecondaryURLs)
	}
	item.Updated = time.Now().UTC()
	tags, _ := json.Marshal(item.Tags)
	secondary, _ := json.Marshal(item.SecondaryURLs)
	_, err = s.db.ExecContext(ctx, `UPDATE link_items SET url=?,title=?,icon_url=?,description=?,list_id=?,folder_id=?,position=?,favorite=?,tags_json=?,secondary_urls_json=?,updated_at=? WHERE owner_id=? AND id=?`, item.URL, item.Title, item.IconURL, item.Description, item.Collection, item.Folder, item.Position, boolInt(item.Favorite), string(tags), string(secondary), item.Updated.Format(time.RFC3339Nano), ownerID, id)
	if err != nil {
		return Item{}, err
	}
	return item, nil
}

func (s *Store) DeleteItem(ctx context.Context, ownerID, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM link_items WHERE owner_id=? AND id=?`, ownerID, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) ListTags(ctx context.Context, ownerID string) ([]Tag, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,name,color,created_at,updated_at FROM links_tags WHERE owner_id=? ORDER BY name COLLATE NOCASE`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Tag{}
	for rows.Next() {
		var t Tag
		if err := rows.Scan(&t.ID, &t.Name, &t.Color, &t.Created, &t.Updated); err != nil {
			return nil, err
		}
		items = append(items, t)
	}
	return items, rows.Err()
}

func (s *Store) ListFavorites(ctx context.Context, ownerID string) ([]Item, error) {
	if err := requireOwner(ownerID); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id,url,title,icon_url,description,list_id,folder_id,position,favorite,tags_json,secondary_urls_json,created_at,updated_at FROM link_items WHERE owner_id=? AND favorite=1 ORDER BY title COLLATE NOCASE`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Item{}
	for rows.Next() {
		item, err := scanItem(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) CreateTag(ctx context.Context, ownerID string, input TagInput) (Tag, error) {
	if err := requireOwner(ownerID); err != nil {
		return Tag{}, err
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return Tag{}, invalid("tag name is required")
	}
	id, err := newID()
	if err != nil {
		return Tag{}, err
	}
	now := timestamp()
	_, err = s.db.ExecContext(ctx, `INSERT INTO links_tags(id,owner_id,name,color,created_at,updated_at) VALUES(?,?,?,?,?,?)`, id, ownerID, name, input.Color, now, now)
	if err != nil {
		return Tag{}, fmt.Errorf("create link tag: %w", err)
	}
	return s.tagByID(ctx, ownerID, id)
}

func (s *Store) UpdateTag(ctx context.Context, ownerID, id string, input TagInput, updateName, updateColor bool) (Tag, error) {
	t, err := s.tagByID(ctx, ownerID, id)
	if err != nil {
		return Tag{}, err
	}
	if updateName {
		t.Name = strings.TrimSpace(input.Name)
		if t.Name == "" {
			return Tag{}, invalid("tag name is required")
		}
	}
	if updateColor {
		t.Color = input.Color
	}
	t.Updated = time.Now().UTC()
	_, err = s.db.ExecContext(ctx, `UPDATE links_tags SET name=?,color=?,updated_at=? WHERE owner_id=? AND id=?`, t.Name, t.Color, t.Updated.Format(time.RFC3339Nano), ownerID, id)
	if err != nil {
		return Tag{}, err
	}
	return t, nil
}

func (s *Store) Reorder(ctx context.Context, ownerID string, items []ReorderInput) error {
	if err := requireOwner(ownerID); err != nil {
		return err
	}
	if len(items) > 1000 {
		return invalid("too many links to reorder")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	now := timestamp()
	for _, entry := range items {
		if entry.Position < 0 {
			return invalid("position must be non-negative")
		}
		var result sql.Result
		switch entry.Type {
		case "link":
			result, err = tx.ExecContext(ctx, `UPDATE link_items SET position=?,updated_at=? WHERE owner_id=? AND id=?`, entry.Position, now, ownerID, entry.ID)
		case "folder":
			result, err = tx.ExecContext(ctx, `UPDATE links_folders SET position=?,updated_at=? WHERE owner_id=? AND id=?`, entry.Position, now, ownerID, entry.ID)
		default:
			return invalid("reorder item type must be link or folder")
		}
		if err != nil {
			return err
		}
		n, _ := result.RowsAffected()
		if n == 0 {
			return ErrNotFound
		}
	}
	return tx.Commit()
}

func (s *Store) HomeLinks(ctx context.Context, ownerID string) ([]HomeLink, error) {
	c, err := s.HomeCollection(ctx, ownerID)
	if err != nil {
		return nil, err
	}
	folders, err := s.ListFolders(ctx, ownerID, c.ID)
	if err != nil {
		return nil, err
	}
	items, err := s.ListItems(ctx, ownerID, c.ID, nil)
	if err != nil {
		return nil, err
	}
	byID := map[string]Folder{}
	for _, f := range folders {
		byID[f.ID] = f
	}
	out := make([]HomeLink, 0, len(items))
	for _, i := range items {
		path := []Folder{}
		id := i.Folder
		seen := map[string]bool{}
		for id != "" && !seen[id] {
			seen[id] = true
			f, ok := byID[id]
			if !ok {
				break
			}
			path = append([]Folder{f}, path...)
			id = f.ParentFolder
		}
		entry := HomeLink{ID: i.ID, URL: i.URL, SecondaryURLs: i.SecondaryURLs, Title: i.Title, IconURL: i.IconURL, Description: i.Description, Position: i.Position, Favorite: i.Favorite, StatusCheckEndpoint: i.URL, StatusCheckMethod: "GET", Tags: i.Tags, Updated: i.Updated}
		if len(path) > 0 {
			entry.Collection = path[0].Name
			entry.CollectionID = path[0].ID
		}
		if len(path) > 1 {
			entry.Folder = path[1].Name
			entry.FolderID = path[1].ID
			entry.FolderIcon = path[1].Icon
		}
		out = append(out, entry)
	}
	return out, nil
}

func (s *Store) HomeGroups(ctx context.Context, ownerID string) ([]string, error) {
	c, err := s.HomeCollection(ctx, ownerID)
	if err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT name FROM links_folders WHERE owner_id=? AND list_id=? AND parent_folder_id='' ORDER BY position,name COLLATE NOCASE`, ownerID, c.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	groups := []string{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		groups = append(groups, name)
	}
	return groups, rows.Err()
}

func (s *Store) DeleteHomeGroup(ctx context.Context, ownerID, name string) error {
	c, err := s.HomeCollection(ctx, ownerID)
	if err != nil {
		return err
	}
	folders, err := s.ListFolders(ctx, ownerID, c.ID)
	if err != nil {
		return err
	}
	for _, folder := range folders {
		if folder.ParentFolder == "" && strings.EqualFold(folder.Name, strings.TrimSpace(name)) {
			return s.DeleteFolder(ctx, ownerID, folder.ID)
		}
	}
	return ErrNotFound
}

func (s *Store) SetFavorite(ctx context.Context, ownerID, itemID string, favorite bool) (Item, error) {
	return s.UpdateItem(ctx, ownerID, itemID, ItemPatch{Favorite: &favorite})
}

func (s *Store) CreateHomeGroup(ctx context.Context, ownerID, name string) (Folder, error) {
	c, err := s.HomeCollection(ctx, ownerID)
	if err != nil {
		return Folder{}, err
	}
	return s.CreateFolder(ctx, ownerID, FolderInput{List: c.ID, Name: name})
}

func (s *Store) RenameHomeGroup(ctx context.Context, ownerID, current, name string) (Folder, error) {
	c, err := s.HomeCollection(ctx, ownerID)
	if err != nil {
		return Folder{}, err
	}
	folders, err := s.ListFolders(ctx, ownerID, c.ID)
	if err != nil {
		return Folder{}, err
	}
	for _, f := range folders {
		if f.ParentFolder == "" && strings.EqualFold(f.Name, current) {
			return s.UpdateFolder(ctx, ownerID, f.ID, FolderInput{Name: name, Icon: f.Icon, Position: f.Position, Tags: f.Tags})
		}
	}
	return Folder{}, ErrNotFound
}

func (s *Store) collectionByID(ctx context.Context, ownerID, id string) (Collection, error) {
	var c Collection
	err := s.db.QueryRowContext(ctx, `SELECT id,name,description,icon,type,created_at,updated_at FROM links_collections WHERE owner_id=? AND id=?`, ownerID, id).Scan(&c.ID, &c.Name, &c.Description, &c.Icon, &c.Type, &c.Created, &c.Updated)
	if errors.Is(err, sql.ErrNoRows) {
		return Collection{}, ErrNotFound
	}
	return c, err
}
func (s *Store) folderByID(ctx context.Context, ownerID, id string) (Folder, error) {
	var f Folder
	var tags string
	err := s.db.QueryRowContext(ctx, `SELECT id,list_id,name,icon,parent_folder_id,position,tags_json,created_at,updated_at FROM links_folders WHERE owner_id=? AND id=?`, ownerID, id).Scan(&f.ID, &f.List, &f.Name, &f.Icon, &f.ParentFolder, &f.Position, &tags, &f.Created, &f.Updated)
	if errors.Is(err, sql.ErrNoRows) {
		return Folder{}, ErrNotFound
	}
	if err == nil {
		_ = json.Unmarshal([]byte(tags), &f.Tags)
	}
	return f, err
}
func (s *Store) itemByID(ctx context.Context, ownerID, id string) (Item, error) {
	return scanItem(s.db.QueryRowContext(ctx, `SELECT id,url,title,icon_url,description,list_id,folder_id,position,favorite,tags_json,secondary_urls_json,created_at,updated_at FROM link_items WHERE owner_id=? AND id=?`, ownerID, id))
}
func (s *Store) tagByID(ctx context.Context, ownerID, id string) (Tag, error) {
	var t Tag
	err := s.db.QueryRowContext(ctx, `SELECT id,name,color,created_at,updated_at FROM links_tags WHERE owner_id=? AND id=?`, ownerID, id).Scan(&t.ID, &t.Name, &t.Color, &t.Created, &t.Updated)
	if errors.Is(err, sql.ErrNoRows) {
		return Tag{}, ErrNotFound
	}
	return t, err
}
func (s *Store) findFolderByName(ctx context.Context, ownerID, list, parent, name string) (Folder, error) {
	var id string
	err := s.db.QueryRowContext(ctx, `SELECT id FROM links_folders WHERE owner_id=? AND list_id=? AND parent_folder_id=? AND name=? COLLATE NOCASE`, ownerID, list, parent, name).Scan(&id)
	if err != nil {
		return Folder{}, err
	}
	return s.folderByID(ctx, ownerID, id)
}

type scanner interface{ Scan(...any) error }

func scanFolder(row scanner) (Folder, error) {
	var f Folder
	var tags string
	err := row.Scan(&f.ID, &f.List, &f.Name, &f.Icon, &f.ParentFolder, &f.Position, &tags, &f.Created, &f.Updated)
	if err == nil {
		_ = json.Unmarshal([]byte(tags), &f.Tags)
	}
	return f, err
}
func scanItem(row scanner) (Item, error) {
	var i Item
	var tags, secondary string
	err := row.Scan(&i.ID, &i.URL, &i.Title, &i.IconURL, &i.Description, &i.Collection, &i.Folder, &i.Position, &i.Favorite, &tags, &secondary, &i.Created, &i.Updated)
	if err != nil {
		return Item{}, err
	}
	if err := json.Unmarshal([]byte(tags), &i.Tags); err != nil {
		return Item{}, err
	}
	if err := json.Unmarshal([]byte(secondary), &i.SecondaryURLs); err != nil {
		return Item{}, err
	}
	return i, nil
}

func requireOwner(id string) error {
	if strings.TrimSpace(id) == "" {
		return invalid("owner is required")
	}
	return nil
}

func (s *Store) validateOwnedTags(ctx context.Context, ownerID string, ids []string) error {
	ids = cleanStrings(ids)
	if len(ids) > 100 {
		return invalid("too many tags")
	}
	for _, id := range ids {
		var exists int
		err := s.db.QueryRowContext(ctx, `SELECT 1 FROM links_tags WHERE owner_id=? AND id=?`, ownerID, id).Scan(&exists)
		if errors.Is(err, sql.ErrNoRows) {
			return invalid("tag does not belong to this user")
		}
		if err != nil {
			return err
		}
	}
	return nil
}
func invalid(message string) error { return fmt.Errorf("%w: %s", ErrInvalid, message) }
func cleanStrings(values []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" && !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	return out
}
func normalizeSecondary(values []SecondaryURL) []SecondaryURL {
	out := []SecondaryURL{}
	for _, v := range values {
		v.Name = strings.TrimSpace(v.Name)
		v.URL = strings.TrimSpace(v.URL)
		v.RoutingRule = strings.TrimSpace(v.RoutingRule)
		if v.URL != "" && v.RoutingRule != "" {
			out = append(out, v)
		}
	}
	return out
}
func validateURL(raw string) error {
	u, err := url.ParseRequestURI(strings.TrimSpace(raw))
	if err != nil || u.Scheme == "" || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return invalid("link URL must be an absolute HTTP or HTTPS URL")
	}
	return nil
}
func timestamp() string { return time.Now().UTC().Format(time.RFC3339Nano) }
func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
func newID() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return hex.EncodeToString(value), nil
}
