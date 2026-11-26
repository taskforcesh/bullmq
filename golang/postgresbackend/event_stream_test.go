package postgresbackend

import (
	"errors"
	"fmt"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq-go"
)

// As in Node's PostgreSQL backend, TrimEvents is not supported.
func TestTrimEventsIsNotSupported(t *testing.T) {
	url := testURL(t)
	ctx := testCtx(t)
	q, err := bullmq.NewQueue(fmt.Sprintf("trim-%d", time.Now().UnixNano()),
		&bullmq.QueueOptions{Backend: New(Options{ConnString: url, Schema: newSchema(t)})})
	if err != nil {
		t.Fatal(err)
	}
	defer q.Close()
	if _, err := q.TrimEvents(ctx, 10); !errors.Is(err, bullmq.ErrNotSupported) {
		t.Fatalf("TrimEvents = %v, want ErrNotSupported", err)
	}
}
