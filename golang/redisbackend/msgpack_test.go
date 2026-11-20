package redisbackend

import (
	"bytes"
	"encoding/json"
	"reflect"
	"testing"

	bullmq "github.com/taskforcesh/bullmq-go"
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
	empty, err := packJobOptions(&bullmq.JobOptions{})
	if err != nil {
		t.Fatalf("packJobOptions: %v", err)
	}
	if !bytes.Equal(empty, []byte{0x80}) {
		t.Fatalf("empty options should encode as an empty map, got % x", empty)
	}

	packed, err := packJobOptions(&bullmq.JobOptions{Attempts: bullmq.Int64(3), Delay: bullmq.Int64(1000), LIFO: bullmq.Bool(true)})
	if err != nil {
		t.Fatalf("packJobOptions: %v", err)
	}
	want := map[string]any{"attempts": int64(3), "delay": int64(1000), "lifo": true}
	if got := unpackMsgpackMap(t, packed); !reflect.DeepEqual(got, want) {
		t.Fatalf("packed options = %v, want %v", got, want)
	}
}

func TestPackJobOptionsEncodesEveryEffectiveOption(t *testing.T) {
	opts := &bullmq.JobOptions{
		JobID:                   "custom",
		Timestamp:               1700000000000,
		Delay:                   bullmq.Int64(0),
		Priority:                bullmq.Int64(0),
		Attempts:                bullmq.Int64(0),
		LIFO:                    bullmq.Bool(false),
		KeepLogs:                bullmq.Int64(0),
		SizeLimit:               bullmq.Int64(0),
		FailParentOnFailure:     bullmq.Bool(false),
		ContinueParentOnFailure: bullmq.Bool(false),
		Parent:                  &bullmq.ParentOptions{ID: "p1", Queue: "bull:parents"},
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
	var back bullmq.JobOptions
	if err := json.Unmarshal(raw, &back); err != nil {
		t.Fatal(err)
	}
	if back.JobID != "custom" || back.Timestamp != opts.Timestamp ||
		back.Parent == nil || *back.Parent != *opts.Parent {
		t.Fatalf("round trip mismatch: %+v", back)
	}
}

func TestRemoveAllEncodesAsCountZero(t *testing.T) {
	got, err := packMsgpack(keepJobsValue(bullmq.RemoveAll()))
	if err != nil {
		t.Fatalf("packMsgpack: %v", err)
	}
	want := []byte{0x81, 0xa5, 'c', 'o', 'u', 'n', 't', 0x00}
	if !bytes.Equal(got, want) {
		t.Fatalf("got % x, want % x", got, want)
	}
}

func TestBackoffValueJitter(t *testing.T) {
	without := backoffValue(&bullmq.Backoff{Type: bullmq.BackoffFixed, Delay: 10})
	want := map[string]any{"type": string(bullmq.BackoffFixed), "delay": int64(10)}
	if !reflect.DeepEqual(without, want) {
		t.Fatalf("without jitter = %v, want %v", without, want)
	}

	with := backoffValue(&bullmq.Backoff{Type: bullmq.BackoffFixed, Delay: 10, Jitter: 0.5})
	want["jitter"] = 0.5
	if !reflect.DeepEqual(with, want) {
		t.Fatalf("with jitter = %v, want %v", with, want)
	}
}
