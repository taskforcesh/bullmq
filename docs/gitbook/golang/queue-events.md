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
		log.Printf("job %s progress: %s", ev.JobID, ev.Data["data"])
	}
}
```

Each `bullmq.QueueEvent` has:

- `Event`: the event name, the same as in the other SDKs (`added`,
  `waiting`, `active`, `progress`, `completed`, `failed`, `delayed`,
  `stalled`, `removed`, `deduplicated`, `drained`, ...);
- `JobID`: the job it refers to, when there is one;
- `Data`: every field of the event; `ReturnValue()` and `FailedReason()`
  read the usual ones;
- `ID`: the event's id in the stream.

| Option            | Default | Meaning                                                                                      |
| ----------------- | ------- | -------------------------------------------------------------------------------------------- |
| `Backend`         |         | Required: the datastore backend factory                                                      |
| `LastEventID`     | `$`     | Where to start: `$` for the events published after `Run` starts, `0` for the oldest one kept |
| `BlockingTimeout` | 5 s     | How long each read waits for new events                                                      |
| `BufferSize`      | 128     | Size of the `Events()` channel                                                               |

`Run` blocks until its context is cancelled or `Close` is called, and then
closes `Events()`. Unlike worker events, the channel isn't lossy: the listener
waits for its reader, so keep reading it. Read errors are retried, and
reported on `Errors()` when someone reads it.

{% hint style="warning" %}
On PostgreSQL, a listener can miss events when several jobs finish at the
same time: event ids are assigned before their transaction commits, so a
listener can read past an event that commits later. This affects every SDK
until [#5183](https://github.com/taskforcesh/bullmq/issues/5183) is fixed.
Don't rely on seeing every `completed` or `failed` event on PostgreSQL; read
the job's state instead.
{% endhint %}

See also the [Events guide](../guide/events/).
