"""
Tests for add bulk jobs.

https://bbc.github.io/cloudfit-public-docs/asyncio/testing.html
"""

import unittest
import os
import redis.asyncio as redis

from asyncio import Future
from bullmq import Queue, Job, Worker
from uuid import uuid4

queueName = ""
prefix = os.environ.get('BULLMQ_TEST_PREFIX') or "bull"

class TestJob(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        print("Setting up test queue")
        queueName = f"__test_queue__{uuid4().hex}"

    async def asyncTearDown(self):
        connection = redis.Redis(host='localhost')
        await connection.flushdb()

    async def test_process_jobs(self):
        name = "test"
        queue = Queue(queueName, {"prefix": prefix})

        async def process(job: Job, token: str):
            if job.data.get("idx") == 0:
                self.assertEqual(job.data.get("foo"), "bar")
            else:
                self.assertEqual(job.data.get("idx"), 1)
                self.assertEqual(job.data.get("foo"), "baz")
            return "done"

        worker = Worker(queueName, process, {"prefix": prefix})

        completed_events = Future()

        job_count = 1

        def completing(job: Job, result):
            nonlocal job_count
            if job_count == 2:
                completed_events.set_result(None)
            job_count += 1

        worker.on("completed", completing)

        jobs = await queue.addBulk(
            [
                {"name": name, "data": {"idx": 0, "foo": "bar"}},
                {"name": name, "data": {"idx": 1, "foo": "baz"}}
            ]
        )
        
        await completed_events

        self.assertEqual(len(jobs), 2)
        
        self.assertIsNotNone(jobs[0].id)
        self.assertEqual(jobs[0].data.get("foo"),"bar")
        self.assertIsNotNone(jobs[1].id)
        self.assertEqual(jobs[1].data.get("foo"),"baz")

        await queue.close()
        await worker.close()

if __name__ == '__main__':
    unittest.main()
