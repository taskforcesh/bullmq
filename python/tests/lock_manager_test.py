"""
Tests for the LockManager class and its integration with Worker.

Validates that:
  1. A long-running job (longer than lockDuration) survives because the
     LockManager renews its lock atomically via the extendLocks Lua script.
  2. The worker emits `locksRenewed` events while a job is in flight.
  3. Tracked-job count returns to 0 after completion (no leaks).
"""

from asyncio import Future
import asyncio
import os
import unittest
from uuid import uuid4

import redis.asyncio as redis
from redis.cluster import block_pipeline_command

from bullmq import Job, Queue, Worker
from bullmq.lock_manager import LockManager


queueName = ""
prefix = os.environ.get("BULLMQ_TEST_PREFIX") or "bull"


class _ClusterLikePipeline:
    """Mimics redis-py's cluster pipeline, which refuses pipelined EVALSHA."""

    evalsha = block_pipeline_command("evalsha")

class TestLockManager(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        global queueName
        queueName = f"__test_queue__{uuid4().hex}"

    async def asyncTearDown(self):
        connection = redis.Redis(host="localhost")
        await connection.flushdb()
        await connection.aclose()

    async def test_long_running_job_survives_lock_renewal(self):
        """A processor running longer than lockDuration must not be moved to
        stalled, because LockManager renews the lock on time."""
        queue = Queue(queueName, {"prefix": prefix})
        await queue.add("long", {"foo": "bar"})

        async def process(job: Job, token: str):
            # Sleep ~2.5x the lock duration to force at least one renewal.
            await asyncio.sleep(2.5)
            return "done"

        worker = Worker(
            queueName,
            process,
            {
                "prefix": prefix,
                "lockDuration": 1000,
                "lockRenewTime": 500,
            },
        )

        completed = Future()
        worker.on("completed", lambda job, result: completed.set_result(result))

        result = await completed
        self.assertEqual(result, "done")

        await worker.close()
        await queue.close()

    async def test_locks_renewed_event_emitted(self):
        """The worker should emit `locksRenewed` at least once while a job is
        in progress longer than the renewal window."""
        queue = Queue(queueName, {"prefix": prefix})
        await queue.add("renew", {"foo": "bar"})

        renew_events = []

        async def process(job: Job, token: str):
            await asyncio.sleep(2.0)
            return "ok"

        worker = Worker(
            queueName,
            process,
            {
                "prefix": prefix,
                "lockDuration": 1000,
                "lockRenewTime": 500,
            },
        )

        worker.on("locksRenewed", lambda payload: renew_events.append(payload))

        completed = Future()
        worker.on("completed", lambda job, result: completed.set_result(result))

        await completed
        # Give the loop a tick to flush any pending event handlers.
        await asyncio.sleep(0.05)

        self.assertGreaterEqual(len(renew_events), 1)
        first = renew_events[0]
        self.assertIn("count", first)
        self.assertIn("jobIds", first)
        self.assertGreaterEqual(first["count"], 1)

        await worker.close()
        await queue.close()

    async def test_tracked_jobs_cleared_after_completion(self):
        """After a job completes, the LockManager should no longer track it."""
        queue = Queue(queueName, {"prefix": prefix})
        await queue.add("clean", {"foo": "bar"})

        async def process(job: Job, token: str):
            return "done"

        worker = Worker(
            queueName,
            process,
            {
                "prefix": prefix,
                "lockDuration": 1000,
                "lockRenewTime": 500,
            },
        )

        completed = Future()
        worker.on("completed", lambda job, result: completed.set_result(None))

        await completed
        # Give the finally-block a chance to run untrack_job().
        await asyncio.sleep(0.05)

        self.assertEqual(worker.lockManager.get_active_job_count(), 0)

        await worker.close()
        await queue.close()

    async def test_lock_manager_closes_idempotently(self):
        """Calling close() twice must not raise."""
        queue = Queue(queueName, {"prefix": prefix})

        async def process(job: Job, token: str):
            return "done"

        worker = Worker(queueName, process, {"prefix": prefix})

        await worker.lockManager.close()
        await worker.lockManager.close()  # second close must be a no-op

        await worker.close()
        await queue.close()

    async def test_extend_locks_does_not_pipeline_lua_scripts(self):
        """Redis Cluster blocks EVALSHA inside pipelines, so renewing locks must
        run the single extendLocks script rather than pipelining extendLock."""
        queue = Queue(queueName, {"prefix": prefix})
        job = await queue.add("renew", {"foo": "bar"})
        renewals = Future()

        async def process(job: Job, token: str):
            conn = worker.backend.connection.conn
            conn.pipeline = lambda *args, **kwargs: _ClusterLikePipeline()
            try:
                renewed = await worker.backend.extendLocks([job.id], [token], 30000)
                rejected = await worker.backend.extendLocks([job.id], ["not-the-token"], 30000)
                renewals.set_result((renewed, rejected))
            except Exception as error:
                renewals.set_exception(error)
            finally:
                del conn.pipeline
            return "ok"

        worker = Worker(queueName, process, {"prefix": prefix})

        try:
            renewed, rejected = await renewals
            self.assertEqual(renewed, [])
            self.assertEqual(rejected, [job.id])
        finally:
            await worker.close()
            await queue.close()


if __name__ == "__main__":
    unittest.main()
