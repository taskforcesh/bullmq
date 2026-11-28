package redisbackend

import (
	"context"
	"slices"

	"github.com/redis/go-redis/v9"
)

// TrimEvents trims the event stream with XTRIM MAXLEN ~ maxLength, as
// Node's trimEvents does.
func (b *Backend) TrimEvents(ctx context.Context, maxLength int64) (int64, error) {
	c, err := b.cmd(ctx)
	if err != nil {
		return 0, err
	}
	return c.XTrimMaxLenApprox(ctx, b.keys.Events(), maxLength, 0).Result()
}

// PublishEvent appends an event with XADD MAXLEN ~ maxEvents, as Node's
// publishEvent does: the event field first, then the others by name.
func (b *Backend) PublishEvent(ctx context.Context, event string, fields map[string]string, maxEvents int64) (string, error) {
	values := make([]any, 0, 2+2*len(fields))
	values = append(values, "event", event)
	names := make([]string, 0, len(fields))
	for k := range fields {
		names = append(names, k)
	}
	slices.Sort(names)
	for _, k := range names {
		values = append(values, k, fields[k])
	}
	c, err := b.cmd(ctx)
	if err != nil {
		return "", err
	}
	return c.XAdd(ctx, &redis.XAddArgs{
		Stream: b.keys.Events(),
		MaxLen: maxEvents,
		Approx: true,
		Values: values,
	}).Result()
}
