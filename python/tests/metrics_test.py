"""
Tests for queue metrics.

Ports tests/metrics.test.ts. Instead of Node's fake timers, the clock used by
the Lua script wrappers is replaced, so each processor can advance the time
seen when its job finishes.

https://bbc.github.io/cloudfit-public-docs/asyncio/testing.html
"""

from asyncio import Future
from datetime import datetime, timezone
from unittest.mock import patch
from uuid import uuid4
import redis.asyncio as redis
from bullmq import Queue, Worker

import asyncio
import unittest
import os

queueName = ""
prefix = os.environ.get('BULLMQ_TEST_PREFIX') or "bull"
PG_ENABLED = os.environ.get("BULLMQ_TEST_BACKEND") == "postgres"

ONE_SECOND = 1000
ONE_MINUTE = 60 * ONE_SECOND
ONE_HOUR = 60 * ONE_MINUTE
TWO_HOURS_OF_DATA_POINTS = 120


class FakeClock:
    """Stands in for the `time` module inside bullmq.scripts."""

    def __init__(self, start: datetime):
        self.now_ms = int(start.timestamp() * 1000)

    def time(self) -> float:
        return self.now_ms / 1000

    def tick(self, ms: int):
        self.now_ms += ms


class TestMetrics(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        global queueName
        queueName = f"__test_queue__{uuid4().hex}"
        self.clock = FakeClock(datetime(2017, 2, 7, 9, 24, tzinfo=timezone.utc))
        self.clock_patch = patch("bullmq.scripts.time", self.clock)
        self.clock_patch.start()
        # The PostgreSQL backend stamps finished jobs with its own _now_ms, not bullmq.scripts.time.
        # Patch it only on that backend: the Redis CI does not install its driver.
        self.pg_clock_patch = None
        if PG_ENABLED:
            self.pg_clock_patch = patch(
                "bullmq.backends.postgres_backend._now_ms", lambda: self.clock.now_ms
            )
            self.pg_clock_patch.start()

    async def asyncTearDown(self):
        self.clock_patch.stop()
        if self.pg_clock_patch:
            self.pg_clock_patch.stop()
        # On PostgreSQL conftest drops the schema before each test instead.
        if PG_ENABLED:
            return
        connection = redis.Redis(host='localhost')
        await connection.flushdb()
        await connection.aclose()

    async def process_jobs(self, queue: Queue, timings: list[int], event: str):
        async def process(job, token):
            self.clock.tick(timings[job.data["index"]])
            if event == "failed":
                raise Exception("test")

        worker = Worker(queueName, process, {
            "prefix": prefix,
            "autorun": False,
            "metrics": {"maxDataPoints": TWO_HOURS_OF_DATA_POINTS},
        })

        processed = 0
        all_processed = Future()

        def on_finished(*args):
            nonlocal processed
            processed += 1
            if processed == len(timings):
                all_processed.set_result(None)

        worker.on(event, on_finished)

        for index in range(len(timings)):
            await queue.add("test", {"index": index})

        asyncio.ensure_future(worker.run())
        await all_processed
        await worker.close()

    async def test_gather_metrics_for_completed_jobs(self):
        timings = [
            0,
            0,  # For the fixtures to work we need to use 0 as first timing
            ONE_MINUTE // 2,
            ONE_MINUTE // 2,
            0,
            0,
            ONE_MINUTE,
            ONE_MINUTE,
            ONE_MINUTE * 3,
            ONE_SECOND * 70,
            ONE_SECOND * 50,
            ONE_HOUR,
            ONE_MINUTE,
        ]
        fixture = [
            1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 3, 3,
        ]
        queue = Queue(queueName, {"prefix": prefix})

        await self.process_jobs(queue, timings, "completed")

        metrics = await queue.getMetrics("completed")

        num_points = sum(timings) // ONE_MINUTE
        self.assertEqual(metrics["meta"]["count"], len(timings))
        self.assertEqual(len(metrics["data"]), num_points)
        self.assertEqual(metrics["count"], len(metrics["data"]))
        self.assertEqual(metrics["data"], fixture)
        # The last job opened a new data point, so the baseline moved to it.
        self.assertEqual(metrics["meta"]["prevTS"], self.clock.now_ms)
        self.assertEqual(metrics["meta"]["prevCount"], len(timings) - 1)

        await queue.close()

    async def test_gather_metrics_for_failed_jobs(self):
        timings = [
            0,  # For the fixtures to work we need to use 0 as first timing
            ONE_MINUTE,
            ONE_MINUTE // 5,
            ONE_MINUTE // 2,
            0,
            ONE_MINUTE,
            ONE_MINUTE * 3,
            0,
        ]
        fixture = [0, 0, 1, 4, 1]
        queue = Queue(queueName, {"prefix": prefix})

        await self.process_jobs(queue, timings, "failed")

        metrics = await queue.getMetrics("failed")

        num_points = sum(timings) // ONE_MINUTE
        self.assertEqual(metrics["meta"]["count"], len(timings))
        self.assertEqual(len(metrics["data"]), num_points)
        self.assertEqual(metrics["count"], len(metrics["data"]))
        self.assertEqual(metrics["data"], fixture)

        await queue.close()

    async def test_get_metrics_with_pagination(self):
        timings = [
            0,
            0,  # For the fixtures to work we need to use 0 as first timing
            ONE_MINUTE // 2,
            ONE_MINUTE // 2,
            0,
            0,
            ONE_MINUTE,
            ONE_MINUTE,
            ONE_MINUTE * 3,
            ONE_HOUR,
            ONE_MINUTE,
        ]
        queue = Queue(queueName, {"prefix": prefix})

        await self.process_jobs(queue, timings, "completed")

        num_points = sum(timings) // ONE_MINUTE
        page_size = 10
        data = []
        skip = 0

        while skip < num_points:
            metrics = await queue.getMetrics("completed", skip, skip + page_size - 1)
            self.assertEqual(metrics["meta"]["count"], len(timings))
            self.assertEqual(len(metrics["data"]), min(num_points - skip, page_size))
            self.assertEqual(metrics["count"], num_points)

            data.extend(metrics["data"])
            skip += page_size

        metrics = await queue.getMetrics("completed")
        self.assertEqual(data, metrics["data"])

        await queue.close()

    async def test_get_metrics_with_negative_indexes(self):
        timings = [0, ONE_MINUTE, ONE_MINUTE, ONE_MINUTE, ONE_MINUTE]
        queue = Queue(queueName, {"prefix": prefix})

        await self.process_jobs(queue, timings, "completed")

        all_points = (await queue.getMetrics("completed"))["data"]
        num_points = len(all_points)

        # Same semantics as Redis LRANGE: -1 is the oldest point, -2 the one before it.
        without_oldest = await queue.getMetrics("completed", 0, -2)
        self.assertEqual(without_oldest["data"], all_points[:-1])
        self.assertEqual(without_oldest["count"], num_points)

        oldest_two = await queue.getMetrics("completed", -2, -1)
        self.assertEqual(oldest_two["data"], all_points[-2:])

        # A start before the first point is clamped to it.
        from_before_start = await queue.getMetrics("completed", -num_points - 5, -1)
        self.assertEqual(from_before_start["data"], all_points)

        empty_range = await queue.getMetrics("completed", 0, -num_points - 1)
        self.assertEqual(empty_range["data"], [])

        inverted_range = await queue.getMetrics("completed", 2, 1)
        self.assertEqual(inverted_range["data"], [])

        start_past_end = await queue.getMetrics("completed", num_points, num_points + 5)
        self.assertEqual(start_past_end["data"], [])

        await queue.close()

    async def test_get_metrics_without_data(self):
        queue = Queue(queueName, {"prefix": prefix})

        metrics = await queue.getMetrics("completed")

        self.assertEqual(metrics, {
            "meta": {"count": 0, "prevTS": 0, "prevCount": 0},
            "data": [],
            "count": 0,
        })

        await queue.close()


if __name__ == '__main__':
    unittest.main()
