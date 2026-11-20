// Package bullmq is the official Go implementation of BullMQ, the job queue
// for Redis and PostgreSQL.
//
// Jobs are fully interoperable with the Node.js, Python, Elixir, PHP, Rust
// and .NET ports: every state transition runs the same shared Lua scripts
// (Redis) or SQL (PostgreSQL), so a queue may be produced by one language and
// consumed by another.
//
// # Backends
//
// [Queue], [Worker], [QueueEvents] and [FlowProducer] only depend on the
// [Backend] interface, and this package imports no datastore driver. The
// datastore is chosen with the required Backend option, a [BackendFactory]:
//
//   - redisbackend.New, in package
//     github.com/taskforcesh/bullmq-go/redisbackend, for Redis. Its Options
//     hold the address, credentials, the key prefix ("bull" by default) or an
//     existing go-redis client.
//   - postgresbackend.New, in package
//     github.com/taskforcesh/bullmq-go/postgresbackend, for PostgreSQL. Its
//     Options hold the connection string or pgxpool pool, the schema
//     ("bullmq" by default, migrated on first use) and the pool size.
//
// A constructor called without a Backend returns a [*ConfigError].
//
// # Adding and processing jobs
//
//	backend := redisbackend.New(redisbackend.Options{Addr: "127.0.0.1:6379"})
//
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
//	worker, err := bullmq.NewWorker("emails", func(ctx context.Context, job *bullmq.Job) (any, error) {
//		var p Payload
//		if err := job.DecodeData(&p); err != nil {
//			return nil, bullmq.NewUnrecoverableError("invalid payload: %v", err)
//		}
//		return send(ctx, p)
//	}, &bullmq.WorkerOptions{Backend: backend, Concurrency: 10})
//	if err != nil {
//		return err
//	}
//	defer worker.Close()
//
//	return worker.Run(ctx)
//
// A [Processor] returns the job's result, stored as JSON, or an error that
// fails the attempt; the job is retried while [JobOptions.Attempts] remain,
// after its [Backoff]. Each processing slot finishes its job and fetches the
// next one in the same backend call, so a busy worker needs about one round
// trip per job whatever its concurrency.
//
// # Stopping a worker
//
// [Worker.Close] is a graceful shutdown: the worker stops fetching and waits
// for the jobs in flight. Cancelling the context passed to [Worker.Run]
// stops it immediately: the processors' contexts are cancelled, and the jobs
// they were running stay active, without using up an attempt, until the
// stalled check of a running worker moves them back to wait. Close must still
// be called to release the connections. [Worker.CancelJob] cancels the
// context of one job, which then fails with the given reason; [context.Cause]
// tells a processor why its context was cancelled ([ErrJobCancelled],
// [ErrLockLost] or the cause of the Run context).
//
// # Events
//
// [Worker.Events] publishes lifecycle events on a buffered channel that drops
// events when the reader falls behind ([Worker.DroppedEvents] counts them);
// [WorkerOptions.OnEvent] receives every event synchronously. [QueueEvents]
// reads the event stream shared by every worker of a queue, in any language.
//
// # Flows and job schedulers
//
// [FlowProducer] adds trees of jobs whose parents wait for their children.
// [Queue.UpsertJobScheduler] creates job schedulers, which repeat a job on a
// cron pattern, evaluated as cron-parser does in Node.js, or at a fixed
// interval.
//
// The README of the golang directory of the BullMQ repository is the user
// guide, and FEATURE_PARITY.md lists what is implemented relative to the
// Node.js reference implementation.
package bullmq
