"""
Tests for job priority functionality.

Verifies that prioritized jobs are stored and returned in priority order
and that they are processed before non-prioritized jobs.
"""

from bullmq import Queue, Worker
from uuid import uuid4

import asyncio
import redis.asyncio as redis
import unittest
import os

prefix = os.environ.get('BULLMQ_TEST_PREFIX') or "bull"


class TestPriority(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        print("Setting up test queue")
        self.queue_name = f"__test_queue__{uuid4().hex}"

    async def asyncTearDown(self):
        connection = redis.Redis(host='localhost')
        await connection.flushdb()
        await connection.aclose()

    async def test_add_prioritized_jobs_are_returned_in_priority_order(self):
        """Jobs added with priority should be retrievable via getPrioritized()
        ordered by priority (lowest number first = highest priority)."""
        queue = Queue(self.queue_name, {"prefix": prefix})

        job_low = await queue.add("paint", {"color": "blue"}, {"priority": 10})
        job_high = await queue.add("paint", {"color": "red"}, {"priority": 1})
        job_mid = await queue.add("paint", {"color": "green"}, {"priority": 5})

        prioritized = await queue.getPrioritized()

        self.assertEqual(len(prioritized), 3)
        # Highest priority (lowest number) first.
        self.assertEqual(prioritized[0].id, job_high.id)
        self.assertEqual(prioritized[1].id, job_mid.id)
        self.assertEqual(prioritized[2].id, job_low.id)

        # Counts per priority should match.
        counts = await queue.getCountsPerPriority([1, 5, 10])
        self.assertEqual(counts["1"], 1)
        self.assertEqual(counts["5"], 1)
        self.assertEqual(counts["10"], 1)

        await queue.close()

    async def test_priority_is_exposed_on_job_instance(self):
        """Job.priority attribute should reflect the option passed to add()."""
        queue = Queue(self.queue_name, {"prefix": prefix})

        job = await queue.add("paint", {"color": "red"}, {"priority": 3})
        default_job = await queue.add("paint", {"color": "white"}, {})

        self.assertEqual(job.priority, 3)
        self.assertEqual(default_job.priority, 0)

        await queue.close()

    async def test_worker_processes_prioritized_jobs_first(self):
        """Worker should consume highest-priority jobs before lower-priority ones."""
        queue = Queue(self.queue_name, {"prefix": prefix})

        # Add a low priority job, then a high priority one.
        await queue.add("paint", {"color": "blue"}, {"priority": 10})
        await queue.add("paint", {"color": "red"}, {"priority": 1})

        processed_order: list = []
        done = asyncio.get_running_loop().create_future()

        async def processor(job, token):
            processed_order.append(job.data["color"])
            if len(processed_order) == 2:
                done.set_result(True)
            return job.data["color"]

        worker = Worker(self.queue_name, processor, {"prefix": prefix})

        try:
            await asyncio.wait_for(done, timeout=10)
        finally:
            await worker.close()
            await queue.close()

        # Highest priority (red) must be processed first.
        self.assertEqual(processed_order, ["red", "blue"])


if __name__ == '__main__':
    unittest.main()
