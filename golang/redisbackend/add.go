package redisbackend

import (
	"context"
	"strings"

	"github.com/redis/go-redis/v9"
	bullmq "github.com/taskforcesh/bullmq-go"
)

// redisAdd holds everything needed to run an add* command (or another
// command of the same transaction), on a client or on a pipeline, and to turn
// its reply into a job id.
type redisAdd struct {
	scriptName string
	keys       []string
	args       []any
}

// addCommand selects the add* command for a job and its keys: addParentJob
// for a flow parent added in waiting-children, otherwise by delay and
// priority.
func (b *Backend) addCommand(opts *bullmq.JobOptions, parent bool) (string, []string) {
	k := b.keys
	switch {
	case parent:
		return "addParentJob", []string{
			k.Meta(), k.ID(), k.Delayed(),
			k.WaitingChildren(), k.Completed(), k.Events(),
		}
	case int64Val(opts.Delay) > 0:
		return "addDelayedJob", []string{
			k.Marker(), k.Meta(), k.ID(),
			k.Delayed(), k.Completed(), k.Events(),
		}
	case int64Val(opts.Priority) > 0:
		return "addPrioritizedJob", []string{
			k.Marker(), k.Meta(), k.ID(),
			k.Prioritized(), k.Delayed(), k.Completed(),
			k.Active(), k.Events(), k.PC(),
		}
	default:
		return "addStandardJob", []string{
			k.Wait(), k.Paused(), k.Meta(), k.ID(),
			k.Completed(), k.Delayed(), k.Active(),
			k.Events(), k.Marker(),
		}
	}
}

// prepareAdd computes the script name, keys and packed arguments needed to
// add the job without touching Redis.
func (b *Backend) prepareAdd(job bullmq.NewJob) (redisAdd, error) {
	args, err := b.addArgs(job.Opts, job.Name, job.Opts.Timestamp)
	if err != nil {
		return redisAdd{}, err
	}
	return b.newAdd(job, false, args)
}

