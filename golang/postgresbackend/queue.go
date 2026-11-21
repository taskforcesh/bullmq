package postgresbackend

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	bullmq "github.com/taskforcesh/bullmq-go"
)

// stateName maps a JobState to the type names of the shared commands.
func stateName(state bullmq.JobState) string {
	if state == bullmq.StateWaiting {
		return "wait"
	}
	return string(state)
}

// Pause pauses (true) or resumes (false) the queue. Pausing only sets a
// queue flag; waiting jobs stay where they are.
func (b *Backend) Pause(ctx context.Context, paused bool) error {
	return b.exec(ctx, "pause", b.name, paused)
}

// Drain removes the waiting and prioritized jobs, and the delayed ones too
// when delayed is true.
func (b *Backend) Drain(ctx context.Context, delayed bool) error {
	return b.exec(ctx, "drain", b.name, delayed)
}

// Obliterate removes up to count jobs of the queue and returns 1 while more
// remain, 0 once the queue is gone.
func (b *Backend) Obliterate(ctx context.Context, force bool, count int64) (int64, error) {
	b.meta.Stop()
	var cursor int64
	if err := b.queryRow(ctx, "obliterate", []any{b.name, clampInt32(count), force}, &cursor); err != nil {
		return 0, err
	}
	switch {
	case cursor == -1:
		return 0, configError("cannot obliterate a queue that is not paused")
	case cursor == -2:
		return 0, configError("cannot obliterate a queue with active jobs")
	case cursor < 0:
		return 0, nil
	}
	return cursor, nil
}

// CleanJobsByState removes up to limit jobs of state older than timestamp
// and returns their ids. A limit of 0 means no limit.
func (b *Backend) CleanJobsByState(ctx context.Context, state bullmq.JobState, timestamp, limit int64) ([]string, error) {
	return b.queryStrings(ctx, "clean", b.name, stateName(state), timestamp, clampInt32(limit))
}

// RetryFinishedJobs moves up to count completed or failed jobs that finished
// before timestamp back to wait and returns how many moved: 0 once none is
// left.
func (b *Backend) RetryFinishedJobs(ctx context.Context, state bullmq.JobState, count, timestamp int64) (int64, error) {
	var n int64
	err := b.queryRow(ctx, "retry_jobs", []any{b.name, string(state), clampInt32(count), timestamp}, &n)
	return n, err
}

// PromoteJobs moves up to count delayed jobs to wait and returns how many
// moved: 0 once none is left.
func (b *Backend) PromoteJobs(ctx context.Context, count int64) (int64, error) {
	var n int64
	err := b.queryRow(ctx, "promote_jobs", []any{b.name, clampInt32(count)}, &n)
	return n, err
}

// GetCounts returns the number of jobs in each requested state. As on Redis,
// a paused queue keeps counting its jobs as waiting.
func (b *Backend) GetCounts(ctx context.Context, states []bullmq.JobState) ([]int64, error) {
	var row map[string]any
	err := b.run(ctx, "get_counts", func(ctx context.Context, sql string) error {
		rows, err := b.pool.Query(ctx, sql, b.name)
		if err != nil {
			return err
		}
		row, err = pgx.CollectOneRow(rows, pgx.RowToMap)
		return err
	})
	if err != nil {
		return nil, err
	}
	counts := make([]int64, len(states))
	for i, s := range states {
		key := string(s)
		if key == "wait" {
			key = "waiting"
		}
		if n, ok := row[key].(int64); ok && key != "paused" {
			counts[i] = n
		}
	}
	return counts, nil
}

// GetRanges returns the ids of the jobs of each state in turn, those in
// [start, end] of that state, in one round trip.
func (b *Backend) GetRanges(ctx context.Context, states []bullmq.JobState, start, end int64, asc bool) ([]string, error) {
	groups := make([][]string, len(states))
	err := b.run(ctx, "get_range", func(ctx context.Context, sql string) error {
		batch := &pgx.Batch{}
		for i, state := range states {
			name := stateName(state)
			batch.Queue(sql, b.name, name, clampInt32(start), clampInt32(end), asc).Query(func(rows pgx.Rows) error {
				ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
				if err != nil {
					return err
				}
				groups[i] = ids
				return nil
			})
		}
		return b.pool.SendBatch(ctx, batch).Close()
	})
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0)
	seen := make(map[string]bool)
	for _, group := range groups {
		for _, id := range group {
			if !seen[id] {
				seen[id] = true
				ids = append(ids, id)
			}
		}
	}
	return ids, nil
}

