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

// writeMeta writes the queue metadata of BackendOptions.QueueMeta. It runs
// inside runSQL, once the schema is ready, so it uses the pool directly.
func (b *Backend) writeMeta(ctx context.Context, values map[string]any) error {
	sql, err := command("set_queue_meta")
	if err != nil {
		return err
	}
	fields, vals := metaArgs(values)
	_, err = b.pool.Exec(ctx, sql, b.name, fields, vals)
	return err
}
