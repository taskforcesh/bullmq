package postgresbackend

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"

	bullmq "github.com/taskforcesh/bullmq-go"
)

// TrimEvents is not supported, as in Node's PostgreSQL backend: there is no
// shared command for it. publish_event trims the events of a queue to its
// opts.maxLenEvents as it adds them.
func (b *Backend) TrimEvents(context.Context, int64) (int64, error) {
	return 0, fmt.Errorf("postgresbackend: TrimEvents: %w", bullmq.ErrNotSupported)
}

// PublishEvent appends an event with the shared publish_event command,
// which trims the events of the queue to its opts.maxLenEvents rather than
// to maxEvents, as in Node's PostgreSQL backend.
func (b *Backend) PublishEvent(ctx context.Context, event string, fields map[string]string, _ int64) (string, error) {
	data, err := json.Marshal(fields)
	if err != nil {
		return "", err
	}
	var id int64
	if err := b.queryRow(ctx, "publish_event", []any{b.name, event, string(data)}, &id); err != nil {
		return "", err
	}
	return strconv.FormatInt(id, 10), nil
}
