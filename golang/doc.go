// Package bullmq is the official Go implementation of BullMQ, the Redis backed job queue.
//
// Jobs are fully interoperable with the Node.js, Python, PHP, Elixir, Rust and .NET ports:
// every state transition is performed by the same shared Lua scripts, so a
// queue may be produced by one language and consumed by another.
//
// The three main types are [Queue] for adding jobs, [Worker] for processing
// them and [QueueEvents] for observing everything that happens on a queue.
//
//	queue, err := bullmq.NewQueue("emails", &bullmq.QueueOptions{
//		Redis: bullmq.RedisOptions{Addr: "127.0.0.1:6379"},
//	})
//	if err != nil {
//		return err
//	}
//	defer queue.Close()
//
//	if _, err := queue.Add(ctx, "welcome", payload, nil); err != nil {
//		return err
//	}
//
// The Lua commands are embedded at build time from the commands directory,
// which is the canonical home of the scripts shared by every port. They are
// committed with their @include directives intact and interpolated in memory
// on first use, so `go get` yields a package that compiles without any Node.js
// tooling.
//
// Queue, Worker, QueueEvents and Job only depend on the Backend interface.
// The bundled implementation is RedisBackend; other datastores can be plugged
// in through a BackendFactory. See FEATURE_PARITY.md for the current status
// relative to the reference implementation.
package bullmq
