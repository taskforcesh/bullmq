---
description: Listening to the global events of a queue with BullMQ for Go.
---

# Queue Events

A `bullmq.QueueEvents` reads the queue's shared event stream, so it sees what
every worker and producer of the queue does, in any language. Worker events
(`worker.Events()`) only cover the jobs of one worker; see
[Workers](workers.md#events).

```go
events, err := bullmq.NewQueueEvents("emails", &bullmq.QueueEventsOptions{Backend: backend})
if err != nil {
	log.Fatal(err)
}
defer events.Close()

go func() {
	if err := events.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
		log.Printf("queue events: %v", err)
	}
}()

for ev := range events.Events() {
	switch ev.Event {
	case "completed":
		log.Printf("job %s returned %s", ev.JobID, ev.ReturnValue())
	case "failed":
		log.Printf("job %s failed: %s", ev.JobID, ev.FailedReason())
	case "progress":
		var progress map[string]any
		if err := ev.DecodeProgress(&progress); err == nil {
			log.Printf("job %s progress: %v", ev.JobID, progress)
		}
	}
}
```

Each `bullmq.QueueEvent` has:

- `Event`: the event name, the same as in the other SDKs (`added`,
  `waiting`, `active`, `progress`, `completed`, `failed`, `delayed`,
  `stalled`, `removed`, `deduplicated`, `drained`, ...);
- `JobID`: the job it refers to, when there is one;
- `Data`: every field of the event, as strings; `ReturnValue()` and
  `FailedReason()` read the usual ones;
- `ID`: the event's id, opaque: a stream entry id on Redis, a number on
  PostgreSQL. Pass it as `LastEventID` to resume after that event.

The helpers parse the fields that Node's `QueueEvents` parses:
`ev.DecodeReturnValue(&v)` decodes the JSON return value of `completed`,
`ev.Progress()` and `ev.DecodeProgress(&v)` the progress of `progress` (a
number or any JSON value), and `ev.DelayedUntil()` reads the `delay` of
`delayed`, which is when the job is due (Unix milliseconds), not a duration.

| Option            | Default | Meaning                                                                                      |
| ----------------- | ------- | -------------------------------------------------------------------------------------------- |
| `Backend`         |         | Required: the datastore backend factory                                                      |
| `LastEventID`     | `$`     | Where to start: `$` for the events published after `Run` starts, `0` for the oldest one kept |
| `BlockingTimeout` | 5 s     | The longest a single read waits for new events                                               |
| `BufferSize`      | 128     | Size of the `Events()` channel                                                               |

`Run` blocks until its context is cancelled or `Close` is called, and then
closes `Events()`. It returns nil after `Close` and the context's error when
the context is done, as `worker.Run` does. Unlike worker events, the channel
isn't lossy: the listener waits for its reader, so keep reading it. Read
errors are retried, and reported on `Errors()` when someone reads it.

{% hint style="warning" %}
On PostgreSQL, a listener can miss events when several jobs finish at the
same time: event ids are assigned before their transaction commits, so a
listener can read past an event that commits later. This affects every SDK
until [#5183](https://github.com/taskforcesh/bullmq/issues/5183) is fixed.
Don't rely on seeing every `completed` or `failed` event on PostgreSQL; read
the job's state instead.
{% endhint %}

## Custom events

A `QueueEventsProducer` publishes custom events, as Node's does with
`publishEvent`; listeners in every runtime receive them with the event name
in `Event` and the fields in `Data`. String values are stored as they are and
other values as JSON. On Redis the stream is then trimmed to about
`maxEvents` events (1,000 when it is 0); PostgreSQL trims it to
`EventsMaxLen`. Don't use the names of job events (`completed`, `failed`,
...) for your own.

```go
producer, err := bullmq.NewQueueEventsProducer("emails", &bullmq.QueueEventsProducerOptions{Backend: backend})
if err != nil {
	log.Fatal(err)
}
defer producer.Close()

// Listeners see ev.Event == "example" and ev.Data["custom"] == "value".
if _, err := producer.PublishEvent(ctx, "example", map[string]any{"custom": "value"}, 0); err != nil {
	log.Fatal(err)
}
```

See [Create custom events](../guide/events/create-custom-events.md).

## The length of the stream

The stream keeps about `QueueOptions.EventsMaxLen` events (10,000 by
default, Node's `streams.events.maxLen`). `queue.TrimEvents(ctx, n)` trims
it to about `n` events, as Node's `trimEvents` does, and returns how many it
removed:

```go
removed, err := queue.TrimEvents(ctx, 10)
if err != nil {
	log.Fatal(err)
}
log.Printf("trimmed %d events", removed)
```

On Redis the trim is approximate (`XTRIM MAXLEN ~`): whole stream nodes go,
so a few more than `n` events may be left. The PostgreSQL backend returns an
error matching `bullmq.ErrNotSupported`, as Node's does; it trims the stream
to `EventsMaxLen` as it adds events.

See also the [Events guide](../guide/events/).
