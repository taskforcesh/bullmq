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
	return redisAdd{
		scriptName: scriptName,
		keys:       keys,
		argv1:      argv1,
		payload:    string(job.Data),
		opts:       packJobOptions(opts),
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
	w := newMsgpackWriter(160)
	w.ArrayLen(9)
	w.Str(b.keys.KeyPrefix())
	w.Str(opts.JobID)
	w.Str(name)
	w.Int(timestamp)

	if opts.Parent != nil {
		parentQueueKey, err := resolveParentQueueKey(b.keys.Prefix(), opts.Parent.Queue)
		if err != nil {
			return nil, err
		}
		parentKey := parentQueueKey + ":" + opts.Parent.ID
		w.Str(parentKey)
		w.Str(parentKey + ":dependencies")

		flags := map[string]bool{
			"fpof": opts.failParentOnFailureVal(),
			"idof": opts.ignoreDependencyOnFailureVal(),
			"rdof": opts.removeDependencyOnFailureVal(),
			"cpof": opts.continueParentOnFailureVal(),
		}
		n := 2
		for _, v := range flags {
			if v {
				n++
			}
		}
		w.MapLen(n)
		w.Str("id")
		w.Str(opts.Parent.ID)
		w.Str("queueKey")
		w.Str(parentQueueKey)
		// Iterated in a fixed order so the encoding is deterministic.
		for _, k := range []string{"fpof", "idof", "rdof", "cpof"} {
			if flags[k] {
				w.Str(k)
				w.Bool(true)
			}
		}
	} else {
		w.Nil()
		w.Nil()
		w.Nil()
	}

	// repeat job key: job schedulers are not supported by this port yet.
	w.Nil()

	if opts.Deduplication != nil {
		w.Str(b.keys.Base() + ":de:" + opts.Deduplication.ID)
	} else {
		w.Nil()
	}
	return w.Bytes(), nil
}

// packJobOptions builds ARGV[3] of the add* commands.
func packJobOptions(opts *JobOptions) []byte {
	type entry struct {
		key   string
		write func(*msgpackWriter)
	}
	var entries []entry

	// This map is persisted verbatim (as JSON) in the job's "opts" field, so
	// every option that was set is encoded, including explicit zero/false
	// values, under the same keys JobOptions uses for JSON.
	addInt := func(key string, v *int64) {
		if v != nil {
			val := *v
			entries = append(entries, entry{key, func(w *msgpackWriter) { w.Int(val) }})
		}
	}
	addBool := func(key string, v *bool) {
		if v != nil {
			val := *v
			entries = append(entries, entry{key, func(w *msgpackWriter) { w.Bool(val) }})
		}
	}

	if opts.JobID != "" {
		id := opts.JobID
		entries = append(entries, entry{"jobId", func(w *msgpackWriter) { w.Str(id) }})
	}
	if opts.Timestamp != 0 {
		ts := opts.Timestamp
		entries = append(entries, entry{"timestamp", func(w *msgpackWriter) { w.Int(ts) }})
	}
	addInt("delay", opts.Delay)
	addInt("priority", opts.Priority)
	addInt("attempts", opts.Attempts)
	addBool("lifo", opts.LIFO)
	addInt("kl", opts.KeepLogs)
	addInt("sizeLimit", opts.SizeLimit)
	if p := opts.Parent; p != nil {
		entries = append(entries, entry{"parent", func(w *msgpackWriter) {
			w.MapLen(2)
			w.Str("id")
			w.Str(p.ID)
			w.Str("queue")
			w.Str(p.Queue)
		}})
	}
	if opts.RemoveOnComplete != nil {
		roc := opts.RemoveOnComplete
		entries = append(entries, entry{"removeOnComplete", func(w *msgpackWriter) { roc.writeMsgpack(w) }})
	}
	if opts.RemoveOnFail != nil {
		rof := opts.RemoveOnFail
		entries = append(entries, entry{"removeOnFail", func(w *msgpackWriter) { rof.writeMsgpack(w) }})
	}
	if opts.Backoff != nil {
		bo := opts.Backoff
		entries = append(entries, entry{"backoff", func(w *msgpackWriter) { bo.writeMsgpack(w) }})
	}
	addBool("fpof", opts.FailParentOnFailure)
	addBool("cpof", opts.ContinueParentOnFailure)
	addBool("idof", opts.IgnoreDependencyOnFailure)
	addBool("rdof", opts.RemoveDependencyOnFailure)
	if d := opts.Deduplication; d != nil {
		entries = append(entries, entry{"de", func(w *msgpackWriter) {
			n := 1
			if d.TTL > 0 {
				n++
			}
			if d.Extend {
				n++
			}
			if d.Replace {
				n++
			}
			w.MapLen(n)
			w.Str("id")
			w.Str(d.ID)
			if d.TTL > 0 {
				w.Str("ttl")
				w.Uint(uint64(d.TTL))
			}
			if d.Extend {
				w.Str("extend")
				w.Bool(true)
			}
			if d.Replace {
				w.Str("replace")
				w.Bool(true)
			}
		}})
	}

	w := newMsgpackWriter(96)
	w.MapLen(len(entries))
	for _, e := range entries {
		w.Str(e.key)
		e.write(w)
	}
	return w.Bytes()
}
