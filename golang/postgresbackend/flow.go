package postgresbackend

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	bullmq "github.com/taskforcesh/bullmq-go"
)

// defaultDependencyPageSize is the page size of GetDependencies when a page
// does not set one, as in Node.
const defaultDependencyPageSize = 20

// ForQueue returns a backend for another queue of the same schema that
// shares this backend's query pool, as Node's forQueue does. Closing it only
// closes the LISTEN connections it opened itself; it stops working once this
// backend is closed.
func (b *Backend) ForQueue(name string) (bullmq.Backend, error) {
	queue, err := bareQueueName(name)
	if err != nil {
		return nil, err
	}
	s := &Backend{
		name:             queue,
		schema:           b.schema,
		pool:             b.pool,
		shared:           b.shared,
		migrateKey:       b.migrateKey,
		skipVersionCheck: b.skipVersionCheck,
		skipMigrations:   b.skipMigrations,
		closing:          b.closing,
	}
	s.ready.Store(b.ready.Load())
	connConfig := func() *pgx.ConnConfig { return s.pool.Config().ConnConfig.Copy() }
	s.jobs = newListener(queue, jobsChannel, "listen_jobs", "", connConfig)
	s.events = newListener(queue, eventsChannel, "listen_events", "", connConfig)
	return queueBackend{s}, nil
}

// queueBackend is a backend derived with ForQueue. It shares the pool and
// the lifetime of the backend it was derived from.
type queueBackend struct{ *Backend }

// Close closes the LISTEN connections the backend opened, if any, and leaves
// the shared pool to the backend it was derived from.
func (q queueBackend) Close() error {
	q.jobs.close()
	q.events.close()
	return nil
}

// bareQueueName accepts a bare queue name or a Redis style `{prefix}:{queue}`
// one, as ResolveParent does, and returns the queue name.
func bareQueueName(name string) (string, error) {
	if i := strings.LastIndex(name, ":"); i >= 0 {
		name = name[i+1:]
	}
	if name == "" {
		return "", configError("queue name must be provided")
	}
	return name, nil
}

// AddFlow adds the entries with the shared add_flow command: a single
// statement that inserts the whole tree and releases, at the end, every
// parent left without pending children. It adds the whole tree or, when a
// job cannot be added, none of it (see addFlow).
func (b *Backend) AddFlow(ctx context.Context, entries []bullmq.FlowEntry) ([]string, error) {
	if len(entries) == 0 {
		return nil, nil
	}
	batch := make([]batchEntry, len(entries))
	for i, e := range entries {
		queue, err := bareQueueName(e.QueueName)
		if err != nil {
			return nil, err
		}
		be, err := b.prepareAdd(e.Job)
		if err != nil {
			return nil, err
		}
		be.Queue = queue
		be.ID = e.JobID
		be.AddToWaitingChildren = e.WaitingChildren
		batch[i] = be
	}
	payload, err := json.Marshal(batch)
	if err != nil {
		return nil, err
	}
	ids, failed, err := b.addFlow(ctx, string(payload))
	if failed >= 0 && failed < len(entries) {
		return nil, fmt.Errorf("bullmq: flow job %s of queue %s was not added: %w",
			entries[failed].JobID, entries[failed].QueueName, err)
	}
	if err != nil {
		return nil, err
	}
	if len(ids) != len(entries) {
		return nil, fmt.Errorf("bullmq: add_flow returned %d ids for %d jobs", len(ids), len(entries))
	}
	return ids, nil
}

// dependencyStatuses maps the dep_status values of the shared SQL to the
// groups of bullmq.Dependencies.
const (
	depProcessed = "processed"
	depPending   = "pending"
	depIgnored   = "ignored"
	depFailed    = "failed"
)

