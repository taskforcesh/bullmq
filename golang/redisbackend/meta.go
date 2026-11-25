package redisbackend

import "context"

// GetQueueMeta returns the queue metadata hash.
func (b *Backend) GetQueueMeta(ctx context.Context) (map[string]string, error) {
	c, err := b.cmd(ctx)
	if err != nil {
		return nil, err
	}
	return c.HGetAll(ctx, b.keys.Meta()).Result()
}
