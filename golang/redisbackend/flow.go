package redisbackend

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/redis/go-redis/v9"
	bullmq "github.com/taskforcesh/bullmq-go"
)

// defaultDependencyPageSize is the page size of GetDependencies when a page
// does not set one, as in Node.
const defaultDependencyPageSize = 20

// ForQueue returns a backend for another queue under the same prefix that
// shares this backend's client, as Node's forQueue does. It owns no
// connection: closing it is a no-op, and it stops working once this
// backend's client is closed. Its blocking reads run on the shared client.
func (b *Backend) ForQueue(name string) (bullmq.Backend, error) {
	return b.forQueue(name)
}

func (b *Backend) forQueue(name string) (*Backend, error) {
	prefix := b.keys.Prefix()
	queue := name
	if i := strings.LastIndex(name, ":"); i >= 0 {
		if name[:i] != prefix {
			return nil, configError("queue %q must use the prefix %q", name, prefix)
		}
		queue = name[i+1:]
	}
	keys, err := NewKeys(queue, prefix)
	if err != nil {
		return nil, err
	}
	return &Backend{rdb: b.rdb, keys: keys, blocking: b.rdb, blockTimeout: b.blockTimeout}, nil
}

// AddFlow adds the entries in one MULTI/EXEC transaction, as Node's addFlow
// does, which also loads the scripts it uses (see execFlow). The commands of
// a transaction run one after the other, so the add commands defer releasing
// a parent whose children all exist already and are completed (ARGV[1] entry
// 10): every parent of the flow is released at the end of the transaction
// instead, if it has no pending child left.
func (b *Backend) AddFlow(ctx context.Context, entries []bullmq.FlowEntry) ([]string, error) {
	if len(entries) == 0 {
		return nil, nil
	}

	type parentRef struct{ key, queueKey, id string }
	var parents []parentRef
	seen := make(map[string]bool)
	prepared := make([]redisAdd, 0, len(entries))
	for _, e := range entries {
		qb, err := b.forQueue(e.QueueName)
		if err != nil {
			return nil, err
		}
		opts := e.Job.Opts
		args, err := qb.addArgs(opts, e.Job.Name, opts.Timestamp)
		if err != nil {
			return nil, err
		}
		args[1] = e.JobID
		args = append(args, 1)
		a, err := qb.newAdd(e.Job, e.WaitingChildren, args)
		if err != nil {
			return nil, err
		}
		prepared = append(prepared, a)

		if opts.Parent != nil {
			ref, key, err := qb.ResolveParent(opts.Parent)
			if err != nil {
				return nil, err
			}
			if !seen[key] {
				seen[key] = true
				parents = append(parents, parentRef{key: key, queueKey: ref.QueueKey, id: ref.ID})
			}
		}
	}
	now := nowMillis()
	for _, p := range parents {
		prepared = append(prepared, redisAdd{
			scriptName: "releaseParentIfNoPendingDependencies",
			keys:       []string{p.key, p.key + ":dependencies"},
			args:       []any{p.queueKey, p.id, now},
		})
	}

	cmds, err := b.execFlow(ctx, prepared)
	if err != nil {
		return nil, err
	}
	ids := make([]string, len(entries))
	for i, e := range entries {
		res, err := cmds[i].Result()
		if err != nil && err != redis.Nil {
			return nil, err
		}
		id, err := prepared[i].parseReply(res)
		if err != nil {
			return nil, fmt.Errorf("bullmq: flow job %s of queue %s was not added: %w", e.JobID, e.QueueName, err)
		}
		ids[i] = id
	}
	return ids, nil
}

// dependencyKeys returns the keys holding a parent job's children: the
// processed hash, the pending (dependencies) set, the ignored (failed) hash
// and the failed (unsuccessful) sorted set.
func (b *Backend) dependencyKeys(jobID string) (processed, pending, ignored, failed string) {
	jobKey := b.keys.Job(jobID)
	return jobKey + ":processed", jobKey + ":dependencies", jobKey + ":failed", jobKey + ":unsuccessful"
}

