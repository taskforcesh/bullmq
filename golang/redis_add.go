package bullmq

import (
	"context"

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
func (a redisAdd) parseReply(res any) (string, error) {
	if code, ok := asInt64(res); ok && code < 0 {
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

	cmds := make([]*redis.Cmd, len(prepared))
	_, err := b.rdb.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
		for i, a := range prepared {
			s, err := getScript(a.scriptName)
			if err != nil {
				return err
			}
			cmds[i] = s.run(ctx, pipe, a.keys, a.argv1, a.payload, a.opts)
		}
		return nil
	})
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
		parentQueueKey, err := resolveParentQueueKey(b.keys.Prefix(), opts.Parent.Queue)
		if err != nil {
			return nil, err
		}
		parentKey := parentQueueKey + ":" + opts.Parent.ID

		parent := map[string]any{
			"id":       opts.Parent.ID,
			"queueKey": parentQueueKey,
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
