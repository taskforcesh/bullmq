package bullmq

import (
	"context"
	"time"
)

// CountsPerPriority returns how many waiting jobs have each of priorities,
// as Node's getCountsPerPriority does: 0 counts the waiting jobs without a
// priority. Repeated priorities are counted once, and an empty list
// returns an empty map.
func (q *Queue) CountsPerPriority(ctx context.Context, priorities ...int64) (map[int64]int64, error) {
	unique := make([]int64, 0, len(priorities))
	seen := make(map[int64]bool, len(priorities))
	for _, p := range priorities {
		if !seen[p] {
			seen[p] = true
			unique = append(unique, p)
		}
	}
	counts := make(map[int64]int64, len(unique))
	if len(unique) == 0 {
		return counts, nil
	}
	values, err := q.backend.GetCountsPerPriority(ctx, unique)
	if err != nil {
		return nil, err
	}
	for i, p := range unique {
		if i < len(values) {
			counts[p] = values[i]
		} else {
			counts[p] = 0
		}
	}
	return counts, nil
}

// DelayedCount returns how many delayed jobs are due strictly before
// before, as Node's getDelayedCount(timestamp) does, for example to count
// the overdue ones with time.Now(). The zero time counts every delayed job.
func (q *Queue) DelayedCount(ctx context.Context, before time.Time) (int64, error) {
	if before.IsZero() {
		counts, err := q.backend.GetCounts(ctx, []JobState{StateDelayed})
		if err != nil || len(counts) == 0 {
			return 0, err
		}
		return counts[0], nil
	}
	return q.backend.GetDelayedCount(ctx, before.UnixMilli())
}