// GetDependencies returns the children of a parent job by status, in full
// or a page per requested group. Cursors are offsets.
func (b *Backend) GetDependencies(ctx context.Context, jobID string, opts *bullmq.DependenciesOptions) (*bullmq.Dependencies, error) {
	if opts == nil {
		deps := &bullmq.Dependencies{
			Processed:   map[string]json.RawMessage{},
			Unprocessed: []string{},
			Ignored:     map[string]string{},
			Failed:      []string{},
		}
		err := b.run(ctx, "get_dependencies", func(ctx context.Context, sql string) error {
			rows, err := b.pool.Query(ctx, sql, b.name, jobID)
			if err != nil {
				return err
			}
			var status, key string
			var value []byte
			_, err = pgx.ForEachRow(rows, []any{&status, &key, &value}, func() error {
				addDependency(deps, status, key, value)
				return nil
			})
			return err
		})
		if err != nil {
			return nil, err
		}
		return deps, nil
	}

	deps := &bullmq.Dependencies{}
	for _, group := range []struct {
		status string
		page   *bullmq.DependencyPage
		next   *uint64
	}{
		{depProcessed, opts.Processed, &deps.NextProcessedCursor},
		{depPending, opts.Unprocessed, &deps.NextUnprocessedCursor},
		{depIgnored, opts.Ignored, &deps.NextIgnoredCursor},
		{depFailed, opts.Failed, &deps.NextFailedCursor},
	} {
		if group.page == nil {
			continue
		}
		switch group.status {
		case depProcessed:
			deps.Processed = map[string]json.RawMessage{}
		case depPending:
			deps.Unprocessed = []string{}
		case depIgnored:
			deps.Ignored = map[string]string{}
		case depFailed:
			deps.Failed = []string{}
		}
		size := int64(defaultDependencyPageSize)
		if group.page.Count > 0 {
			size = group.page.Count
		}
		var n int64
		err := b.run(ctx, "get_dependencies_page", func(ctx context.Context, sql string) error {
			rows, err := b.pool.Query(ctx, sql, b.name, jobID, group.status, int64(group.page.Cursor), size)
			if err != nil {
				return err
			}
			var key string
			var value []byte
			_, err = pgx.ForEachRow(rows, []any{&key, &value}, func() error {
				addDependency(deps, group.status, key, value)
				n++
				return nil
			})
			return err
		})
		if err != nil {
			return nil, err
		}
		if n == size {
			*group.next = group.page.Cursor + uint64(size)
		}
	}
	return deps, nil
}

// addDependency adds a child to its group. The stored value is the return
// value of a processed child and the failure reason, a JSON string, of an
// ignored one.
func addDependency(deps *bullmq.Dependencies, status, key string, value []byte) {
	switch status {
	case depProcessed:
		if value == nil {
			value = []byte("null")
		}
		deps.Processed[key] = json.RawMessage(value)
	case depPending:
		deps.Unprocessed = append(deps.Unprocessed, key)
	case depIgnored:
		deps.Ignored[key] = jsonText(value)
	case depFailed:
		deps.Failed = append(deps.Failed, key)
	}
}

// jsonText returns the string a JSON string holds, or the JSON text of any
// other value.
func jsonText(value []byte) string {
	var s string
	if json.Unmarshal(value, &s) == nil {
		return s
	}
	return string(value)
}

// GetDependencyCounts returns how many children of a parent job are in each
// status.
func (b *Backend) GetDependencyCounts(ctx context.Context, jobID string) (bullmq.DependencyCounts, error) {
	var c bullmq.DependencyCounts
	err := b.queryRow(ctx, "get_dependency_counts", []any{b.name, jobID},
		&c.Processed, &c.Unprocessed, &c.Ignored, &c.Failed)
	return c, err
}

// GetProcessedChildrenValues returns the return value of every processed
// child of a parent job.
func (b *Backend) GetProcessedChildrenValues(ctx context.Context, jobID string) (map[string]json.RawMessage, error) {
	out := map[string]json.RawMessage{}
	err := b.run(ctx, "get_processed_children_values", func(ctx context.Context, sql string) error {
		rows, err := b.pool.Query(ctx, sql, b.name, jobID)
		if err != nil {
			return err
		}
		var key string
		var value *string
		_, err = pgx.ForEachRow(rows, []any{&key, &value}, func() error {
			if value == nil {
				out[key] = json.RawMessage("null")
			} else {
				out[key] = json.RawMessage(*value)
			}
			return nil
		})
		return err
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// GetIgnoredChildrenFailures returns the failure reason of every ignored
// child of a parent job.
func (b *Backend) GetIgnoredChildrenFailures(ctx context.Context, jobID string) (map[string]string, error) {
	out := map[string]string{}
	err := b.run(ctx, "get_ignored_children_failures", func(ctx context.Context, sql string) error {
		rows, err := b.pool.Query(ctx, sql, b.name, jobID)
		if err != nil {
			return err
		}
		var key string
		var reason *string
		_, err = pgx.ForEachRow(rows, []any{&key, &reason}, func() error {
			if reason != nil {
				out[key] = *reason
			} else {
				out[key] = ""
			}
			return nil
		})
		return err
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// RemoveChildDependency detaches a pending child from its parent.
func (b *Backend) RemoveChildDependency(ctx context.Context, jobID, parentKey string) (bool, error) {
	var n int64
	if err := b.queryRow(ctx, "remove_child_dependency",
		[]any{b.name, jobID, parentKey, nowMillis()}, &n); err != nil {
		return false, err
	}
	return n == 0, nil
}

// RemoveUnprocessedChildren removes the unprocessed children of a parent
// job, recursively.
func (b *Backend) RemoveUnprocessedChildren(ctx context.Context, jobID string) error {
	return b.exec(ctx, "remove_unprocessed_children", b.name, jobID)
}
