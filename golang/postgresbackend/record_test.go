package postgresbackend

import (
	"encoding/json"
	"errors"
	"io"
	"reflect"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	bullmq "github.com/taskforcesh/bullmq-go"
)

func TestEncodeOptsStoresTheLongNames(t *testing.T) {
	opts := &bullmq.JobOptions{
		JobID:               "custom",
		Attempts:            bullmq.Int64(3),
		KeepLogs:            bullmq.Int64(10),
		FailParentOnFailure: bullmq.Bool(true),
		Deduplication:       &bullmq.DeduplicationOptions{ID: "d1", TTL: 500, Extend: true},
		RemoveOnComplete:    bullmq.KeepCount(5),
		RemoveOnFail:        bullmq.RemoveAll(),
		StackTraceLimit:     bullmq.Int64(2),
		Backoff:             &bullmq.Backoff{Type: bullmq.BackoffFixed, Delay: 100},
		Timestamp:           1234,
	}
	raw, err := encodeOpts(opts)
	if err != nil {
		t.Fatalf("encodeOpts: %v", err)
	}
	var stored map[string]any
	if err := json.Unmarshal(raw, &stored); err != nil {
		t.Fatalf("stored opts are not JSON: %v", err)
	}
	for _, short := range []string{"kl", "de", "fpof"} {
		if _, ok := stored[short]; ok {
			t.Errorf("stored opts contain the short key %q: %s", short, raw)
		}
	}
	want := map[string]any{
		"jobId":               "custom",
		"attempts":            float64(3),
		"keepLogs":            float64(10),
		"failParentOnFailure": true,
		"deduplication":       map[string]any{"id": "d1", "ttl": float64(500), "extend": true},
		"removeOnComplete":    map[string]any{"count": float64(5)},
		"removeOnFail":        true,
		"stackTraceLimit":     float64(2),
		"backoff":             map[string]any{"type": "fixed", "delay": float64(100)},
		"timestamp":           float64(1234),
	}
	if !reflect.DeepEqual(stored, want) {
		t.Fatalf("stored opts = %s, want %v", raw, want)
	}

	if got := decodeOpts(raw); !reflect.DeepEqual(got, opts) {
		t.Fatalf("decodeOpts(encodeOpts(opts)) = %+v, want %+v", got, opts)
	}
}

func TestDecodeOptsReadsOptionsWrittenByNode(t *testing.T) {
	// The shape the Node.js PostgreSQL backend stores: JobsOptions as is.
	raw := []byte(`{"attempts":2,"keepLogs":4,"deduplication":{"id":"x","ttl":1000},` +
		`"removeOnComplete":true,"removeOnFail":7,"ignoreDependencyOnFailure":true,` +
		`"telemetry":{"metadata":"m"},"backoff":1000}`)
	opts := decodeOpts(raw)
	if opts.Attempts == nil || *opts.Attempts != 2 {
		t.Errorf("Attempts = %v, want 2", opts.Attempts)
	}
	if opts.KeepLogs == nil || *opts.KeepLogs != 4 {
		t.Errorf("KeepLogs = %v, want 4", opts.KeepLogs)
	}
	if opts.Deduplication == nil || opts.Deduplication.ID != "x" || opts.Deduplication.TTL != 1000 {
		t.Errorf("Deduplication = %+v, want id x ttl 1000", opts.Deduplication)
	}
	if opts.RemoveOnComplete == nil || opts.RemoveOnComplete.Count == nil || *opts.RemoveOnComplete.Count != 0 {
		t.Errorf("RemoveOnComplete = %+v, want remove all", opts.RemoveOnComplete)
	}
	if opts.RemoveOnFail == nil || opts.RemoveOnFail.Count == nil || *opts.RemoveOnFail.Count != 7 {
		t.Errorf("RemoveOnFail = %+v, want count 7", opts.RemoveOnFail)
	}
	if opts.IgnoreDependencyOnFailure == nil || !*opts.IgnoreDependencyOnFailure {
		t.Errorf("IgnoreDependencyOnFailure = %v, want true", opts.IgnoreDependencyOnFailure)
	}
}

