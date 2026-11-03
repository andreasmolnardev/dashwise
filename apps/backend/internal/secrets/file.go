// Package secrets provides persisted encryption keys and authenticated
// encryption for sensitive values stored by the embedded application.
package secrets

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
	"io"
	"os"
	"path/filepath"
)

const keySize = 32

type FileProtector struct {
	aead cipher.AEAD
}

// OpenFileProtector loads or creates a 256-bit key with owner-only permissions.
func OpenFileProtector(path string) (*FileProtector, error) {
	if path == "" {
		return nil, errors.New("encryption key path is required")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	key, err := loadOrCreateKey(path)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &FileProtector{aead: aead}, nil
}

func loadOrCreateKey(path string) ([]byte, error) {
	key, err := os.ReadFile(path)
	if err == nil {
		if len(key) != keySize {
			return nil, errors.New("stored encryption key has an invalid size")
		}
		return key, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	key = make([]byte, keySize)
	if _, err := io.ReadFull(rand.Reader, key); err != nil {
		return nil, err
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if errors.Is(err, os.ErrExist) {
		key, err = os.ReadFile(path)
		if err == nil && len(key) != keySize {
			err = errors.New("stored encryption key has an invalid size")
		}
		return key, err
	}
	if err != nil {
		return nil, err
	}
	if _, err = file.Write(key); err != nil {
		_ = file.Close()
		_ = os.Remove(path)
		return nil, err
	}
	if err = file.Sync(); err != nil {
		_ = file.Close()
		_ = os.Remove(path)
		return nil, err
	}
	if err = file.Close(); err != nil {
		_ = os.Remove(path)
		return nil, err
	}
	return key, nil
}

func (p *FileProtector) Protect(plain []byte) ([]byte, error) {
	if p == nil || p.aead == nil {
		return nil, errors.New("secret protector is not initialized")
	}
	nonce := make([]byte, p.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	return p.aead.Seal(nonce, nonce, plain, nil), nil
}

func (p *FileProtector) Reveal(ciphertext []byte) ([]byte, error) {
	if p == nil || p.aead == nil {
		return nil, errors.New("secret protector is not initialized")
	}
	nonceSize := p.aead.NonceSize()
	if len(ciphertext) < nonceSize {
		return nil, errors.New("encrypted secret is malformed")
	}
	nonce, sealed := ciphertext[:nonceSize], ciphertext[nonceSize:]
	return p.aead.Open(nil, nonce, sealed, nil)
}
