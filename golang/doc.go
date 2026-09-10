// Package bullmq is a Go implementation of BullMQ, the Redis backed job queue.
//
// Jobs are fully interoperable with the Node.js, Python, Rust and .NET ports:
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
// which is generated from the repository root with:
//
//	yarn generate:raw:scripts && yarn copy:lua:golang
//
// Only the Redis backend is supported. See FEATURE_PARITY.md for the current
// status relative to the reference implementation.
package bullmq
