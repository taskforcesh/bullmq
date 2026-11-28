package postgresbackend

import "context"

// GetDeduplicationJobID returns the id of the job that holds a
// deduplication id, or "" when no job does.
func (b *Backend) GetDeduplicationJobID(ctx context.Context, dedupID string) (string, error) {
	ids, err := b.queryStrings(ctx, "get_deduplication_job_id", b.name, dedupID, nowMillis())
	if err != nil || len(ids) == 0 {
		return "", err
	}
	return ids[0], nil
}

// RemoveDeduplicationKey releases a deduplication id if jobID still holds
// it.
func (b *Backend) RemoveDeduplicationKey(ctx context.Context, dedupID, jobID string) (bool, error) {
	ids, err := b.queryStrings(ctx, "remove_deduplication_key", b.name, dedupID, jobID, nowMillis())
	return len(ids) > 0, err
}

// DeleteDeduplicationKey releases a deduplication id, whichever job holds
// it.
func (b *Backend) DeleteDeduplicationKey(ctx context.Context, dedupID string) (bool, error) {
	ids, err := b.queryStrings(ctx, "delete_deduplication_key", b.name, dedupID)
	return len(ids) > 0, err
}
