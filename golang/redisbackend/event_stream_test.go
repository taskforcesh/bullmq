package redisbackend

import (
	"errors"
	"testing"

	bullmq "github.com/taskforcesh/bullmq-go"
)

// TrimEvents trims the stream with XTRIM MAXLEN ~, as Node's trimEvents:
// approximately, whole stream nodes at a time.
func TestTrimEvents(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, Options{})
	rb := redisOf(t, q)
	specs := make([]bullmq.JobSpec, 300)
	for i := range specs {
		specs[i] = bullmq.JobSpec{Name: "job"}
	}
	if _, err := q.AddBulk(ctx, specs); err != nil {
		t.Fatalf("AddBulk: %v", err)
	}
	before, err := rb.Client().XLen(ctx, rb.Keys().Events()).Result()
	if err != nil || before < 600 {
		t.Fatalf("XLEN = %d, %v; want an event per add and per waiting job", before, err)
	}
	removed, err := q.TrimEvents(ctx, 10)
	if err != nil {
		t.Fatalf("TrimEvents: %v", err)
	}
	after, err := rb.Client().XLen(ctx, rb.Keys().Events()).Result()
	if err != nil {
		t.Fatal(err)
	}
	if removed <= 0 || after != before-removed || after >= 200 {
		t.Errorf("TrimEvents(10) removed %d of %d events, leaving %d; want about 10 left", removed, before, after)
	}
	var cfgErr *bullmq.ConfigError
	if _, err := q.TrimEvents(ctx, -1); !errors.As(err, &cfgErr) {
		t.Errorf("TrimEvents(-1) = %v, want a ConfigError", err)
	}
}
