"""
Tests for per-job cancellation via AbortController / AbortSignal.

Validates:
  1. A processor that opts into a `signal` parameter receives an
     AbortSignal and can observe `aborted=True` after `Worker.cancelJob`.
  2. Awaiting `signal.wait()` resolves promptly when cancelJob is called.
  3. `cancelJob` returns False for an unknown / non-tracked job id.
  4. `cancelAllJobs` flips every active controller in one call.
  5. Processors that do NOT declare a third `signal` parameter remain
     backwards-compatible (no controller is allocated, cancelJob is a
     no-op for them).
"""

import asyncio
import os
import unittest
from asyncio import Future
from uuid import uuid4

import redis.asyncio as redis

from bullmq import AbortController, AbortError, AbortSignal, Job, Queue, Worker


prefix = os.environ.get("BULLMQ_TEST_PREFIX") or "bull"


class TestAbortController(unittest.IsolatedAsyncioTestCase):
    """Unit tests for the standalone AbortController / AbortSignal pair."""

    async def test_abort_flips_signal(self):
        controller = AbortController()
        self.assertFalse(controller.signal.aborted)
        self.assertIsNone(controller.signal.reason)

        controller.abort("timeout")

        self.assertTrue(controller.signal.aborted)
        self.assertEqual(controller.signal.reason, "timeout")

    async def test_abort_is_idempotent(self):
        controller = AbortController()
        controller.abort("first")
        controller.abort("second")  # must not raise, reason stays as first
        self.assertEqual(controller.signal.reason, "first")

    async def test_wait_resolves_after_abort(self):
        controller = AbortController()

        async def trigger():
            await asyncio.sleep(0.05)
            controller.abort("late")

        asyncio.ensure_future(trigger())
        await asyncio.wait_for(controller.signal.wait(), timeout=1.0)
        self.assertTrue(controller.signal.aborted)

    async def test_throw_if_aborted(self):
        controller = AbortController()
        controller.signal.throw_if_aborted()  # no-op while not aborted
        controller.abort("boom")
        with self.assertRaises(AbortError) as ctx:
            controller.signal.throw_if_aborted()
        self.assertEqual(ctx.exception.reason, "boom")


class TestJobCancellation(unittest.IsolatedAsyncioTestCase):
    """Integration tests: Worker.cancelJob -> processor signal."""

    def setUp(self):
        self.queueName = f"__test_queue__{uuid4().hex}"

    async def asyncTearDown(self):
        connection = redis.Redis(host="localhost")
        await connection.flushdb()
        await connection.aclose()

    async def test_processor_observes_signal_after_cancel(self):
        queue = Queue(self.queueName, {"prefix": prefix})
        await queue.add("cancellable", {"foo": "bar"})

        started = Future()
        observed_aborted = Future()

        async def process(job: Job, token: str, signal: AbortSignal):
            if not started.done():
                started.set_result(job.id)
            # Race the abort against a long sleep
            wait_task = asyncio.ensure_future(signal.wait())
            sleep_task = asyncio.ensure_future(asyncio.sleep(5.0))
            done, pending = await asyncio.wait(
                {wait_task, sleep_task}, return_when=asyncio.FIRST_COMPLETED
            )
            for p in pending:
                p.cancel()
            if not observed_aborted.done():
                observed_aborted.set_result(
                    {"aborted": signal.aborted, "reason": signal.reason}
                )
            if signal.aborted:
                raise AbortError(signal.reason)
            return "completed"

        worker = Worker(self.queueName, process, {"prefix": prefix})

        failed = Future()
        worker.on(
            "failed",
            lambda job, err: failed.done() or failed.set_result(err),
        )

        job_id = await asyncio.wait_for(started, timeout=5.0)
        # Give the processor a tick to register its signal listener
        await asyncio.sleep(0.05)

        cancelled = worker.cancelJob(job_id, "user requested")
        self.assertTrue(cancelled)

        result = await asyncio.wait_for(observed_aborted, timeout=2.0)
        self.assertTrue(result["aborted"])
        self.assertEqual(result["reason"], "user requested")

        err = await asyncio.wait_for(failed, timeout=2.0)
        self.assertIsInstance(err, AbortError)

        await worker.close(force=True)
        await queue.close()

    async def test_cancel_unknown_job_returns_false(self):
        queue = Queue(self.queueName, {"prefix": prefix})

        async def process(job: Job, token: str, signal: AbortSignal):
            return "ok"

        worker = Worker(
            self.queueName, process, {"prefix": prefix, "autorun": False}
        )

        self.assertFalse(worker.cancelJob("does-not-exist"))

        await worker.close()
        await queue.close()

    async def test_cancel_all_jobs(self):
        queue = Queue(self.queueName, {"prefix": prefix})
        await queue.add("a", {})
        await queue.add("b", {})

        started = asyncio.Queue()
        aborted_ids: list = []

        async def process(job: Job, token: str, signal: AbortSignal):
            await started.put(job.id)
            await signal.wait()
            aborted_ids.append(job.id)
            raise AbortError(signal.reason)

        worker = Worker(
            self.queueName,
            process,
            {"prefix": prefix, "concurrency": 2},
        )

        # Wait until both jobs are in flight before cancelling.
        seen: set = set()
        while len(seen) < 2:
            jid = await asyncio.wait_for(started.get(), timeout=5.0)
            seen.add(jid)

        worker.cancelAllJobs("shutdown")

        # Both processors should have observed the abort and re-raised.
        deadline = asyncio.get_event_loop().time() + 2.0
        while (
            len(aborted_ids) < 2
            and asyncio.get_event_loop().time() < deadline
        ):
            await asyncio.sleep(0.05)

        self.assertEqual(set(aborted_ids), seen)

        await worker.close(force=True)
        await queue.close()

    async def test_processor_without_signal_param_still_works(self):
        """A 2-arg processor must keep working and cancelJob must be a
        no-op (returns False) for its jobs since no controller exists."""
        queue = Queue(self.queueName, {"prefix": prefix})
        await queue.add("legacy", {"foo": "bar"})

        async def process(job: Job, token: str):
            # Yield once so the lock manager actually has the job tracked
            # when the assertion below runs.
            await asyncio.sleep(0.05)
            return "ok"

        worker = Worker(self.queueName, process, {"prefix": prefix})

        # Capture the job id as soon as it becomes active
        active = Future()
        worker.on(
            "active",
            lambda job, prev: active.done() or active.set_result(job.id),
        )

        completed = Future()
        worker.on(
            "completed",
            lambda job, result: completed.done() or completed.set_result(result),
        )

        job_id = await asyncio.wait_for(active, timeout=5.0)
        # The legacy processor opted out of the signal arg, so the worker
        # never allocated a controller; cancelJob must report False.
        self.assertFalse(worker.cancelJob(job_id))

        self.assertEqual(await asyncio.wait_for(completed, timeout=5.0), "ok")

        await worker.close()
        await queue.close()


if __name__ == "__main__":
    unittest.main()
