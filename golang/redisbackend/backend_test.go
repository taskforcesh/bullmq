package redisbackend

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"testing"

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
	}
	for _, tc := range cases {
		if got := isTransientRedisError(tc.err); got != tc.want {
			t.Errorf("%s: got %v, want %v", tc.name, got, tc.want)
		}
	}
}
