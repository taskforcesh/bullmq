package postgresbackend

import (
	"context"
	"fmt"

	bullmq "github.com/taskforcesh/bullmq-go"
)

// TrimEvents is not supported, as in Node's PostgreSQL backend: there is no
// shared command for it. publish_event trims the events of a queue to its
// opts.maxLenEvents as it adds them.
func (b *Backend) TrimEvents(context.Context, int64) (int64, error) {
	return 0, fmt.Errorf("postgresbackend: TrimEvents: %w", bullmq.ErrNotSupported)
}
