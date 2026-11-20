// Package bullmq is the official Go implementation of BullMQ.
//
// Jobs are fully interoperable with the Node.js, Python, PHP, Elixir, Rust and .NET ports:
// every state transition is performed by the same shared commands, so a
// queue may be produced by one language and consumed by another.
//
// The main types are [Queue] for adding jobs, [Worker] for processing them,
// [QueueEvents] for observing everything that happens on a queue and
// [FlowProducer] for adding trees of jobs whose parents wait for their
// children. [Queue.UpsertJobScheduler] creates job schedulers, which repeat a
// job on a cron pattern or at a fixed interval. These types only depend on
// the [Backend] interface, and this package imports no datastore driver: the
// datastore is chosen with the required Backend option, a [BackendFactory]
// such as the one returned by redisbackend.New.
//
//	backend := redisbackend.New(redisbackend.Options{Addr: "127.0.0.1:6379"})
//	queue, err := bullmq.NewQueue("emails", &bullmq.QueueOptions{Backend: backend})
//	if err != nil {
//		return err
//	}
//	defer queue.Close()
//
//	if _, err := queue.Add(ctx, "welcome", payload, nil); err != nil {
//		return err
//	}
//
// See FEATURE_PARITY.md for the current status relative to the reference
// implementation.
package bullmq
