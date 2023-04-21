"""
Tests for job class.

https://bbc.github.io/cloudfit-public-docs/asyncio/testing.html
"""

import unittest

from bullmq import Queue, Job

queueName = "__bullmq_test_queue__"

class TestJob(unittest.IsolatedAsyncioTestCase):

    async def asyncSetUp(self):
        print("Setting up test queue")
        # Delete test queue
        queue = Queue(queueName)
        await queue.pause()
        await queue.obliterate()
        await queue.close()

    async def test_set_and_get_progress_as_number(self):
        queue = Queue(queueName)
        job = await queue.add("test-job", {"foo": "bar"}, {})
        await job.updateProgress(42)
        stored_job = await Job.fromId(queue, job.id)
        self.assertEqual(stored_job.progress, 42)
        
        await queue.close()

    async def test_set_and_get_progress_as_object(self):
        queue = Queue(queueName)
        job = await queue.add("test-job", {"foo": "bar"}, {})
        await job.updateProgress({"total": 120, "completed": 40})
        stored_job = await Job.fromId(queue, job.id)
        self.assertEqual(stored_job.progress, {"total": 120, "completed": 40})
        
        await queue.close()

if __name__ == '__main__':
    unittest.main()
