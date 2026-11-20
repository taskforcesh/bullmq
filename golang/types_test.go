package bullmq

import (
	"encoding/json"
	"math"
	"testing"
)

func TestRemoveOnFinishRoundTripsThroughJSON(t *testing.T) {
	cases := []struct {
		raw       string
		wantCount *int64
		wantAge   *int64
	}{
		{`true`, ptr(int64(0)), nil},
		{`false`, nil, nil},
		{`10`, ptr(int64(10)), nil},
		{`{"age":60}`, nil, ptr(int64(60))},
		{`{"count":5,"age":60}`, ptr(int64(5)), ptr(int64(60))},
	}
	for _, tc := range cases {
		var r RemoveOnFinish
		if err := json.Unmarshal([]byte(tc.raw), &r); err != nil {
			t.Fatalf("Unmarshal(%s): %v", tc.raw, err)
		}
		if !eqPtr(r.Count, tc.wantCount) {
			t.Errorf("%s: Count = %v, want %v", tc.raw, deref(r.Count), deref(tc.wantCount))
		}
		if !eqPtr(r.Age, tc.wantAge) {
			t.Errorf("%s: Age = %v, want %v", tc.raw, deref(r.Age), deref(tc.wantAge))
		}
	}
}

func TestProgressEncoding(t *testing.T) {
	p, err := NumberProgress(42)
	if err != nil {
		t.Fatalf("NumberProgress: %v", err)
	}
	if p.Raw() != "42" {
		t.Fatalf("Raw() = %q, want %q", p.Raw(), "42")
	}
	if n, ok := p.Number(); !ok || n != 42 {
		t.Fatalf("Number() = %v, %v", n, ok)
	}

	for _, v := range []float64{math.NaN(), math.Inf(1), math.Inf(-1)} {
		if _, err := NumberProgress(v); err == nil {
			t.Fatalf("NumberProgress(%v) succeeded, want error", v)
		}
	}

	structured, err := JSONProgress(map[string]int{"done": 3})
	if err != nil {
		t.Fatalf("JSONProgress: %v", err)
	}
	var out map[string]int
	if err := structured.Decode(&out); err != nil {
		t.Fatalf("Decode: %v", err)
	}
	if out["done"] != 3 {
		t.Fatalf("Decode() = %v", out)
	}
}

func TestProgressNumberOnlyAcceptsJSONNumbers(t *testing.T) {
	numeric := []struct {
		value any
		want  float64
	}{{42, 42}, {0, 0}, {-3, -3}, {12.5, 12.5}}
	for _, tc := range numeric {
		p, err := JSONProgress(tc.value)
		if err != nil {
			t.Fatalf("JSONProgress(%v): %v", tc.value, err)
		}
		if n, ok := p.Number(); !ok || n != tc.want {
			t.Errorf("JSONProgress(%v).Number() = %v, %v; want %v, true", tc.value, n, ok, tc.want)
		}
	}

	nonNumeric := []any{"42", "", "abc", true, nil, []int{1}, map[string]int{"done": 3}}
	for _, v := range nonNumeric {
		p, err := JSONProgress(v)
		if err != nil {
			t.Fatalf("JSONProgress(%v): %v", v, err)
		}
		if n, ok := p.Number(); ok {
			t.Errorf("JSONProgress(%#v).Number() = %v, true; want false", v, n)
		}
	}

	var unset Progress
	if n, ok := unset.Number(); !ok || n != 0 {
		t.Errorf("zero Progress.Number() = %v, %v; want 0, true", n, ok)
	}
}

func TestMergeJobOptions(t *testing.T) {
	defaults := &JobOptions{Attempts: Int64(5), RemoveOnComplete: RemoveAll(), JobID: "ignored"}
	merged := mergeJobOptions(&JobOptions{Attempts: Int64(2), JobID: "custom"}, defaults)

	if merged.attemptsVal() != 2 {
		t.Errorf("Attempts = %d, want 2", merged.attemptsVal())
	}
	if merged.RemoveOnComplete == nil {
		t.Error("RemoveOnComplete should be inherited from the defaults")
	}
	if merged.JobID != "custom" {
		t.Errorf("JobID = %q, want %q", merged.JobID, "custom")
	}

	inherited := mergeJobOptions(nil, defaults)
	if inherited.attemptsVal() != 5 {
		t.Errorf("Attempts = %d, want 5", inherited.attemptsVal())
	}
	if inherited.JobID != "" {
		t.Errorf("JobID = %q, the job id must never be inherited", inherited.JobID)
	}
}

func TestMergeJobOptionsInheritsDefaultTimestamp(t *testing.T) {
	defaults := &JobOptions{Timestamp: 1700000000000}

	if got := mergeJobOptions(nil, defaults).Timestamp; got != 1700000000000 {
		t.Errorf("inherited Timestamp = %d, want the default", got)
	}
	if got := mergeJobOptions(&JobOptions{}, defaults).Timestamp; got != 1700000000000 {
		t.Errorf("Timestamp with unset per-job value = %d, want the default", got)
	}
	if got := mergeJobOptions(&JobOptions{Timestamp: 42}, defaults).Timestamp; got != 42 {
		t.Errorf("per-job Timestamp = %d, want 42", got)
	}
}

