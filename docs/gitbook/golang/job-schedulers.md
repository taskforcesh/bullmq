---
description: Repeating jobs on a cron pattern or at a fixed interval with BullMQ for Go.
---

# Job Schedulers

A job scheduler produces jobs on a cron pattern or at a fixed interval, as
Node's `upsertJobScheduler` does. The concepts are described in the
[Job Schedulers guide](../guide/job-schedulers/).

```go
// Every day at 09:00, Madrid time.
first, err := queue.UpsertJobScheduler(ctx, "daily-report",
	bullmq.RepeatOptions{Pattern: "0 9 * * *", Tz: "Europe/Madrid"},
	&bullmq.JobTemplate{Name: "report", Data: map[string]string{"kind": "daily"}})
if err != nil {
	log.Fatal(err)
}
if first != nil { // nil when the schedule produces no more jobs
	log.Printf("first report: job %s", first.ID)
}

// Every 10 seconds, 100 times at most.
if _, err := queue.UpsertJobScheduler(ctx, "poll",
	bullmq.RepeatOptions{Every: 10_000, Limit: 100}, nil); err != nil {
	log.Fatal(err)
}
```

`UpsertJobScheduler` creates the scheduler, or replaces the schedule and
template of an existing one, and returns the job of its next iteration.

## How it works

Only the job of the next iteration is stored, with the id
`repeat:<scheduler id>:<due time in Unix ms>`. The worker that fetches it adds
the following iteration's job before processing it, as in Node.js, so Go and
the other SDKs advance each other's schedulers. While no worker is running, a
scheduler doesn't pile up jobs.

## Repeat options

| Option        | Meaning                                                                                                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Pattern`     | A cron expression: 5 fields, or 6 with leading seconds                                                                                                |
| `Every`       | An interval in milliseconds, instead of `Pattern`                                                                                                     |
| `Tz`          | Time zone of `Pattern`: IANA names (any case), ICU ids like `PST`, or offsets like `+03:00`. Defaults to the process's local time zone, as in Node.js |
| `Offset`      | Shifts the runs of an `Every` scheduler, in milliseconds                                                                                              |
| `Limit`       | Maximum number of jobs to produce                                                                                                                     |
| `StartDate`   | When the schedule starts, in Unix milliseconds                                                                                                        |
| `EndDate`     | When the schedule ends, in Unix milliseconds                                                                                                          |
| `Immediately` | Produce the first job of a `Pattern` scheduler right away (`Every` schedulers always do)                                                              |

Patterns are evaluated exactly as cron-parser evaluates them in Node.js, with
names, ranges, steps, `L`, `#` and Sunday as 0 or 7, including across DST
changes, so every SDK computes the same due times. `W` and `H` expressions
are rejected. See [Repeat strategies](../guide/job-schedulers/repeat-strategies.md)
and [Repeat options](../guide/job-schedulers/repeat-options.md).

{% hint style="warning" %}
Time zones are resolved as Node.js resolves them: IANA names in any case, ICU's
legacy ids such as `PST`, and fixed offsets (`+03:00`, `UTC+3`). Zones are read
from the system's time zone database. Programs that run where there is none,
such as `scratch` or distroless containers, must embed it with
`import _ "time/tzdata"`; otherwise `UpsertJobScheduler` rejects patterns with
a `Tz`, and a worker that fetches an iteration of a scheduler whose time zone it
can't resolve fails that iteration with the reason and an `EventError`, so the
schedule stops visibly instead of stalling.
{% endhint %}

## Custom repeat strategy

`QueueOptions.RepeatStrategy` and `WorkerOptions.RepeatStrategy` replace cron
for `Pattern` schedulers, as Node's `settings.repeatStrategy` does. The
strategy returns when the next job is due (Unix milliseconds) after `millis`,
or 0 when there is no next run; `Pattern` can then hold any rule it
understands, such as an RRULE. `opts.Count` is the number of jobs produced so
far.

```go
// The next run after millis, or 0 for none; Pattern holds the rule, parsed
// here with github.com/teambition/rrule-go.
strategy := func(millis int64, opts bullmq.RepeatOptions, jobName string) (int64, error) {
	rule, err := rrule.StrToRRule(strings.TrimPrefix(opts.Pattern, "RRULE:"))
	if err != nil {
		return 0, err
	}
	next := rule.After(time.UnixMilli(millis), false)
	if next.IsZero() {
		return 0, nil
	}
	return next.UnixMilli(), nil
}

queue, err := bullmq.NewQueue("reports", &bullmq.QueueOptions{Backend: backend, RepeatStrategy: strategy})
if err != nil {
	log.Fatal(err)
}
worker, err := bullmq.NewWorker("reports", render, &bullmq.WorkerOptions{Backend: backend, RepeatStrategy: strategy})
if err != nil {
	log.Fatal(err)
}
_, err = queue.UpsertJobScheduler(ctx, "weekly",
	bullmq.RepeatOptions{Pattern: "RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=9"}, nil)
```

The queue that upserts a scheduler and every worker that advances it, in any
language, need the same strategy: a worker without it can't compute the next
run, and fails the iteration it fetched.

## Job template

`bullmq.JobTemplate` sets the name (the scheduler id by default), the data
and the options of the jobs a scheduler produces:

```go
_, err := queue.UpsertJobScheduler(ctx, "cleanup",
	bullmq.RepeatOptions{Pattern: "0 */6 * * *"},
	&bullmq.JobTemplate{
		Name: "cleanup",
		Data: map[string]int{"olderThanDays": 30},
		Opts: &bullmq.JobOptions{
			Attempts:         bullmq.Int64(3),
			Backoff:          &bullmq.Backoff{Type: bullmq.BackoffFixed, Delay: 60_000},
			RemoveOnComplete: bullmq.KeepCount(10),
		},
	})
if err != nil {
	log.Fatal(err)
}
```

The template can't set `JobID`, `Delay`, `Deduplication` or `Repeat`.

## Managing schedulers

```go
schedulers, err := queue.JobSchedulers(ctx, 0, -1, true)
if err != nil {
	log.Fatal(err)
}
for _, s := range schedulers {
	log.Printf("%s: %d jobs so far, next at %s", s.ID, s.IterationCount, time.UnixMilli(s.Next))
}

existed, err := queue.RemoveJobScheduler(ctx, "poll")
if err != nil {
	log.Fatal(err)
}
log.Printf("removed: %v", existed)
```

`JobSchedulers` lists them by the due time of their next job, `JobScheduler`
reads one by id (or returns `nil`), and `JobSchedulersCount` counts them.
`RemoveJobScheduler` also removes the job of the next iteration while it is
still delayed; a job already waiting (such as the first job of an `Every`
scheduler) or being processed is kept, and runs once more. See
[Manage job schedulers](../guide/job-schedulers/manage-job-schedulers.md).

{% hint style="info" %}
Legacy repeatable jobs (the `repeat` option of BullMQ 5 and earlier) aren't
supported, as in BullMQ 6: migrate them to job schedulers. A Go worker
processes their jobs, but can't schedule the next ones and reports it with an
`EventError`.
{% endhint %}
