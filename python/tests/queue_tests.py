"""
Tests for the queue class.

https://bbc.github.io/cloudfit-public-docs/asyncio/testing.html
"""

import asyncio
import unittest

from bullmq import Queue

queueName = "__bullmq_test_queue__"

class TestQueue(unittest.IsolatedAsyncioTestCase):

    async def asyncSetUp(self):
        print("Setting up test queue")
        # Delete test queue
        queue = Queue(queueName)
        await queue.pause()
        await queue.obliterate()
        await queue.close()

    async def test_add_job(self):
        queue = Queue(queueName)
        job = await queue.add("test-job", {"foo": "bar"}, {})
            
        self.assertEqual(job.id, "1")
        await queue.close()
        
    async def test_add_job_with_options(self):
        queue = Queue(queueName)
        data = {"foo": "bar"}
        attempts = 3,
        delay = 1000
        job = await queue.add("test-job", data=data , opts={"attempts": attempts, "delay": delay})
            
        self.assertEqual(job.id, "1")
        self.assertEqual(job.attempts, attempts)
        self.assertEqual(job.delay, delay)
        self.assertEqual(job.data, data)

        await queue.close()

if __name__ == '__main__':
    unittest.main()
