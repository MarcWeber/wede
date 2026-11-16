package weakpass

import (
	_ "embed"
	"strings"

	"wede/backend/internal/weakpass6"
)

//go:embed most-used-12plus-passwords.txt
var list string

func IsCommon(pw string) bool {
	if pw == "" {
		return false
	}
	// Check the exact-match list of common passwords ≥12 chars.
	pw12 := pw
	if len(pw12) > 12 {
		pw12 = pw12[:12]
	}
	if strings.Contains(list, "\n"+pw12) {
		return true
	}
	// Check the Bloom filter for common 6-byte chunks at the beginning
	// and end of the password.  This catches passwords like
	// "onetwothreefour" where "onetwo" is a common 6-byte chunk.
	if weakpass6.IsWeak(pw) {
		return true
	}
	return false
}
