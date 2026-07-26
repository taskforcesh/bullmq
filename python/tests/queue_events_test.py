"""
Tests for the QueueEvents class.
"""

import asyncio
import os
import unittest
from asyncio import Future
from uuid import uuid4

import redis.asyncio as redis

from bullmq import Job, Queue, QueueEvents, QueueEventsProducer, Worker


prefix = os.environ.get("BULLMQ_TEST_PREFIX") or "bull"


class TestQueueEvents(unittest.IsolatedAsyncioTestCase):

    async def asyncTearDown(self):
        connection = redis.Redis(host="localhost")
        await connection.flushdb()
        await connection.aclose()

    async def test_emits_added_event_with_job_id(self):
        """`Queue.add` triggers the `added` event on the stream; the
        consumer must surface it with the job id and name."""
        queue_name = f"__test_qe_added__{uuid4().hex}"
        queue = Queue(queue_name, {"prefix": prefix})
        # lastEventId='0' replays the stream from the beginning. Because
        # asyncTearDown flushes the DB, the stream starts empty for each
        # test, so this is race-free without the brittle `sleep(0.1)`.
        events = QueueEvents(
            queue_name, {"prefix": prefix, "lastEventId": "0"}
        )
        try:
            received: Future = asyncio.get_running_loop().create_future()

            def on_added(args, event_id):
                if not received.done():
                    received.set_result(args)

            events.on("added", on_added)

            job = await queue.add("hello", {"foo": "bar"})
            args = await asyncio.wait_for(received, timeout=5)

            self.assertEqual(args.get("jobId"), job.id)
            self.assertEqual(args.get("name"), "hello")
        finally:
            await events.close()
            await queue.close()

    async def test_emits_completed_event_with_parsed_returnvalue(self):
        """The `completed` event's `returnvalue` field is JSON-encoded
        on the stream; the consumer must decode it back to a native
        Python value before invoking listeners."""
        queue_name = f"__test_qe_completed__{uuid4().hex}"
        events = QueueEvents(
            queue_name, {"prefix": prefix, "lastEventId": "0"}
        )

        async def processor(job: Job, token: str):
            return {"answer": 42, "ok": True}

        worker = Worker(queue_name, processor, {"prefix": prefix})
        queue = Queue(queue_name, {"prefix": prefix})
        try:
            received: Future = asyncio.get_running_loop().create_future()

            def on_completed(args, event_id):
                if not received.done():
                    received.set_result(args)

            events.on("completed", on_completed)

            await queue.add("done", {})
            args = await asyncio.wait_for(received, timeout=5)

            self.assertEqual(args.get("returnvalue"), {"answer": 42, "ok": True})
        finally:
            await worker.close()
            await events.close()
            await queue.close()

    async def test_per_job_event_channel(self):
        """`on('<event>:<jobId>')` must fire only for the matching
        job. This is the channel that powers `waitUntilFinished` in
        Node and equivalent patterns here."""
        queue_name = f"__test_qe_per_job__{uuid4().hex}"
        # autorun=False so we control startup ordering precisely:
        # listener attached -> jobs enqueued -> consumer started.
        # Combined with lastEventId='0' this removes the historical
        # race where the consumer attached after `completed:<job_b.id>`
        # had already fired.
        events = QueueEvents(
            queue_name,
            {"prefix": prefix, "lastEventId": "0", "autorun": False},
        )

        async def processor(job: Job, token: str):
            return job.data.get("idx")

        # Start the worker AFTER the queue.add calls so the events
        # land on the stream in a predictable order.
        queue = Queue(queue_name, {"prefix": prefix})
        worker = None
        try:
            job_a = await queue.add("a", {"idx": 1})
            job_b = await queue.add("b", {"idx": 2})

            target_done: Future = asyncio.get_running_loop().create_future()

            def on_target(args, event_id):
                if not target_done.done():
                    target_done.set_result(args)

            events.on(f"completed:{job_b.id}", on_target)
            asyncio.ensure_future(events.run())

            worker = Worker(queue_name, processor, {"prefix": prefix})

            args = await asyncio.wait_for(target_done, timeout=5)
            self.assertEqual(args.get("jobId"), job_b.id)
            # Sanity: the listener must not have observed job_a.
            self.assertNotEqual(args.get("jobId"), job_a.id)
        finally:
            if worker is not None:
                await worker.close()
            await events.close()
            await queue.close()

    async def test_close_is_idempotent_and_stops_consumer(self):
        """`close()` must stop the consumer task and tolerate being
        called twice without raising."""
        queue_name = f"__test_qe_close__{uuid4().hex}"
        events = QueueEvents(queue_name, {"prefix": prefix})

        # Give autorun a moment to spawn the consumer task.
        await asyncio.sleep(0.05)
        self.assertTrue(events.running or events._consumer_task is not None)

        await events.close()
        self.assertTrue(events.closed)

        # Second close must be a no-op.
        await events.close()
        self.assertTrue(events.closed)

    async def test_producer_publishes_custom_event(self):
        """`QueueEventsProducer.publishEvent` writes to the same
        stream `QueueEvents` consumes; the custom event must round
        trip with its payload intact."""
        queue_name = f"__test_qe_producer__{uuid4().hex}"
        events = QueueEvents(
            queue_name, {"prefix": prefix, "lastEventId": "0"}
        )
        producer = QueueEventsProducer(queue_name, {"prefix": prefix})
        try:
            received: Future = asyncio.get_running_loop().create_future()

            def on_custom(args, event_id):
                if not received.done():
                    received.set_result(args)

            events.on("custom-thing", on_custom)

            await producer.publishEvent(
                {"eventName": "custom-thing", "foo": "bar", "n": "7"}
            )

            args = await asyncio.wait_for(received, timeout=5)
            self.assertEqual(args.get("foo"), "bar")
            self.assertEqual(args.get("n"), "7")
        finally:
            await producer.close()
            await events.close()


if __name__ == "__main__":
    unittest.main()
