package postgresbackend

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// GetCountsPerPriority returns how many waiting jobs have each priority, 0
// counting those without one. As on Redis, pausing does not change them.
func (b *Backend) GetCountsPerPriority(ctx context.Context, priorities []int64) ([]int64, error) {
	var counts []int64
	err := b.run(ctx, "get_counts_per_priority", func(ctx context.Context, sql string) error {
		rows, err := b.pool.Query(ctx, sql, b.name, priorities)
		if err != nil {
			return err
		}
		counts, err = pgx.CollectRows(rows, pgx.RowTo[int64])
		return err
	})
	if err != nil {
		return nil, err
	}
	return counts, nil
}
