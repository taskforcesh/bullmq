"""
Tests for delayed jobs.

https://bbc.github.io/cloudfit-public-docs/asyncio/testing.html
"""

import unittest
import time
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

    async def test_progress_delayed_job_only_after_delayed_time(self):
        delay = 1000
        margin = 1.2
        timestamp = round(time.time() * 1000)
        queue = Queue(queueName, {"prefix": prefix})

        async def process(job: Job, token: str):
            return "done"

        worker = Worker(queueName, process, {"prefix": prefix})

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
