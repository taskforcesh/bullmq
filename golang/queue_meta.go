package bullmq

import (
	"context"
	"math"
	"strconv"
	"strings"
	"time"
)

// QueueMeta is the queue's metadata, as Node's Queue.getMeta returns it. A
// numeric field is nil when it is not set.
type QueueMeta struct {
	// Concurrency is the global concurrency limit (SetGlobalConcurrency). A
	// stored 0, which another runtime may write, holds every job.
	Concurrency *int64
	// Max is the number of jobs allowed per Duration by the global rate
	// limit (SetGlobalRateLimit).
	Max *int64
	// Duration is the window of the global rate limit.
	Duration *time.Duration
	// MaxLenEvents is the approximate maximum length of the events stream.
	MaxLenEvents *int64
	// Paused reports whether the queue is paused.
	Paused bool
	// Version is the library that last wrote the queue's metadata, as
	// `bullmq:<version>`, or "" when none did.
	Version string
}

// Meta returns the queue's metadata, as Node's getMeta does.
func (q *Queue) Meta(ctx context.Context) (*QueueMeta, error) {
	fields, err := q.backend.GetQueueMeta(ctx)
	if err != nil {
		return nil, err
	}
	meta := &QueueMeta{
		Concurrency:  metaNumber(fields["concurrency"]),
		Max:          metaNumber(fields["max"]),
		MaxLenEvents: metaNumber(fields["opts.maxLenEvents"]),
		Paused:       fields["paused"] == "1",
		Version:      fields["version"],
	}
	if ms := metaNumber(fields["duration"]); ms != nil {
		d := time.Duration(*ms) * time.Millisecond
		meta.Duration = &d
	}
	return meta, nil
}

// Version returns the library that last wrote the queue's metadata, as
// `bullmq:<version>`, or "" when none did, as Node's getVersion does.
func (q *Queue) Version(ctx context.Context) (string, error) {
	v, _, err := q.backend.GetQueueMetaField(ctx, "version")
	return v, err
}

// metaNumber parses a metadata field as Node's getMeta does with Number(),
// truncated to an integer: nil when it is empty or not a number.
func metaNumber(s string) *int64 {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		f, ferr := strconv.ParseFloat(s, 64)
		if ferr != nil || math.IsNaN(f) || math.IsInf(f, 0) {
			return nil
		}
		n = int64(f)
	}
	return &n
}