// newAdd builds the add* command of job from the ARGV[1] entries args.
func (b *Backend) newAdd(job bullmq.NewJob, parent bool, args []any) (redisAdd, error) {
	scriptName, keys := b.addCommand(job.Opts, parent)
	argv1, err := packMsgpack(args)
	if err != nil {
		return redisAdd{}, err
	}
	packedOpts, err := packJobOptions(job.Opts)
	if err != nil {
		return redisAdd{}, err
	}
	return redisAdd{
		scriptName: scriptName,
		keys:       keys,
		args:       []any{argv1, string(job.Data), packedOpts},
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
func (b *Backend) AddJob(ctx context.Context, job bullmq.NewJob) (string, error) {
	a, err := b.prepareAdd(job)
	if err != nil {
		return "", err
	}
	res, err := b.runScript(ctx, a.scriptName, a.keys, a.args...)
	if err != nil {
		return "", err
	}
	return a.parseReply(res)
}

// AddJobs submits all add* commands through one Redis transaction and returns
// their results in one round trip. Redis does not roll back earlier scripts
// when a later script returns an application-level error, so a failed batch
// may contain jobs that were inserted before the failing command.
func (b *Backend) AddJobs(ctx context.Context, jobs []bullmq.NewJob) ([]string, error) {
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

// commandScripts returns the scripts used by the prepared commands, by name
// and in order of first use.
func commandScripts(prepared []redisAdd) (map[string]*luaScript, []*luaScript, error) {
	scripts := make(map[string]*luaScript)
	var distinct []*luaScript
	for _, a := range prepared {
		if _, seen := scripts[a.scriptName]; seen {
			continue
		}
		s, err := getScript(a.scriptName)
		if err != nil {
			return nil, nil, err
		}
		scripts[a.scriptName] = s
		distinct = append(distinct, s)
	}
	return scripts, distinct, nil
}

// execAdds runs the prepared add* commands of independent jobs in one
// MULTI/EXEC. The transaction carries only EVALSHA calls instead of repeating
// the script text for every job. Each distinct script is loaded the first
// time this backend needs it, and only then, so a bulk add is a single round
// trip.
//
// A NOSCRIPT reply means the server does not have the script cached (it was
// flushed, or the server failed over since it was loaded); that command never
// ran, so only those commands are resubmitted, with the full script text, in
// a second transaction, which also caches the script again. Commands that
// already ran are never replayed. Resubmitting only some commands changes
// their order, which is harmless for independent jobs but not for a flow: see
// execFlow.
func (b *Backend) execAdds(ctx context.Context, prepared []redisAdd) ([]*redis.Cmd, error) {
	scripts, distinct, err := commandScripts(prepared)
	if err != nil {
		return nil, err
	}
	var toLoad []*luaScript
	for _, s := range distinct {
		if _, loaded := b.loadedScripts.Load(s.name); !loaded {
			toLoad = append(toLoad, s)
		}
	}
	if len(toLoad) > 0 {
		var loadCmds []*redis.StringCmd
		if _, err := b.rdb.Pipelined(ctx, func(pipe redis.Pipeliner) error {
			for _, s := range toLoad {
				loadCmds = append(loadCmds, s.load(ctx, pipe))
			}
			return nil
		}); err != nil {
			return nil, err
		}
		for i, c := range loadCmds {
			if err := c.Err(); err != nil {
				return nil, err
			}
			b.loadedScripts.Store(toLoad[i].name, struct{}{})
		}
	}

	submit := func(indexes []int, useSHA bool) ([]*redis.Cmd, error) {
		cmds := make([]*redis.Cmd, len(indexes))
		_, execErr := b.rdb.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
			for n, i := range indexes {
				a := prepared[i]
				s := scripts[a.scriptName]
				if useSHA {
					cmds[n] = s.script.EvalSha(ctx, pipe, a.keys, a.args...)
				} else {
					cmds[n] = s.script.Eval(ctx, pipe, a.keys, a.args...)
				}
			}
			return nil
		})
		// Per-command errors are inspected by the caller; surface the
		// transaction error only when no command carries one. A nil reply
		// (from a command that returns nothing) is not an error.
		for _, c := range cmds {
			if err := c.Err(); err != nil && err != redis.Nil {
				return cmds, nil
			}
		}
		if execErr == redis.Nil {
			execErr = nil
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

	// The cache was most likely flushed as a whole, so every script must be
	// loaded again; the resubmitted ones are cached by their EVAL.
	b.loadedScripts.Clear()
	retried, err := submit(missing, false)
	if err != nil {
		return nil, err
	}
	for n, i := range missing {
		results[i] = retried[n]
		if retried[n].Err() == nil || retried[n].Err() == redis.Nil {
			b.loadedScripts.Store(prepared[i].scriptName, struct{}{})
		}
	}
	return results, nil
}

// execFlow runs the prepared commands of a flow in one MULTI/EXEC, which
// first loads every script the flow uses (SCRIPT LOAD), so each EVALSHA that
// follows finds its script even if the server's cache was flushed since this
// backend last loaded it. A flow is never split, unlike the independent jobs
// of execAdds: its commands depend on each other (a child needs its parent,
// a parent is released after its children), so resubmitting the commands
// that missed the cache on their own would add a parent after its children
// were rejected, and release it at once.
func (b *Backend) execFlow(ctx context.Context, prepared []redisAdd) ([]*redis.Cmd, error) {
	scripts, distinct, err := commandScripts(prepared)
	if err != nil {
		return nil, err
	}
	loads := make([]*redis.StringCmd, len(distinct))
	cmds := make([]*redis.Cmd, len(prepared))
	_, execErr := b.rdb.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
		for i, s := range distinct {
			loads[i] = s.load(ctx, pipe)
		}
		for i, a := range prepared {
			cmds[i] = scripts[a.scriptName].script.EvalSha(ctx, pipe, a.keys, a.args...)
		}
		return nil
	})
	for _, c := range loads {
		if err := c.Err(); err != nil {
			return nil, err
		}
	}
	for _, c := range cmds {
		if err := c.Err(); err != nil && err != redis.Nil {
			return nil, err
		}
	}
	if execErr != nil && execErr != redis.Nil {
		return nil, execErr
	}
	return cmds, nil
}

// addArgs builds the entries of ARGV[1] of the add* commands, which is
// msgpack encoded: [keyPrefix, customId, name, timestamp, parentKey,
// parentDepsKey, parent, repeatJobKey, deduplicationKey]. Flow inserts add a
// tenth entry (see AddFlow).
func (b *Backend) addArgs(opts *bullmq.JobOptions, name string, timestamp int64) ([]any, error) {
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
			"fpof": boolVal(opts.FailParentOnFailure),
			"idof": boolVal(opts.IgnoreDependencyOnFailure),
			"rdof": boolVal(opts.RemoveDependencyOnFailure),
			"cpof": boolVal(opts.ContinueParentOnFailure),
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
		args[8] = b.keys.Deduplication(opts.Deduplication.ID)
	}
	return args, nil
}

// packJobOptions builds ARGV[3] of the add* commands.
func packJobOptions(opts *bullmq.JobOptions) ([]byte, error) {
	// This map is persisted verbatim (as JSON) in the job's "opts" field, so
	// every option that was set is encoded, including explicit zero/false
	// values, under the same keys JobOptions uses for JSON.
	m := make(map[string]any, 18)
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
	addInt("stackTraceLimit", opts.StackTraceLimit)
	if p := opts.Parent; p != nil {
		m["parent"] = map[string]any{"id": p.ID, "queue": p.Queue}
	}
	for key, policy := range map[string]*bullmq.RemoveOnFinish{
		"removeOnComplete": opts.RemoveOnComplete,
		"removeOnFail":     opts.RemoveOnFail,
	} {
		if policy == nil {
			continue
		}
		v, err := removeOnFinishValue(policy)
		if err != nil {
			return nil, err
		}
		if v != nil {
			m[key] = v
		}
	}
	if opts.Backoff != nil {
		m["backoff"] = backoffValue(opts.Backoff)
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
		if d.Reschedule {
			de["reschedule"] = true
		}
		if d.KeepLastIfActive {
			de["keepLastIfActive"] = true
		}
		m["de"] = de
	}
	if opts.Repeat != nil {
		m["repeat"] = repeatValue(opts.Repeat)
	}
	if opts.PrevMillis != 0 {
		m["prevMillis"] = opts.PrevMillis
	}
	if opts.RepeatJobKey != "" {
		m["repeatJobKey"] = opts.RepeatJobKey
	}

	return packMsgpack(m)
}
