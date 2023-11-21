"""
Tests for delayed jobs.

https://bbc.github.io/cloudfit-public-docs/asyncio/testing.html
"""

import unittest
import time

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

    async def test_progress_delayed_job_only_after_delayed_time(self):
        delay = 1000
        margin = 1.2
        timestamp = round(time.time() * 1000)
        queue = Queue(queueName)

        async def process(job: Job, token: str):
            return "done"

        worker = Worker(queueName, process)

        completed_events = Future()

        def completing(job: Job, result):
            self.assertGreater(round(time.time() * 1000), timestamp + delay)
            self.assertGreaterEqual(job.processedOn - job.timestamp, delay)
            self.assertLess(job.processedOn - job.timestamp, delay * margin,
                'processedOn is not within margin')
            completed_events.set_result(None)

        worker.on("completed", completing)

        job = await queue.add("test", {"delayed": "foobar"}, {"delay": delay})
        
        self.assertEqual(job.opts["delay"], delay)
        
        await completed_events
        await queue.close()
        await worker.close()

if __name__ == '__main__':
    unittest.main()
