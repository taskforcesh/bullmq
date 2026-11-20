package redisbackend

import (
	"context"

	"github.com/redis/go-redis/v9"
)

// GetDeduplicationJobID returns the id of the job that holds a
// deduplication id, or "" when no job does.
func (b *Backend) GetDeduplicationJobID(ctx context.Context, dedupID string) (string, error) {
	id, err := b.rdb.Get(ctx, b.keys.Deduplication(dedupID)).Result()
	if err == redis.Nil {
		return "", nil
	}
	return id, err
}

// RemoveDeduplicationKey releases a deduplication id if jobID still holds
// it.
func (b *Backend) RemoveDeduplicationKey(ctx context.Context, dedupID, jobID string) (bool, error) {
	res, err := b.runScript(ctx, "removeDeduplicationKey", []string{b.keys.Deduplication(dedupID)}, jobID)
	if err != nil {
		return false, err
	}
	n, _ := asInt64(res)
	return n > 0, nil
}

// DeleteDeduplicationKey releases a deduplication id, whichever job holds
// it.
func (b *Backend) DeleteDeduplicationKey(ctx context.Context, dedupID string) (bool, error) {
	n, err := b.rdb.Del(ctx, b.keys.Deduplication(dedupID)).Result()
	return n > 0, err
}
