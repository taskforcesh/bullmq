package postgresbackend

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// GetQueueMeta returns the queue metadata fields. A NULL value reads as "".
func (b *Backend) GetQueueMeta(ctx context.Context) (map[string]string, error) {
	meta := map[string]string{}
	err := b.run(ctx, "get_queue_meta", func(ctx context.Context, sql string) error {
		rows, err := b.pool.Query(ctx, sql, b.name)
		if err != nil {
			return err
		}
		var (
			field string
			value *string
		)
		_, err = pgx.ForEachRow(rows, []any{&field, &value}, func() error {
			meta[field] = ""
			if value != nil {
				meta[field] = *value
			}
			return nil
		})
		return err
	})
	if err != nil {
		return nil, err
	}
	return meta, nil
}
