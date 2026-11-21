package redisbackend

import "context"

// TrimEvents trims the event stream with XTRIM MAXLEN ~ maxLength, as
// Node's trimEvents does.
func (b *Backend) TrimEvents(ctx context.Context, maxLength int64) (int64, error) {
	c, err := b.cmd(ctx)
	if err != nil {
		return 0, err
	}
	return c.XTrimMaxLenApprox(ctx, b.keys.Events(), maxLength, 0).Result()
}