func TestKeepArgsRemovesOnlyTheJobForRemoveAllAndACountOfZero(t *testing.T) {
	five, age := int64(5), int64(60)
	for _, tc := range []struct {
		name      string
		keep      *bullmq.RemoveOnFinish
		removeAll bool
		keepAge   any
		keepCount any
	}{
		{"nil keeps everything", nil, false, nil, nil},
		{"RemoveAll", bullmq.RemoveAll(), true, nil, nil},
		{"KeepCount(0)", bullmq.KeepCount(0), true, nil, nil},
		{"count", bullmq.KeepCount(5), false, nil, int64(5)},
		{"age", bullmq.KeepAge(60), false, int64(60), nil},
		{"count and age", &bullmq.RemoveOnFinish{Count: &five, Age: &age}, false, int64(60), int64(5)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			removeAll, keepAge, keepCount := keepArgs(tc.keep)
			if removeAll != tc.removeAll || keepAge != tc.keepAge || keepCount != tc.keepCount {
				t.Fatalf("keepArgs = %v, %v, %v; want %v, %v, %v",
					removeAll, keepAge, keepCount, tc.removeAll, tc.keepAge, tc.keepCount)
			}
		})
	}
	// The stored forms the other ports write.
	for raw, want := range map[string][3]any{
		`true`:                 {true, nil, nil},
		`false`:                {false, nil, nil},
		`0`:                    {true, nil, nil},
		`10`:                   {false, nil, int64(10)},
		`{"count":0}`:          {true, nil, nil},
		`{"count":3,"age":60}`: {false, int64(60), int64(3)},
	} {
		var keep bullmq.RemoveOnFinish
		if err := json.Unmarshal([]byte(raw), &keep); err != nil {
			t.Fatalf("decoding %s: %v", raw, err)
		}
		removeAll, keepAge, keepCount := keepArgs(&keep)
		if got := [3]any{removeAll, keepAge, keepCount}; got != want {
			t.Errorf("keepArgs(%s) = %v, want %v", raw, got, want)
		}
	}
}

func TestMapErrorTurnsBM001IntoScriptErrors(t *testing.T) {
	err := mapError("move_to_completed", &pgconn.PgError{Code: "BM001", Detail: "-6", Message: "lock mismatch"})
	if !errors.Is(err, bullmq.ErrJobLockMismatch) {
		t.Fatalf("mapError = %v, want ErrJobLockMismatch", err)
	}
	var se *bullmq.ScriptError
	if !errors.As(err, &se) || se.Code != -6 || se.Script != "move_to_completed" {
		t.Fatalf("mapError = %#v, want a ScriptError with code -6", err)
	}
	other := &pgconn.PgError{Code: "23505"}
	if got := mapError("add_job", other); got != other {
		t.Fatalf("mapError passed %v through as %v", other, got)
	}
}

func TestIsTransientError(t *testing.T) {
	for _, tc := range []struct {
		err  error
		want bool
	}{
		{nil, false},
		{io.ErrUnexpectedEOF, true},
		{&pgconn.PgError{Code: "08006"}, true},
		{&pgconn.PgError{Code: "57P01"}, true},
		{&pgconn.PgError{Code: "40P01"}, true},
		{&pgconn.PgError{Code: "BM001", Detail: "-1"}, false},
		{&pgconn.PgError{Code: "42601"}, false},
		{&bullmq.ScriptError{Code: -1}, false},
		{errClosed, false},
	} {
		if got := isTransientError(tc.err); got != tc.want {
			t.Errorf("isTransientError(%v) = %v, want %v", tc.err, got, tc.want)
		}
	}
}

func TestNegativeCode(t *testing.T) {
	for id, want := range map[string]bool{"-5": true, "-01": false, "5": false, "abc": false, "-": false} {
		if _, got := negativeCode(id); got != want {
			t.Errorf("negativeCode(%q) = %v, want %v", id, got, want)
		}
	}
}

func TestResolveParentStripsARedisPrefix(t *testing.T) {
	b := &Backend{name: "child"}
	for _, queue := range []string{"parents", "bull:parents"} {
		ref, key, err := b.ResolveParent(&bullmq.ParentOptions{ID: "7", Queue: queue})
		if err != nil {
			t.Fatalf("ResolveParent(%q): %v", queue, err)
		}
		if ref.QueueKey != "parents" || ref.ID != "7" || key != "parents:7" {
			t.Fatalf("ResolveParent(%q) = %+v, %q; want parents, parents:7", queue, ref, key)
		}
	}
}
