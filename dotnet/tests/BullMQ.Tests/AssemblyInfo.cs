using Xunit;

// These are integration tests that all share a single Redis and PostgreSQL
// instance. Running test collections in parallel makes many connections/workers
// contend on that shared state (and, under load, stall for tens of seconds),
// so run them sequentially. Each test is fast, so the serial suite is both
// quicker and deterministic.
[assembly: CollectionBehavior(DisableTestParallelization = true)]