// GetDependencies returns the children of a parent job by status, in full
// with a pipeline, or a page per requested group with HSCAN, SSCAN and
// ZRANGE, as Node does.
func (b *Backend) GetDependencies(ctx context.Context, jobID string, opts *bullmq.DependenciesOptions) (*bullmq.Dependencies, error) {
	processedKey, pendingKey, ignoredKey, failedKey := b.dependencyKeys(jobID)
	if opts == nil {
		pipe := b.rdb.Pipeline()
		processed := pipe.HGetAll(ctx, processedKey)
		pending := pipe.SMembers(ctx, pendingKey)
		ignored := pipe.HGetAll(ctx, ignoredKey)
		failed := pipe.ZRange(ctx, failedKey, 0, -1)
		if _, err := pipe.Exec(ctx); err != nil {
			return nil, err
		}
		return &bullmq.Dependencies{
			Processed:   rawValues(processed.Val()),
			Unprocessed: nonNil(pending.Val()),
			Ignored:     nonNilMap(ignored.Val()),
			Failed:      nonNil(failed.Val()),
		}, nil
	}

	pipe := b.rdb.Pipeline()
	var processed, ignored, pending *redis.ScanCmd
	var failed *redis.StringSliceCmd
	if p := opts.Processed; p != nil {
		processed = pipe.HScan(ctx, processedKey, p.Cursor, "", pageSize(p))
	}
	if p := opts.Unprocessed; p != nil {
		pending = pipe.SScan(ctx, pendingKey, p.Cursor, "", pageSize(p))
	}
	if p := opts.Ignored; p != nil {
		ignored = pipe.HScan(ctx, ignoredKey, p.Cursor, "", pageSize(p))
	}
	if p := opts.Failed; p != nil {
		start := int64(p.Cursor)
		failed = pipe.ZRange(ctx, failedKey, start, start+pageSize(p)-1)
	}
	if _, err := pipe.Exec(ctx); err != nil {
		return nil, err
	}

	deps := &bullmq.Dependencies{}
	if processed != nil {
		fields, cursor := processed.Val()
		deps.Processed = rawValues(pairs(fields))
		deps.NextProcessedCursor = cursor
	}
	if pending != nil {
		members, cursor := pending.Val()
		deps.Unprocessed = nonNil(members)
		deps.NextUnprocessedCursor = cursor
	}
	if ignored != nil {
		fields, cursor := ignored.Val()
		deps.Ignored = pairs(fields)
		deps.NextIgnoredCursor = cursor
	}
	if failed != nil {
		deps.Failed = nonNil(failed.Val())
		if size := pageSize(opts.Failed); int64(len(deps.Failed)) == size {
			deps.NextFailedCursor = opts.Failed.Cursor + uint64(size)
		}
	}
	return deps, nil
}

func pageSize(p *bullmq.DependencyPage) int64 {
	if p.Count <= 0 {
		return defaultDependencyPageSize
	}
	return p.Count
}

// pairs turns a flat HSCAN reply into a map.
func pairs(fields []string) map[string]string {
	m := make(map[string]string, len(fields)/2)
	for i := 0; i+1 < len(fields); i += 2 {
		m[fields[i]] = fields[i+1]
	}
	return m
}

func rawValues(m map[string]string) map[string]json.RawMessage {
	out := make(map[string]json.RawMessage, len(m))
	for k, v := range m {
		out[k] = json.RawMessage(v)
	}
	return out
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func nonNilMap(m map[string]string) map[string]string {
	if m == nil {
		return map[string]string{}
	}
	return m
}

// GetDependencyCounts returns how many children of a parent job are in each
// status.
func (b *Backend) GetDependencyCounts(ctx context.Context, jobID string) (bullmq.DependencyCounts, error) {
	processedKey, pendingKey, ignoredKey, failedKey := b.dependencyKeys(jobID)
	res, err := b.runScript(ctx, "getDependencyCounts",
		[]string{processedKey, pendingKey, ignoredKey, failedKey},
		"processed", "unprocessed", "ignored", "failed")
	if err != nil {
		return bullmq.DependencyCounts{}, err
	}
	arr, _ := res.([]any)
	count := func(i int) int64 {
		if i >= len(arr) {
			return 0
		}
		n, _ := asInt64(arr[i])
		return n
	}
	return bullmq.DependencyCounts{
		Processed:   count(0),
		Unprocessed: count(1),
		Ignored:     count(2),
		Failed:      count(3),
	}, nil
}

// GetProcessedChildrenValues returns the processed hash of a parent job.
func (b *Backend) GetProcessedChildrenValues(ctx context.Context, jobID string) (map[string]json.RawMessage, error) {
	processedKey, _, _, _ := b.dependencyKeys(jobID)
	values, err := b.rdb.HGetAll(ctx, processedKey).Result()
	if err != nil {
		return nil, err
	}
	return rawValues(values), nil
}

// GetIgnoredChildrenFailures returns the ignored (failed) hash of a parent
// job.
func (b *Backend) GetIgnoredChildrenFailures(ctx context.Context, jobID string) (map[string]string, error) {
	_, _, ignoredKey, _ := b.dependencyKeys(jobID)
	values, err := b.rdb.HGetAll(ctx, ignoredKey).Result()
	if err != nil {
		return nil, err
	}
	return nonNilMap(values), nil
}

// RemoveChildDependency detaches a pending child from its parent.
func (b *Backend) RemoveChildDependency(ctx context.Context, jobID, parentKey string) (bool, error) {
	res, err := b.runScript(ctx, "removeChildDependency",
		[]string{b.keys.KeyPrefix()}, b.keys.Job(jobID), parentKey)
	if err != nil {
		return false, err
	}
	code, _ := asInt64(res)
	if code < 0 {
		return false, scriptError("removeChildDependency", code)
	}
	return code == 0, nil
}

// RemoveUnprocessedChildren removes the unprocessed children of a parent
// job, recursively.
func (b *Backend) RemoveUnprocessedChildren(ctx context.Context, jobID string) error {
	_, err := b.runScript(ctx, "removeUnprocessedChildren",
		[]string{b.keys.Job(jobID), b.keys.Meta()}, b.keys.KeyPrefix(), jobID)
	return err
}