func TestMergeJobOptionsOverridesDefaultsBackToZero(t *testing.T) {
	defaults := &JobOptions{Delay: Int64(1000), LIFO: Bool(true), Priority: Int64(1), Attempts: Int64(5), KeepLogs: Int64(10), SizeLimit: Int64(2048)}

	merged := mergeJobOptions(&JobOptions{
		Delay: Int64(0), LIFO: Bool(false), Priority: Int64(0), Attempts: Int64(0), KeepLogs: Int64(0), SizeLimit: Int64(0),
	}, defaults)
	if merged.delayMs() != 0 {
		t.Errorf("Delay = %d, want 0 (explicit override should win over default)", merged.delayMs())
	}
	if merged.isLIFO() {
		t.Error("LIFO = true, want false (explicit override should win over default)")
	}
	if merged.priorityVal() != 0 {
		t.Errorf("Priority = %d, want 0 (explicit override should win over default)", merged.priorityVal())
	}
	if merged.attemptsVal() != 0 {
		t.Errorf("Attempts = %d, want 0 (explicit override should win over default)", merged.attemptsVal())
	}
	if merged.keepLogsVal() != 0 {
		t.Errorf("KeepLogs = %d, want 0 (explicit override should win over default)", merged.keepLogsVal())
	}
	if merged.sizeLimitVal() != 0 {
		t.Errorf("SizeLimit = %d, want 0 (explicit override should win over default)", merged.sizeLimitVal())
	}

	inherited := mergeJobOptions(&JobOptions{}, defaults)
	if inherited.delayMs() != 1000 {
		t.Errorf("Delay = %d, want 1000 (omitted option should inherit default)", inherited.delayMs())
	}
	if !inherited.isLIFO() {
		t.Error("LIFO = false, want true (omitted option should inherit default)")
	}
	if inherited.priorityVal() != 1 {
		t.Errorf("Priority = %d, want 1 (omitted option should inherit default)", inherited.priorityVal())
	}
	if inherited.attemptsVal() != 5 {
		t.Errorf("Attempts = %d, want 5 (omitted option should inherit default)", inherited.attemptsVal())
	}
	if inherited.keepLogsVal() != 10 {
		t.Errorf("KeepLogs = %d, want 10 (omitted option should inherit default)", inherited.keepLogsVal())
	}
	if inherited.sizeLimitVal() != 2048 {
		t.Errorf("SizeLimit = %d, want 2048 (omitted option should inherit default)", inherited.sizeLimitVal())
	}
}

func TestMergeJobOptionsOverridesDependencyFlagsBackToFalse(t *testing.T) {
	defaults := &JobOptions{
		FailParentOnFailure:       Bool(true),
		ContinueParentOnFailure:   Bool(true),
		IgnoreDependencyOnFailure: Bool(true),
		RemoveDependencyOnFailure: Bool(true),
	}

	merged := mergeJobOptions(&JobOptions{
		FailParentOnFailure:       Bool(false),
		ContinueParentOnFailure:   Bool(false),
		IgnoreDependencyOnFailure: Bool(false),
		RemoveDependencyOnFailure: Bool(false),
	}, defaults)
	if merged.failParentOnFailureVal() {
		t.Error("FailParentOnFailure = true, want false (explicit override should win over default)")
	}
	if merged.continueParentOnFailureVal() {
		t.Error("ContinueParentOnFailure = true, want false (explicit override should win over default)")
	}
	if merged.ignoreDependencyOnFailureVal() {
		t.Error("IgnoreDependencyOnFailure = true, want false (explicit override should win over default)")
	}
	if merged.removeDependencyOnFailureVal() {
		t.Error("RemoveDependencyOnFailure = true, want false (explicit override should win over default)")
	}

	inherited := mergeJobOptions(&JobOptions{}, defaults)
	if !inherited.failParentOnFailureVal() {
		t.Error("FailParentOnFailure = false, want true (omitted option should inherit default)")
	}
	if !inherited.continueParentOnFailureVal() {
		t.Error("ContinueParentOnFailure = false, want true (omitted option should inherit default)")
	}
	if !inherited.ignoreDependencyOnFailureVal() {
		t.Error("IgnoreDependencyOnFailure = false, want true (omitted option should inherit default)")
	}
	if !inherited.removeDependencyOnFailureVal() {
		t.Error("RemoveDependencyOnFailure = false, want true (omitted option should inherit default)")
	}
}

func ptr[T any](v T) *T { return &v }

func eqPtr(a, b *int64) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

func deref(v *int64) any {
	if v == nil {
		return nil
	}
	return *v
}
