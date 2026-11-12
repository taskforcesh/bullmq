package bullmq

import (
	"context"
	"strings"

	"github.com/redis/go-redis/v9"
)

// redisAdd holds everything needed to run an add* command, on a client or on
// a pipeline, and to turn its reply into a job id.
type redisAdd struct {
	scriptName string
	keys       []string
	argv1      []byte
	payload    string
	opts       []byte
}

// prepareAdd computes the script name, keys and packed arguments needed to
// add the job without touching Redis.
func (b *RedisBackend) prepareAdd(job NewJob) (redisAdd, error) {
	k := b.keys
	opts := job.Opts

	var scriptName string
	var keys []string
	switch {
	case opts.delayMs() > 0:
		scriptName = "addDelayedJob"
		keys = []string{
			k.Marker(), k.Meta(), k.ID(),
			k.Delayed(), k.Completed(), k.Events(),
		}
	case opts.priorityVal() > 0:
		scriptName = "addPrioritizedJob"
		keys = []string{
			k.Marker(), k.Meta(), k.ID(),
			k.Prioritized(), k.Delayed(), k.Completed(),
			k.Active(), k.Events(), k.PC(),
		}
	default:
		scriptName = "addStandardJob"
		keys = []string{
			k.Wait(), k.Paused(), k.Meta(), k.ID(),
			k.Completed(), k.Delayed(), k.Active(),
			k.Events(), k.Marker(),
		}
	}

	argv1, err := b.packAddArgs(opts, job.Name, opts.Timestamp)
	if err != nil {
		return redisAdd{}, err
	}
	packedOpts, err := packJobOptions(opts)
	if err != nil {
		return redisAdd{}, err
	}
	return redisAdd{
		scriptName: scriptName,
		keys:       keys,
		argv1:      argv1,
		payload:    string(job.Data),
		opts:       packedOpts,
	}, nil
}

// parseReply validates the reply of the add* command and extracts the job id.
// Only integer replies are status codes; string replies are always job ids,
// even when they look like a negative number (for example a custom id "-01").
func (a redisAdd) parseReply(res any) (string, error) {
	if code, ok := res.(int64); ok && code < 0 {
		return "", scriptError(a.scriptName, code)
	}
	jobID, ok := asString(res)
	if !ok {
		return "", configError("unexpected reply from %s", a.scriptName)
	}
	return jobID, nil
}

// AddJob adds a single job.
func (b *RedisBackend) AddJob(ctx context.Context, job NewJob) (string, error) {
	a, err := b.prepareAdd(job)
	if err != nil {
		return "", err
	}
	res, err := b.runScript(ctx, a.scriptName, a.keys, a.argv1, a.payload, a.opts)
	if err != nil {
		return "", err
	}
	return a.parseReply(res)
}

// AddJobs submits all add* commands through one Redis transaction and returns
// their results in one round trip. Redis does not roll back earlier scripts
// when a later script returns an application-level error, so a failed batch
// may contain jobs that were inserted before the failing command.
func (b *RedisBackend) AddJobs(ctx context.Context, jobs []NewJob) ([]string, error) {
	if len(jobs) == 0 {
		return nil, nil
	}

	prepared := make([]redisAdd, len(jobs))
	for i, job := range jobs {
		a, err := b.prepareAdd(job)
		if err != nil {
			return nil, err
		}
		prepared[i] = a
	}

	cmds, err := b.execAdds(ctx, prepared)
	if err != nil {
		return nil, err
	}

	ids := make([]string, len(prepared))
	for i, a := range prepared {
		res, err := cmds[i].Result()
		if err != nil && err != redis.Nil {
			return nil, err
		}
		id, err := a.parseReply(res)
		if err != nil {
			return nil, err
		}
		ids[i] = id
	}
	return ids, nil
}

