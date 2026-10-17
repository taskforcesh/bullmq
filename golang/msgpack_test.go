package bullmq

import (
	"bytes"
	"encoding/json"
	"math"
	"reflect"
	"testing"

	"github.com/vmihailenco/msgpack/v5"
)

// unpackMsgpack decodes a packed payload the way the Lua commands see it:
// every integer is a number, every string is a string. Integers are
// normalized to int64 because the decoder picks a signed or unsigned type
// depending on the width the encoder chose.
func unpackMsgpack(t *testing.T, data []byte) any {
	t.Helper()
	dec := msgpack.NewDecoder(bytes.NewReader(data))
	dec.UseLooseInterfaceDecoding(true)
	var v any
	if err := dec.Decode(&v); err != nil {
		t.Fatalf("decode % x: %v", data, err)
	}
	return normalizeMsgpackInts(v)
}

func normalizeMsgpackInts(v any) any {
	switch t := v.(type) {
	case uint64:
		return int64(t)
	case map[string]any:
		for k, item := range t {
			t[k] = normalizeMsgpackInts(item)
		}
	case []any:
		for i, item := range t {
			t[i] = normalizeMsgpackInts(item)
		}
	}
	return v
}

func unpackMsgpackMap(t *testing.T, data []byte) map[string]any {
	t.Helper()
	m, ok := unpackMsgpack(t, data).(map[string]any)
	if !ok {
		t.Fatalf("expected a map, got % x", data)
	}
	return m
}

func TestPackMsgpackWireFormat(t *testing.T) {
	cases := []struct {
		name  string
		value any
		want  []byte
	}{
		{"nil", nil, []byte{0xc0}},
		{"true", true, []byte{0xc3}},
		{"false", false, []byte{0xc2}},
		{"positive fixint", int64(7), []byte{0x07}},
		{"uint8", int64(200), []byte{0xcc, 0xc8}},
		{"uint16", int64(1000), []byte{0xcd, 0x03, 0xe8}},
		{"uint32", int64(70000), []byte{0xce, 0x00, 0x01, 0x11, 0x70}},
		{"negative fixint", int64(-1), []byte{0xff}},
		{"int8", int64(-100), []byte{0xd0, 0x9c}},
		{"fixstr", "id", []byte{0xa2, 'i', 'd'}},
		{"array", []any{int64(1), nil}, []byte{0x92, 0x01, 0xc0}},
		{"empty map", map[string]any{}, []byte{0x80}},
		{
			"sorted map keys",
			map[string]any{"b": int64(2), "a": int64(1)},
			[]byte{0x82, 0xa1, 'a', 0x01, 0xa1, 'b', 0x02},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := packMsgpack(tc.value)
			if err != nil {
				t.Fatalf("packMsgpack: %v", err)
			}
			if !bytes.Equal(got, tc.want) {
				t.Errorf("got % x, want % x", got, tc.want)
			}
		})
	}
}

func TestPackMsgpackUsesStrFamilyForStrings(t *testing.T) {
	s := string(bytes.Repeat([]byte("a"), 40))
	got, err := packMsgpack(s)
	if err != nil {
		t.Fatalf("packMsgpack: %v", err)
	}
	// str8, not bin8: the Lua commands expect strings.
	if got[0] != 0xd9 || got[1] != 40 {
		t.Fatalf("expected str8 header, got % x", got[:2])
	}
	if string(got[2:]) != s {
		t.Fatal("payload mismatch")
	}
}

func TestPackJobOptionsOnlyIncludesSetFields(t *testing.T) {
	empty, err := packJobOptions(&JobOptions{})
	if err != nil {
		t.Fatalf("packJobOptions: %v", err)
	}
	if !bytes.Equal(empty, []byte{0x80}) {
		t.Fatalf("empty options should encode as an empty map, got % x", empty)
	}

	packed, err := packJobOptions(&JobOptions{Attempts: Int64(3), Delay: Int64(1000), LIFO: Bool(true)})
	if err != nil {
		t.Fatalf("packJobOptions: %v", err)
	}
	want := map[string]any{"attempts": int64(3), "delay": int64(1000), "lifo": true}
	if got := unpackMsgpackMap(t, packed); !reflect.DeepEqual(got, want) {
		t.Fatalf("packed options = %v, want %v", got, want)
	}
}

func TestPackJobOptionsEncodesEveryEffectiveOption(t *testing.T) {
	opts := &JobOptions{
		JobID:                   "custom",
		Timestamp:               1700000000000,
		Delay:                   Int64(0),
		Priority:                Int64(0),
		Attempts:                Int64(0),
		LIFO:                    Bool(false),
		KeepLogs:                Int64(0),
		SizeLimit:               Int64(0),
		FailParentOnFailure:     Bool(false),
		ContinueParentOnFailure: Bool(false),
		Parent:                  &ParentOptions{ID: "p1", Queue: "bull:parents"},
	}
	packed, err := packJobOptions(opts)
	if err != nil {
		t.Fatalf("packJobOptions: %v", err)
	}
	// Options that were set explicitly are encoded even when they hold the
	// zero value.
	want := map[string]any{
		"jobId":     "custom",
		"timestamp": int64(1700000000000),
		"delay":     int64(0),
		"priority":  int64(0),
		"attempts":  int64(0),
		"lifo":      false,
		"kl":        int64(0),
		"sizeLimit": int64(0),
		"fpof":      false,
		"cpof":      false,
		"parent":    map[string]any{"id": "p1", "queue": "bull:parents"},
	}
	if got := unpackMsgpackMap(t, packed); !reflect.DeepEqual(got, want) {
		t.Fatalf("packed options = %v, want %v", got, want)
	}

	// The persisted JSON form must decode back into the same options.
	raw, err := json.Marshal(opts)
	if err != nil {
		t.Fatal(err)
	}
	var back JobOptions
	if err := json.Unmarshal(raw, &back); err != nil {
		t.Fatal(err)
	}
	if back.JobID != "custom" || back.Timestamp != opts.Timestamp ||
		back.Parent == nil || *back.Parent != *opts.Parent {
		t.Fatalf("round trip mismatch: %+v", back)
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
	got, err := packMsgpack(RemoveAll().msgpackValue())
	if err != nil {
		t.Fatalf("packMsgpack: %v", err)
	}
	want := []byte{0x81, 0xa5, 'c', 'o', 'u', 'n', 't', 0x00}
	if !bytes.Equal(got, want) {
		t.Fatalf("got % x, want % x", got, want)
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
