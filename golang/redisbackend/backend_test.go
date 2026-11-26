package redisbackend

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	bullmq "github.com/taskforcesh/bullmq-go"
)

func TestIsTransientRedisError(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"eof", io.EOF, true},
		{"wrapped eof", fmt.Errorf("x: %w", io.ErrUnexpectedEOF), true},
		{"net op error", &net.OpError{Op: "dial", Err: errors.New("connection refused")}, true},
		{"timeout", context.DeadlineExceeded, true},
		{"redis nil", redis.Nil, false},
		{"script error", scriptError("moveToFinished", bullmq.ErrCodeJobLockNotExist), false},
		{"plain", errors.New("boom"), false},
		{"auto-pipeline permit timeout", redis.ErrAutoPipelineTimeout, true},
		{"auto-pipeline queue full", redis.ErrAutoPipelineQueueFull, true},
	}
	for _, tc := range cases {
		if got := isTransientRedisError(tc.err); got != tc.want {
			t.Errorf("%s: got %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestParseFetchResult(t *testing.T) {
	job := parseFetchResult([]any{[]any{"name", "send", "data", `{"a":1}`}, "7", int64(0), int64(0)})
	if job.Job == nil || job.Job.ID != "7" || job.Job.Name != "send" || string(job.Job.Data) != `{"a":1}` {
		t.Fatalf("job reply = %+v, want job 7", job)
	}

	limited := parseFetchResult([]any{int64(0), int64(0), int64(1500), int64(0)})
	if limited.Job != nil || limited.RateLimitDelay != 1500*time.Millisecond || limited.NextDelayedAt != 0 {
		t.Fatalf("rate-limited reply = %+v, want RateLimitDelay 1.5s", limited)
	}

	delayed := parseFetchResult([]any{int64(0), int64(0), int64(0), int64(1700000000000)})
	if delayed.Job != nil || delayed.RateLimitDelay != 0 || delayed.NextDelayedAt != 1700000000000 {
		t.Fatalf("delayed reply = %+v, want NextDelayedAt", delayed)
	}

	for _, reply := range []any{int64(0), nil, []any{int64(0), int64(0), int64(0), int64(0)}} {
		if r := parseFetchResult(reply); r.Job != nil || r.RateLimitDelay != 0 || r.NextDelayedAt != 0 {
			t.Fatalf("parseFetchResult(%v) = %+v, want an empty result", reply, r)
		}
	}
}

func TestMarkerScoreAcceptsRESP2AndRESP3Replies(t *testing.T) {
	cases := []struct {
		reply any
		want  float64
	}{
		{[]any{"bull:q:marker", "1", "1700000000000.25"}, 1700000000000.25},
		{[]any{"bull:q:marker", "1", float64(1700000000000)}, 1700000000000},
		{[]any{"bull:q:marker", "0", "0"}, 0},
		{[]any{"bull:q:marker"}, 0},
		{nil, 0},
	}
	for _, tc := range cases {
		if got := markerScore(tc.reply); got != tc.want {
			t.Errorf("markerScore(%v) = %v, want %v", tc.reply, got, tc.want)
		}
	}
}