// execAdds runs the prepared add* commands in one MULTI/EXEC. Each distinct
// script is loaded once up front so the transaction carries only EVALSHA
// calls instead of repeating the script text for every job.
//
// A NOSCRIPT reply means the server dropped the cache between the load and
// the EXEC (for example a failover); that command never ran, so only those
// commands are resubmitted, with the full script text, in a second
// transaction. Commands that already ran are never replayed.
func (b *RedisBackend) execAdds(ctx context.Context, prepared []redisAdd) ([]*redis.Cmd, error) {
	loaded := make(map[string]*luaScript)
	var loadCmds []*redis.StringCmd
	_, err := b.rdb.Pipelined(ctx, func(pipe redis.Pipeliner) error {
		for _, a := range prepared {
			if _, done := loaded[a.scriptName]; done {
				continue
			}
			s, err := getScript(a.scriptName)
			if err != nil {
				return err
			}
			loaded[a.scriptName] = s
			loadCmds = append(loadCmds, s.script.Load(ctx, pipe))
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	for _, c := range loadCmds {
		if err := c.Err(); err != nil {
			return nil, err
		}
	}

	submit := func(indexes []int, useSHA bool) ([]*redis.Cmd, error) {
		cmds := make([]*redis.Cmd, len(indexes))
		_, execErr := b.rdb.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
			for n, i := range indexes {
				a := prepared[i]
				s := loaded[a.scriptName]
				if useSHA {
					cmds[n] = s.script.EvalSha(ctx, pipe, a.keys, a.argv1, a.payload, a.opts)
				} else {
					cmds[n] = s.script.Eval(ctx, pipe, a.keys, a.argv1, a.payload, a.opts)
				}
			}
			return nil
		})
		// Per-command errors are inspected by the caller; surface the
		// transaction error only when no command carries one.
		for _, c := range cmds {
			if err := c.Err(); err != nil && err != redis.Nil {
				return cmds, nil
			}
		}
		return cmds, execErr
	}

	all := make([]int, len(prepared))
	for i := range all {
		all[i] = i
	}
	cmds, err := submit(all, true)
	if err != nil {
		return nil, err
	}

	results := make([]*redis.Cmd, len(prepared))
	var missing []int
	var hardErr error
	for i, c := range cmds {
		results[i] = c
		switch err := c.Err(); {
		case err == nil || err == redis.Nil:
		case strings.HasPrefix(err.Error(), "NOSCRIPT"):
			missing = append(missing, i)
		case hardErr == nil:
			hardErr = err
		}
	}
	if hardErr != nil {
		return nil, hardErr
	}
	if len(missing) == 0 {
		return results, nil
	}

	retried, err := submit(missing, false)
	if err != nil {
		return nil, err
	}
	for n, i := range missing {
		results[i] = retried[n]
	}
	return results, nil
}

// packAddArgs builds ARGV[1] of the add* commands: a msgpack array of
// [keyPrefix, customId, name, timestamp, parentKey, parentDepsKey, parent,
// repeatJobKey, deduplicationKey].
func (b *RedisBackend) packAddArgs(opts *JobOptions, name string, timestamp int64) ([]byte, error) {
	// Unset entries stay nil: index 7 is the repeat job key, which this port
	// does not support yet.
	args := make([]any, 9)
	args[0] = b.keys.KeyPrefix()
	args[1] = opts.JobID
	args[2] = name
	args[3] = timestamp

	if opts.Parent != nil {
		parentRef, parentKey, err := b.ResolveParent(opts.Parent)
		if err != nil {
			return nil, err
		}

		parent := map[string]any{
			"id":       parentRef.ID,
			"queueKey": parentRef.QueueKey,
		}
		for key, enabled := range map[string]bool{
			"fpof": opts.failParentOnFailureVal(),
			"idof": opts.ignoreDependencyOnFailureVal(),
			"rdof": opts.removeDependencyOnFailureVal(),
			"cpof": opts.continueParentOnFailureVal(),
		} {
			if enabled {
				parent[key] = true
			}
		}

		args[4] = parentKey
		args[5] = parentKey + ":dependencies"
		args[6] = parent
	}

	if opts.Deduplication != nil {
		args[8] = b.keys.Base() + ":de:" + opts.Deduplication.ID
	}
	return packMsgpack(args)
}

// packJobOptions builds ARGV[3] of the add* commands.
func packJobOptions(opts *JobOptions) ([]byte, error) {
	// This map is persisted verbatim (as JSON) in the job's "opts" field, so
	// every option that was set is encoded, including explicit zero/false
	// values, under the same keys JobOptions uses for JSON.
	m := make(map[string]any, 17)
	addInt := func(key string, v *int64) {
		if v != nil {
			m[key] = *v
		}
	}
	addBool := func(key string, v *bool) {
		if v != nil {
			m[key] = *v
		}
	}

	if opts.JobID != "" {
		m["jobId"] = opts.JobID
	}
	if opts.Timestamp != 0 {
		m["timestamp"] = opts.Timestamp
	}
	addInt("delay", opts.Delay)
	addInt("priority", opts.Priority)
	addInt("attempts", opts.Attempts)
	addBool("lifo", opts.LIFO)
	addInt("kl", opts.KeepLogs)
	addInt("sizeLimit", opts.SizeLimit)
	if p := opts.Parent; p != nil {
		m["parent"] = map[string]any{"id": p.ID, "queue": p.Queue}
	}
	if opts.RemoveOnComplete != nil {
		m["removeOnComplete"] = opts.RemoveOnComplete.msgpackValue()
	}
	if opts.RemoveOnFail != nil {
		m["removeOnFail"] = opts.RemoveOnFail.msgpackValue()
	}
	if opts.Backoff != nil {
		m["backoff"] = opts.Backoff.msgpackValue()
	}
	addBool("fpof", opts.FailParentOnFailure)
	addBool("cpof", opts.ContinueParentOnFailure)
	addBool("idof", opts.IgnoreDependencyOnFailure)
	addBool("rdof", opts.RemoveDependencyOnFailure)
	if d := opts.Deduplication; d != nil {
		de := map[string]any{"id": d.ID}
		if d.TTL > 0 {
			de["ttl"] = d.TTL
		}
		if d.Extend {
			de["extend"] = true
		}
		if d.Replace {
			de["replace"] = true
		}
		m["de"] = de
	}

	return packMsgpack(m)
}
