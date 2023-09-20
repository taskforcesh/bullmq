"""
Tests for add bulk jobs.

https://bbc.github.io/cloudfit-public-docs/asyncio/testing.html
"""

import unittest

from asyncio import Future
from bullmq import Queue, Job, Worker
from uuid import uuid4

queueName = f"__test_queue__{uuid4().hex}"

class TestJob(unittest.IsolatedAsyncioTestCase):

    async def asyncSetUp(self):
        print("Setting up test queue")
        # Delete test queue
        queue = Queue(queueName)
        await queue.pause()
        await queue.obliterate()
        await queue.close()

    async def test_process_jobs(self):
        name = "test"
        queue = Queue(queueName)

        async def process(job: Job, token: str):
            if job.data.get("idx") == 0:
                self.assertEqual(job.data.get("foo"), "bar")
            else:
                self.assertEqual(job.data.get("idx"), 1)
                self.assertEqual(job.data.get("foo"), "baz")
            return "done"

        worker = Worker(queueName, process)

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
