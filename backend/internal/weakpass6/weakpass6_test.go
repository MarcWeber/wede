package weakpass6

import "testing"

func TestIsWeak_First6Chars(t *testing.T) {
	// "passwo" is a common 6-byte chunk in the distilled6 list (from "password123" etc.).
	pw := "passwo1234567890"
	if !IsWeak(pw) {
		t.Errorf("IsWeak(%q) = false, want true (first 6 bytes 'passwo' are common)", pw)
	}
}

func TestIsWeak_Last6Chars(t *testing.T) {
	// A password ending with a common 6-char chunk should be flagged.
	// "qwerty" is a very common 6-char chunk.
	pw := "xyzqwerty"
	if !IsWeak(pw) {
		t.Errorf("IsWeak(%q) = false, want true (last 6 chars 'qwerty' are common)", pw)
	}
}

func TestIsWeak_ShortPassword(t *testing.T) {
	pw := "abc"
	if !IsWeak(pw) {
		t.Errorf("IsWeak(%q) = false, want true (shorter than 6 chars)", pw)
	}
}

func TestIsWeak_Exactly6Chars(t *testing.T) {
	// "qwerty" is a common 6-char chunk.
	pw := "qwerty"
	if !IsWeak(pw) {
		t.Errorf("IsWeak(%q) = false, want true (exact common 6-char chunk)", pw)
	}
}

func TestIsWeak_StrongPassword(t *testing.T) {
	// A password with uncommon first and last 6 bytes should pass.
	// "wede-test-passphrase" ends with "phrase" which is in the list.
	pw := "wede-zxj9k2m4"
	if IsWeak(pw) {
		t.Errorf("IsWeak(%q) = true, want false (uncommon first/last 6 bytes)", pw)
	}
}

func TestIsWeakLower_CaseInsensitive(t *testing.T) {
	// "QWERTY" should be caught when lowercased.
	pw := "XYZQWERTY"
	if !IsWeakLower(pw) {
		t.Errorf("IsWeakLower(%q) = false, want true (lowercased last 6 'qwerty' are common)", pw)
	}
}

func TestBloomFilter_NoFalseNegatives(t *testing.T) {
	// All chunks that were inserted must be found (no false negatives).
	// These are known to be in the distilled6.txt list.
	commonChunks := []string{
		"qwerty", "123456", "abc123",
		"admin1", "monkey", "dragon", "master",
		"passwo", "asswor", "ssword",
	}
	for _, chunk := range commonChunks {
		if !filter.Contains(chunk) {
			t.Errorf("filter.Contains(%q) = false, want true (false negative)", chunk)
		}
	}
}

func TestBloomFilter_FalsePositiveRate(t *testing.T) {
	// With 145k entries and 1% target FP, the Bloom filter will flag ~1% of
	// non-members.  A small sample has high variance, so we use a generous
	// threshold.  The important property is that the rate is well below 50%.
	testChunks := []string{
		"xyzabc", "defghi", "jklmno", "pqrstu", "vwxyza",
		"bcdefg", "hijklm", "nopqrs", "tuvwxy", "zabcde",
		"fg1234", "abcd12", "efgh34", "ijkl56",
		"mnop78", "qrst90", "uvwx12", "yzab34", "cdef56",
		"zxj9k2", "m4p7q1", "r3s8t5", "v2w6x9", "y0a4b7",
	}
	fpCount := 0
	for _, chunk := range testChunks {
		if filter.Contains(chunk) {
			fpCount++
		}
	}
	rate := float64(fpCount) / float64(len(testChunks))
	// At 1% target FP, a small sample of 24 can easily show 5-15% due to
	// variance.  Anything above 50% would indicate a serious problem.
	if rate > 0.50 {
		t.Errorf("false positive rate %.1f%% is too high (%d/%d)", rate*100, fpCount, len(testChunks))
	}
}
