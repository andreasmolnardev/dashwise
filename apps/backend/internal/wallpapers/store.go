// Package wallpapers stores an owner's uploaded screensaver images locally.
package wallpapers

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/andreasmolnardev/dashwise/packages/foundation"
)

var ErrNotFound = errors.New("wallpaper not found")

type Store struct {
	db         *sql.DB
	foundation *foundation.DB
	dir        string
}

type Wallpaper struct {
	OwnerID   string
	FileName  string
	Path      string
	MIMEType  string
	CreatedAt string
}

func New(db *foundation.DB, dir string) (*Store, error) {
	if db == nil || db.SQL() == nil || strings.TrimSpace(dir) == "" {
		return nil, errors.New("wallpaper store requires a database and directory")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	return &Store{db: db.SQL(), foundation: db, dir: dir}, nil
}

func (s *Store) Initialize(ctx context.Context) error {
	return s.foundation.ApplyMigrations(ctx, []foundation.Migration{
		{ID: "0013_wallpapers_domain", Name: "local wallpaper metadata", Up: func(ctx context.Context, tx *sql.Tx) error {
			_, err := tx.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS wallpapers(owner_id TEXT PRIMARY KEY NOT NULL,file_name TEXT NOT NULL,path TEXT NOT NULL UNIQUE,mime_type TEXT NOT NULL,created_at TEXT NOT NULL)`)
			return err
		}},
		{ID: "0014_multiple_wallpapers", Name: "allow multiple wallpapers per owner", Up: func(ctx context.Context, tx *sql.Tx) error {
			if _, err := tx.ExecContext(ctx, `ALTER TABLE wallpapers RENAME TO wallpapers_single`); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `CREATE TABLE wallpapers(owner_id TEXT NOT NULL,file_name TEXT NOT NULL,path TEXT NOT NULL UNIQUE,mime_type TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(owner_id,file_name))`); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO wallpapers(owner_id,file_name,path,mime_type,created_at) SELECT owner_id,file_name,path,mime_type,created_at FROM wallpapers_single`); err != nil {
				return err
			}
			_, err := tx.ExecContext(ctx, `DROP TABLE wallpapers_single`)
			return err
		}},
	})
}

func (s *Store) Save(ctx context.Context, owner, filename, mime string, contents []byte) (Wallpaper, error) {
	if owner == "" || filename == "" || mime == "" || len(contents) == 0 {
		return Wallpaper{}, errors.New("wallpaper owner, filename, mime type, and content are required")
	}
	filename = filepath.Base(strings.ReplaceAll(filename, "\\", "/"))
	filename = strings.TrimSpace(filename)
	if filename == "" || filename == "." || filename == "/" || len(filename) > 240 {
		return Wallpaper{}, errors.New("invalid wallpaper filename")
	}
	var oldPath string
	_ = s.db.QueryRowContext(ctx, `SELECT path FROM wallpapers WHERE owner_id=? AND file_name=?`, owner, filename).Scan(&oldPath)
	file, err := os.CreateTemp(s.dir, "wallpaper-*")
	if err != nil {
		return Wallpaper{}, err
	}
	path := file.Name()
	if _, err := file.Write(contents); err != nil {
		_ = file.Close()
		_ = os.Remove(path)
		return Wallpaper{}, err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		_ = os.Remove(path)
		return Wallpaper{}, err
	}
	if err := file.Close(); err != nil {
		_ = os.Remove(path)
		return Wallpaper{}, err
	}
	created := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := s.db.ExecContext(ctx, `INSERT INTO wallpapers(owner_id,file_name,path,mime_type,created_at) VALUES(?,?,?,?,?) ON CONFLICT(owner_id,file_name) DO UPDATE SET path=excluded.path,mime_type=excluded.mime_type,created_at=excluded.created_at`, owner, filename, path, mime, created); err != nil {
		_ = os.Remove(path)
		return Wallpaper{}, fmt.Errorf("save wallpaper metadata: %w", err)
	}
	if oldPath != "" && oldPath != path {
		_ = os.Remove(oldPath)
	}
	return Wallpaper{OwnerID: owner, FileName: filename, Path: path, MIMEType: mime, CreatedAt: created}, nil
}

func (s *Store) Get(ctx context.Context, owner, filename string) (Wallpaper, []byte, error) {
	var item Wallpaper
	if err := s.db.QueryRowContext(ctx, `SELECT owner_id,file_name,path,mime_type,created_at FROM wallpapers WHERE owner_id=? AND file_name=?`, owner, filename).Scan(&item.OwnerID, &item.FileName, &item.Path, &item.MIMEType, &item.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Wallpaper{}, nil, ErrNotFound
		}
		return Wallpaper{}, nil, err
	}
	contents, err := os.ReadFile(item.Path)
	if errors.Is(err, os.ErrNotExist) {
		return Wallpaper{}, nil, ErrNotFound
	}
	return item, contents, err
}
