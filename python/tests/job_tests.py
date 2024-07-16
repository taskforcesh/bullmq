"""
Tests for job class.

https://bbc.github.io/cloudfit-public-docs/asyncio/testing.html
"""

import unittest

from bullmq import Queue, Job
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

    async def test_get_job_state(self):
        queue = Queue(queueName)
        job = await queue.add("test-job", {"foo": "bar"}, {})
        state = await job.getState()

        self.assertEqual(state, "waiting")

        await queue.close()

    async def test_job_log(self):
        queue = Queue(queueName)
        firstLog = 'some log text 1'
        secondLog = 'some log text 2'
        job = await queue.add("test-job", {"foo": "bar"}, {})
        await job.log(firstLog)
        log_count = await job.log(secondLog)

        self.assertEqual(log_count, 2)

        logs = await queue.getJobLogs(job.id)
        self.assertEqual(logs, {"logs": ["some log text 1", "some log text 2"], "count": 2})
        await queue.close()

    async def test_update_job_data(self):
        queue = Queue(queueName)
        job = await queue.add("test", {"foo": "bar"}, {})
        await job.updateData({"baz": "qux"})
        stored_job = await Job.fromId(queue, job.id)

        self.assertEqual(stored_job.data, {"baz": "qux"})

        await queue.close()

    async def test_update_job_data_when_is_removed(self):
        queue = Queue(queueName)
        job = await queue.add("test", {"foo": "bar"}, {})
        await job.remove()
        with self.assertRaises(TypeError):
            await job.updateData({"baz": "qux"})

        await queue.close()

    async def test_promote_delayed_job(self):
        queue = Queue(queueName)
        job = await queue.add("test", {"foo": "bar"}, {"delay": 1500})
        isDelayed = await job.isDelayed()
        self.assertEqual(isDelayed, True)
        await job.promote()
        self.assertEqual(job.delay, 0)
        isDelayedAfterPromote = await job.isDelayed()
        self.assertEqual(isDelayedAfterPromote, False)
        isWaiting = await job.isWaiting()
        self.assertEqual(isWaiting, True)

        await queue.close()

if __name__ == '__main__':
    unittest.main()
