package redisbackend

import (
	"context"
)

// GetCountsPerPriority returns how many waiting jobs have each priority:
// the length of the wait list for 0, and the jobs of that priority in the
// prioritized set otherwise.
func (b *Backend) GetCountsPerPriority(ctx context.Context, priorities []int64) ([]int64, error) {
	args := make([]any, len(priorities))
	for i, p := range priorities {
		args[i] = p
	}
	res, err := b.runScript(ctx, "getCountsPerPriority",
		[]string{b.keys.Wait(), b.keys.Prioritized()}, args...)
	if err != nil {
		return nil, err
	}
	arr, _ := res.([]any)
	counts := make([]int64, len(priorities))
	for i := range counts {
		if i < len(arr) {
			counts[i], _ = asInt64(arr[i])
		}
	}
	return counts, nil
}
