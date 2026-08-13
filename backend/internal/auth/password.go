// Package auth handles password hashing and identity resolution.
package auth

import "golang.org/x/crypto/bcrypt"

// HashPassword returns a bcrypt hash suitable for storage.
// Cost 12 is deliberate: higher than default for offline brute-force
// resistance, while staying fast enough for interactive login.
func HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

// VerifyPassword reports whether password matches hash.
// bcrypt encodes salt and cost in the hash itself.
func VerifyPassword(password, hash string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}
