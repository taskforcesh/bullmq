package redisbackend

import (
	"context"
	"fmt"
	"strconv"
	"time"

	bullmq "github.com/taskforcesh/bullmq-go"
)

func nowMillis() int64 {
	return time.Now().UnixMilli()
}

// parseInt leniently parses an integer stored as text, accepting floats and
// returning 0 for anything else.
func parseInt(s string) int64 {
	if s == "" {
		return 0
	}
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		f, ferr := strconv.ParseFloat(s, 64)
		if ferr != nil {
			return 0
		}
		return int64(f)
	}
	return n
}

// sleepCtx waits for d, returning false when ctx is cancelled first.
func sleepCtx(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}

func scriptError(script string, code int64) error {
	return &bullmq.ScriptError{Code: code, Script: script}
}

func configError(format string, args ...any) error {
	return &bullmq.ConfigError{Message: fmt.Sprintf(format, args...)}
}

// int64Val dereferences an optional job option, treating unset as 0.
func int64Val(p *int64) int64 {
	if p == nil {
		return 0
	}
	return *p
}

// boolVal dereferences an optional job option, treating unset as false.
func boolVal(p *bool) bool {
	return p != nil && *p
}
