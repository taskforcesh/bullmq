"""
Tests for worker rate limiting: the `limiter` option, `Worker.rateLimit` and
`RateLimitError` (manual / dynamic rate limit).

Mirrors tests/rate_limiter.test.ts in the Node.js implementation.
"""

import asyncio
import os
import time
import typing
import unittest
from uuid import uuid4

import redis.asyncio as redis

from bullmq import Job, Queue, RateLimitError, Worker
from bullmq.types import RateLimiterOptions, WorkerOptions


prefix = os.environ.get("BULLMQ_TEST_PREFIX") or "bull"


def now_ms() -> int:
    return int(time.time() * 1000)


class TestRateLimiter(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        self.queueName = f"__test_queue__{uuid4().hex}"

    async def asyncTearDown(self):
        connection = redis.Redis(host="localhost")
        await connection.flushdb()
        await connection.aclose()

    def test_rate_limit_error_message(self):
        self.assertEqual(str(RateLimitError()), "bullmq:rateLimitExceeded")
        self.assertIsInstance(Worker.RateLimitError(), RateLimitError)

    def test_limiter_option_is_typed(self):
        hints = typing.get_type_hints(WorkerOptions)
        self.assertIs(hints["limiter"], RateLimiterOptions)
        self.assertEqual(
            set(typing.get_type_hints(RateLimiterOptions)), {"max", "duration"}
        )
        # Both keys are required when a limiter is given.
        self.assertEqual(RateLimiterOptions.__required_keys__, {"max", "duration"})

    async def test_should_obey_the_rate_limit(self):
        """Mirrors 'should obey the rate limit': with max=1/duration, N jobs
        take at least (N - 1) * duration."""
        num_jobs = 4
        duration = 300
        queue = Queue(self.queueName, {"prefix": prefix})
        completed = []
        all_done = asyncio.Event()

        async def process(job: Job, token: str):
            return "ok"

        def on_completed(job, result):
            completed.append(now_ms())
            if len(completed) == num_jobs:
                all_done.set()

        worker = Worker(self.queueName, process, {
            "prefix": prefix,
            "limiter": {"max": 1, "duration": duration},
        })
        worker.on("completed", on_completed)
        try:
            start = now_ms()
            await queue.addBulk([
                {"name": "rate test", "data": {}} for _ in range(num_jobs)
            ])
            await asyncio.wait_for(all_done.wait(), 10)
            elapsed = completed[-1] - start
            self.assertGreaterEqual(elapsed, (num_jobs - 1) * duration * 0.9)
        finally:
            await worker.close()
            await queue.close()

    async def test_worker_rate_limit_sets_limiter_ttl(self):
        dynamic_limit = 1000
        queue = Queue(self.queueName, {"prefix": prefix})
        worker = Worker(self.queueName, None, {"prefix": prefix, "autorun": False})
        try:
            self.assertEqual(await queue.getRateLimitTtl(), -2)
            await worker.rateLimit(dynamic_limit)
            ttl = await queue.getRateLimitTtl()
            self.assertGreater(ttl, 0)
            self.assertLessEqual(ttl, dynamic_limit)
        finally:
            await worker.close()
            await queue.close()

    async def test_rate_limit_error_moves_job_back_to_wait(self):
        """Mirrors 'when dynamic limit is used / should obey the rate limit':
        a RateLimitError moves the job back to wait without failing it nor
        consuming an attempt, and the worker does not fetch jobs until the
        rate limit ttl has expired."""
        dynamic_limit = 500
        queue = Queue(self.queueName, {"prefix": prefix})
        failed_events = []
        processed_at = []
        done = asyncio.get_running_loop().create_future()
        worker = None

        async def process(job: Job, token: str):
            processed_at.append(now_ms())
            if job.attemptsStarted == 1:
                await worker.rateLimit(dynamic_limit)
                raise Worker.RateLimitError()
            return "done"

        worker = Worker(self.queueName, process, {
            "prefix": prefix,
            "limiter": {"max": 1, "duration": 100},
        })
        worker.on("failed", lambda job, err: failed_events.append(err))
        worker.on(
            "completed",
            lambda job, result: done.done() or done.set_result(job),
        )
        try:
            job = await queue.add("rate test", {}, {"attempts": 1})
            completed_job = await asyncio.wait_for(done, 10)

            self.assertEqual(failed_events, [])
            self.assertEqual(len(processed_at), 2)
            # The second fetch waited for the rate limit window.
            self.assertGreaterEqual(
                processed_at[1] - processed_at[0], dynamic_limit * 0.9
            )

            stored = await Job.fromId(queue, job.id)
            self.assertEqual(await stored.getState(), "completed")
            # Only the successful run counts as an attempt (attempts=1 would
            # otherwise have failed the job), but both runs were started.
            self.assertEqual(stored.attemptsMade, 1)
            self.assertEqual(stored.attemptsStarted, 2)
            self.assertEqual(completed_job.returnvalue, "done")
            self.assertIsNone(stored.failedReason)
        finally:
            await worker.close()
            await queue.close()

    async def test_rate_limit_error_keeps_job_waiting_while_limited(self):
        """While the queue is rate limited the job stays in wait, its
        attempts are untouched and the worker does not pick it up; closing
        the worker does not wait for the rate limit to expire."""
        dynamic_limit = 5000
        queue = Queue(self.queueName, {"prefix": prefix})
        failed_events = []
        moved_back = asyncio.Event()
        calls = 0

        async def process(job: Job, token: str):
            nonlocal calls
            calls += 1
            await queue.rateLimit(dynamic_limit)
            raise RateLimitError()

        worker = Worker(self.queueName, process, {"prefix": prefix})
        worker.on("failed", lambda job, err: failed_events.append(err))
        try:
            job = await queue.add("rate test", {})

            # Wait until the job has been moved back to wait.
            deadline = now_ms() + 5000
            while now_ms() < deadline:
                state = await job.getState()
                if calls == 1 and state == "waiting":
                    break
                await asyncio.sleep(0.05)

            await asyncio.sleep(0.5)

            stored = await Job.fromId(queue, job.id)
            self.assertEqual(await stored.getState(), "waiting")
            self.assertEqual(stored.attemptsMade, 0)
            self.assertEqual(stored.attemptsStarted, 1)
            self.assertEqual(calls, 1)
            self.assertEqual(failed_events, [])
            self.assertEqual(await queue.getJobCounts("wait", "failed"),
                             {"wait": 1, "failed": 0})
            self.assertGreater(worker.limitUntil, now_ms())

            started_closing = now_ms()
            await worker.close()
            self.assertLess(now_ms() - started_closing, 2000)
        finally:
            await worker.close()
            await queue.close()

    async def test_move_to_wait_fails_for_missing_job(self):
        """Mirrors 'when job does not exist / should fail with job existence
        error'."""
        queue = Queue(self.queueName, {"prefix": prefix})
        try:
            job = await queue.add("test", {})
            await job.remove()
            with self.assertRaisesRegex(Exception, "Missing key for job"):
                await job.moveToWait("0")
        finally:
            await queue.close()


if __name__ == "__main__":
    unittest.main()