// GetJobs returns the jobs of each state in turn, those in [start, end] of
// that state. The jobs are read in one round trip after their ids; a job
// removed after its id was read is skipped.
func (b *Backend) GetJobs(ctx context.Context, states []bullmq.JobState, start, end int64, asc bool) ([]*bullmq.JobRecord, error) {
	ids, err := b.GetRanges(ctx, states, start, end, asc)
	if err != nil || len(ids) == 0 {
		return []*bullmq.JobRecord{}, err
	}
	jobs := make([]*bullmq.JobRecord, 0, len(ids))
	err = b.run(ctx, "get_job_data", func(ctx context.Context, sql string) error {
		batch := &pgx.Batch{}
		for _, id := range ids {
			batch.Queue(sql, b.name, id).Query(func(rows pgx.Rows) error {
				recs, err := scanJobRows(rows)
				jobs = append(jobs, recs...)
				return err
			})
		}
		return b.pool.SendBatch(ctx, batch).Close()
	})
	if err != nil {
		return nil, err
	}
	return jobs, nil
}

// IsMaxed reports whether the queue reached its global concurrency limit.
func (b *Backend) IsMaxed(ctx context.Context) (bool, error) {
	var maxed bool
	err := b.queryRow(ctx, "is_maxed", []any{b.name}, &maxed)
	return maxed, err
}

// GetRateLimitTTL returns the remaining rate limit window in milliseconds.
func (b *Backend) GetRateLimitTTL(ctx context.Context, maxJobs int64) (int64, error) {
	var ttl int64
	err := b.queryRow(ctx, "get_rate_limit_ttl", []any{b.name, clampInt32(maxJobs), nowMillis()}, &ttl)
	return ttl, err
}

// GetMetrics returns the metrics collected for the completed or failed
// state.
func (b *Backend) GetMetrics(ctx context.Context, state bullmq.JobState, start, end int64) (*bullmq.Metrics, error) {
	m := &bullmq.Metrics{}
	err := b.run(ctx, "get_metrics", func(ctx context.Context, sql string) error {
		rows, err := b.pool.Query(ctx, sql, b.name, string(state), clampInt32(start), clampInt32(end))
		if err != nil {
			return err
		}
		defer rows.Close()
		fields := rows.FieldDescriptions()
		dest := make([]any, len(fields))
		for i, f := range fields {
			switch f.Name {
			case "total":
				dest[i] = &m.Count
			case "prev_ts":
				dest[i] = &m.PrevTS
			case "prev_count":
				dest[i] = &m.PrevCount
			case "num_points":
				dest[i] = &m.NumPoints
			case "data":
				dest[i] = &m.Data
			}
		}
		if rows.Next() {
			if err := rows.Scan(dest...); err != nil {
				return err
			}
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	if m.Data == nil {
		m.Data = []int64{}
	}
	return m, nil
}

// GetClientList reports the named sessions of the database as `name=<name>`
// lines, the shape of Redis CLIENT LIST that worker discovery parses. Only
// the dedicated connections of workers and queue events listeners are named.
// The names of this queue's connections are reported as their clients set
// them, with PostgreSQL's escaping of non-ASCII bytes undone.
func (b *Backend) GetClientList(ctx context.Context) ([]string, error) {
	names, err := b.queryStrings(ctx, "get_client_list")
	if err != nil {
		return nil, err
	}
	lines := make([]string, len(names))
	for i, name := range names {
		lines[i] = "name=" + b.clientNameAsSet(name)
	}
	return []string{strings.Join(lines, "\n")}, nil
}

// SetQueueMeta sets queue metadata fields.
func (b *Backend) SetQueueMeta(ctx context.Context, values map[string]any) error {
	if len(values) == 0 {
		return nil
	}
	fields, vals := metaArgs(values)
	return b.exec(ctx, "set_queue_meta", b.name, fields, vals)
}

func metaArgs(values map[string]any) (fields, vals []string) {
	fields = make([]string, 0, len(values))
	vals = make([]string, 0, len(values))
	for f, v := range values {
		fields = append(fields, f)
		vals = append(vals, metaValue(v))
	}
	return fields, vals
}

func metaValue(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case []byte:
		return string(t)
	case bool:
		if t {
			return "1"
		}
		return "0"
	default:
		return fmt.Sprint(v)
	}
}

// GetQueueMetaField reads a queue metadata field.
func (b *Backend) GetQueueMetaField(ctx context.Context, field string) (string, bool, error) {
	var value *string
	err := b.queryRow(ctx, "get_queue_meta_field", []any{b.name, field}, &value)
	if isNoRows(err) || (err == nil && value == nil) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return *value, true, nil
}

// RemoveQueueMetaFields removes queue metadata fields.
func (b *Backend) RemoveQueueMetaFields(ctx context.Context, fields ...string) error {
	if len(fields) == 0 {
		return nil
	}
	return b.exec(ctx, "remove_queue_meta_fields", b.name, fields)
}
