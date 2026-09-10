package bullmq

import (
	"encoding/hex"
	"testing"
)

func TestKeysUseTheSharedNamingConvention(t *testing.T) {
	k, err := NewKeys("emails", "")
	if err != nil {
		t.Fatalf("NewKeys: %v", err)
	}

	cases := map[string]string{
		"base":        k.Base(),
		"keyPrefix":   k.KeyPrefix(),
		"wait":        k.Wait(),
		"active":      k.Active(),
		"delayed":     k.Delayed(),
		"prioritized": k.Prioritized(),
		"completed":   k.Completed(),
		"failed":      k.Failed(),
		"paused":      k.Paused(),
		"stalled":     k.Stalled(),
		"events":      k.Events(),
		"meta":        k.Meta(),
		"marker":      k.Marker(),
		"pc":          k.PC(),
		"id":          k.ID(),
		"job":         k.Job("42"),
		"jobLock":     k.JobLock("42"),
		"jobLogs":     k.JobLogs("42"),
		"deps":        k.Dependencies("42"),
		"metrics":     k.Metrics("completed"),
	}
	want := map[string]string{
		"base":        "bull:emails",
		"keyPrefix":   "bull:emails:",
		"wait":        "bull:emails:wait",
		"active":      "bull:emails:active",
		"delayed":     "bull:emails:delayed",
		"prioritized": "bull:emails:prioritized",
		"completed":   "bull:emails:completed",
		"failed":      "bull:emails:failed",
		"paused":      "bull:emails:paused",
		"stalled":     "bull:emails:stalled",
		"events":      "bull:emails:events",
		"meta":        "bull:emails:meta",
		"marker":      "bull:emails:marker",
		"pc":          "bull:emails:pc",
		"id":          "bull:emails:id",
		"job":         "bull:emails:42",
		"jobLock":     "bull:emails:42:lock",
		"jobLogs":     "bull:emails:42:logs",
		"deps":        "bull:emails:42:dependencies",
		"metrics":     "bull:emails:metrics:completed",
	}
	for name, got := range cases {
		if got != want[name] {
			t.Errorf("%s = %q, want %q", name, got, want[name])
		}
	}
}

func TestKeysHonourACustomPrefix(t *testing.T) {
	k, err := NewKeys("emails", "{tenant}")
	if err != nil {
		t.Fatalf("NewKeys: %v", err)
	}
	if got, want := k.Wait(), "{tenant}:emails:wait"; got != want {
		t.Errorf("Wait() = %q, want %q", got, want)
	}
}

func TestNewKeysRejectsInvalidNames(t *testing.T) {
	for _, name := range []string{"", "with:colon"} {
		if _, err := NewKeys(name, ""); err == nil {
			t.Errorf("NewKeys(%q) should have failed", name)
		}
	}
}

func TestClientNameMatchesTheNodeFormat(t *testing.T) {
	k, _ := NewKeys("emails", "")
	// base64("emails") == "ZW1haWxz"
	if got, want := k.ClientName(":w:1"), "bull:ZW1haWxz:w:1"; got != want {
		t.Errorf("ClientName() = %q, want %q", got, want)
	}
}

func TestResolveParentQueueKey(t *testing.T) {
	got, err := resolveParentQueueKey("bull", "parents")
	if err != nil || got != "bull:parents" {
		t.Fatalf("resolveParentQueueKey(bare) = %q, %v", got, err)
	}
	got, err = resolveParentQueueKey("bull", "bull:parents")
	if err != nil || got != "bull:parents" {
		t.Fatalf("resolveParentQueueKey(qualified) = %q, %v", got, err)
	}
	if _, err := resolveParentQueueKey("bull", "other:parents"); err == nil {
		t.Fatal("resolveParentQueueKey should reject a foreign prefix")
	}
}

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
