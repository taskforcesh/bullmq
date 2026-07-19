"""Throughput benchmark comparing the Redis and PostgreSQL backends.

Measures three workloads for each backend and prints jobs/second:

* add     -- sequential ``queue.add`` calls
* addBulk -- ``queue.addBulk`` in batches
* process -- a worker draining a pre-filled queue

Usage::

    python benchmark_backends.py [--jobs N] [--concurrency C] [--backends redis,postgres]

PostgreSQL connection: BULLMQ_PG_URL (default ``host=localhost dbname=bullmq_test``).
"""

import argparse
import asyncio
import os
import time

from bullmq import Queue, Worker, Job

REDIS_OPTS = {"prefix": "bench"}
PG_URL = os.environ.get("BULLMQ_PG_URL", "host=localhost dbname=bullmq_test")
PG_OPTS = {"backend": "postgres", "connection": PG_URL, "schema": "bullmq"}

BATCH = 1000


async def _reset(backend: str) -> None:
    if backend == "redis":
        import redis.asyncio as redis

        conn = redis.Redis(host="localhost")
        await conn.flushdb()
        await conn.aclose()
    else:
        import psycopg

        conn = await psycopg.AsyncConnection.connect(PG_URL, autocommit=True)
        await conn.execute("DROP SCHEMA IF EXISTS bullmq CASCADE")
        await conn.close()


def _opts(backend: str) -> dict:
    return REDIS_OPTS if backend == "redis" else PG_OPTS


async def bench_add(backend: str, n: int) -> float:
    queue = Queue("bench_add", _opts(backend))
    await queue.add("warmup", {}, {})  # trigger connect / migration
    start = time.monotonic()
    for i in range(n):
        await queue.add("job", {"i": i}, {"removeOnComplete": True})
    elapsed = time.monotonic() - start
    await queue.close()
    return n / elapsed


async def bench_add_parallel(backend: str, n: int, parallelism: int) -> float:
    """Add ``n`` jobs using ``parallelism`` concurrent adders on one queue."""
    queue = Queue("bench_padd", _opts(backend))
    await queue.add("warmup", {}, {})

    async def adder(indices):
        for i in indices:
            await queue.add("job", {"i": i}, {"removeOnComplete": True})

    chunks = [range(k, n, parallelism) for k in range(parallelism)]
    start = time.monotonic()
    await asyncio.gather(*(adder(chunk) for chunk in chunks))
    elapsed = time.monotonic() - start
    await queue.close()
    return n / elapsed


async def bench_add_bulk(backend: str, n: int) -> float:
    queue = Queue("bench_bulk", _opts(backend))
    await queue.add("warmup", {}, {})
    start = time.monotonic()
    for base in range(0, n, BATCH):
        jobs = [
            {"name": "job", "data": {"i": i}, "opts": {"removeOnComplete": True}}
            for i in range(base, min(base + BATCH, n))
        ]
        await queue.addBulk(jobs)
    elapsed = time.monotonic() - start
    await queue.close()
    return n / elapsed


async def bench_process(backend: str, n: int, concurrency: int) -> float:
    queue = Queue("bench_proc", _opts(backend))
    for base in range(0, n, BATCH):
        jobs = [
            {"name": "job", "data": {"i": i}, "opts": {"removeOnComplete": True}}
            for i in range(base, min(base + BATCH, n))
        ]
        await queue.addBulk(jobs)

    done = asyncio.get_event_loop().create_future()
    processed = [0]

    async def process(job: Job, token: str):
        processed[0] += 1
        if processed[0] == n and not done.done():
            done.set_result(None)
        return 1

    start = time.monotonic()
    worker = Worker(
        "bench_proc",
        process,
        {**_opts(backend), "concurrency": concurrency, "removeOnComplete": True},
    )
    await done
    elapsed = time.monotonic() - start
    await worker.close(force=True)
    await queue.close()
    return n / elapsed


async def run_backend(backend: str, jobs: int, parallelism: int, concurrencies: list) -> dict:
    results = {}
    await _reset(backend)
    results["add"] = await bench_add(backend, jobs)
    await _reset(backend)
    results[f"addParallel({parallelism})"] = await bench_add_parallel(backend, jobs, parallelism)
    await _reset(backend)
    results["addBulk"] = await bench_add_bulk(backend, jobs)
    for c in concurrencies:
        await _reset(backend)
        results[f"process(c={c})"] = await bench_process(backend, jobs, c)
    await _reset(backend)
    return results


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--jobs", type=int, default=2000)
    parser.add_argument("--concurrency", default="10",
                        help="worker concurrency; pass a comma-separated list to sweep (e.g. 1,10,50,100)")
    parser.add_argument("--parallelism", type=int, default=50,
                        help="number of concurrent adders for the parallel-add workload")
    parser.add_argument("--backends", default="redis,postgres")
    args = parser.parse_args()

    backends = [b.strip() for b in args.backends.split(",") if b.strip()]
    concurrencies = [int(c) for c in str(args.concurrency).split(",") if c.strip()]
    print(
        f"Benchmark: {args.jobs} jobs | parallel-add={args.parallelism} | "
        f"process concurrency {concurrencies}\n"
    )

    all_results = {}
    for backend in backends:
        print(f"Running {backend}...")
        all_results[backend] = await run_backend(
            backend, args.jobs, args.parallelism, concurrencies
        )

    workloads = list(all_results[backends[0]].keys())
    header = f"{'workload':<18}" + "".join(f"{b:>16}" for b in backends)
    if len(backends) == 2:
        header += f"{'ratio':>10}"
    print("\n" + header)
    print("-" * len(header))
    for w in workloads:
        row = f"{w:<18}"
        for b in backends:
            row += f"{all_results[b][w]:>13,.0f}/s"
        if len(backends) == 2:
            a, c = all_results[backends[0]][w], all_results[backends[1]][w]
            row += f"{c / a:>9.2f}x"
        print(row)


if __name__ == "__main__":
    asyncio.run(main())
