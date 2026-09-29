package bullmq

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestMsgpackScalars(t *testing.T) {
	cases := []struct {
		name  string
		write func(*msgpackWriter)
		want  []byte
	}{
		{"nil", func(w *msgpackWriter) { w.Nil() }, []byte{0xc0}},
		{"true", func(w *msgpackWriter) { w.Bool(true) }, []byte{0xc3}},
		{"false", func(w *msgpackWriter) { w.Bool(false) }, []byte{0xc2}},
		{"positive fixint", func(w *msgpackWriter) { w.Uint(7) }, []byte{0x07}},
		{"uint8", func(w *msgpackWriter) { w.Uint(200) }, []byte{0xcc, 0xc8}},
		{"uint16", func(w *msgpackWriter) { w.Uint(1000) }, []byte{0xcd, 0x03, 0xe8}},
		{"uint32", func(w *msgpackWriter) { w.Uint(70000) }, []byte{0xce, 0x00, 0x01, 0x11, 0x70}},
		{"negative fixint", func(w *msgpackWriter) { w.Int(-1) }, []byte{0xff}},
		{"int8", func(w *msgpackWriter) { w.Int(-100) }, []byte{0xd0, 0x9c}},
		{"fixstr", func(w *msgpackWriter) { w.Str("id") }, []byte{0xa2, 'i', 'd'}},
		{"fixarray", func(w *msgpackWriter) { w.ArrayLen(2) }, []byte{0x92}},
		{"fixmap", func(w *msgpackWriter) { w.MapLen(3) }, []byte{0x83}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := newMsgpackWriter(8)
			tc.write(w)
			if !bytes.Equal(w.Bytes(), tc.want) {
				t.Errorf("got % x, want % x", w.Bytes(), tc.want)
			}
		})
	}
}

func TestMsgpackStr8UsedForLongStrings(t *testing.T) {
	s := string(bytes.Repeat([]byte("a"), 40))
	w := newMsgpackWriter(64)
	w.Str(s)
	got := w.Bytes()
	if got[0] != 0xd9 || got[1] != 40 {
		t.Fatalf("expected str8 header, got % x", got[:2])
	}
	if string(got[2:]) != s {
		t.Fatal("payload mismatch")
	}
}

func TestPackJobOptionsOnlyIncludesSetFields(t *testing.T) {
	empty := packJobOptions(&JobOptions{})
	if !bytes.Equal(empty, []byte{0x80}) {
		t.Fatalf("empty options should encode as an empty map, got % x", empty)
	}

	opts := &JobOptions{Attempts: Int64(3), Delay: Int64(1000), LIFO: Bool(true)}
	packed := packJobOptions(opts)
	if packed[0] != 0x83 {
		t.Fatalf("expected a 3 entry map header, got %#x", packed[0])
	}
}

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

func TestRemoveAllEncodesAsCountZero(t *testing.T) {
	w := newMsgpackWriter(8)
	RemoveAll().writeMsgpack(w)
	want := []byte{0x81, 0xa5, 'c', 'o', 'u', 'n', 't', 0x00}
	if !bytes.Equal(w.Bytes(), want) {
		t.Fatalf("got % x, want % x", w.Bytes(), want)
	}
}

func TestProgressEncoding(t *testing.T) {
	p := NumberProgress(42)
	if p.Raw() != "42" {
		t.Fatalf("Raw() = %q, want %q", p.Raw(), "42")
	}
	if n, ok := p.Number(); !ok || n != 42 {
		t.Fatalf("Number() = %v, %v", n, ok)
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
