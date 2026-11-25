package bullmq

import (
	"encoding/hex"
	"testing"
)

func TestRandomIDIsUniqueAndHex(t *testing.T) {
	seen := make(map[string]struct{}, 100)
	for range 100 {
		id := randomID()
		if _, err := hex.DecodeString(id); err != nil {
			t.Fatalf("randomID() = %q, not hex: %v", id, err)
		}
		if _, dup := seen[id]; dup {
			t.Fatalf("randomID() produced a duplicate: %q", id)
		}
		seen[id] = struct{}{}
	}
}
