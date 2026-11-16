package weakpass

import "testing"

func TestIsCommon(t *testing.T) {
	for _, pw := range []string{
		"a1a2a3a4a5a6",    // first entry of a block
		"andersonhassko1", // middle of the same block
		"azsxdcfvgbhnjm",  // last entry of the same block
	} {
		if !IsCommon(pw) {
			t.Errorf("IsCommon(%q) = false, want true", pw)
		}
	}
}

func TestIsCommon_BloomFilter6Chars(t *testing.T) {
	// Passwords with common 6-byte chunks at start or end should be caught
	// by the Bloom filter even if they are not in the ≥12-char exact list.
	for _, pw := range []string{
		"qwerty1234567890", // starts with "qwerty"
		"xyzqwerty",        // ends with "qwerty"
		"passwo1234567890", // starts with "passwo" (from "password123")
		"abc123",           // exactly 6 chars, common chunk
	} {
		if !IsCommon(pw) {
			t.Errorf("IsCommon(%q) = false, want true (6-char Bloom filter)", pw)
		}
	}
}

func TestIsCommon_StrongPassword(t *testing.T) {
	// A strong password with uncommon first/last 6 bytes should not be flagged.
	pw := "wede-zxj9k2m4"
	if IsCommon(pw) {
		t.Errorf("IsCommon(%q) = true, want false", pw)
	}
}
