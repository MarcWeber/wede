package weakpass6

import (
	_ "embed"
	"strings"
)

//go:embed bloomdata.bin
var bloomData []byte

var filter *BloomFilter

func init() {
	f, err := Load(bloomData)
	if err != nil {
		panic("weakpass6: " + err.Error())
	}
	filter = f
}

// IsWeak reports whether the password contains a common 6-byte chunk at the
// beginning or end.  It checks the first 6 bytes and the last 6 bytes against
// the Bloom filter.  All operations are on raw bytes (the chunks happen to be
// UTF-8 text, but the filter treats them as opaque byte slices).
//
// Passwords shorter than 6 bytes are always considered weak.
func IsWeak(pw string) bool {
	if len(pw) < 6 {
		return true
	}
	first6 := pw[:6]
	last6 := pw[len(pw)-6:]
	if filter.Contains(first6) || filter.Contains(last6) {
		return true
	}
	return false
}

// Normalize lowercases the password before checking, as most common
// passwords are lowercase.
func IsWeakLower(pw string) bool {
	return IsWeak(strings.ToLower(pw))
}
