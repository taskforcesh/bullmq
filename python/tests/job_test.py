"""
Tests for job class.

https://bbc.github.io/cloudfit-public-docs/asyncio/testing.html
"""

import unittest
import os

from bullmq import Queue, Job
from uuid import uuid4

queueName = f"__test_queue__{uuid4().hex}"
prefix = os.environ.get('BULLMQ_TEST_PREFIX') or "bull"

class TestJob(unittest.IsolatedAsyncioTestCase):

    async def asyncSetUp(self):
        print("Setting up test queue")
        # Delete test queue
        queue = Queue(queueName, {"prefix": prefix})
        await queue.pause()
        await queue.obliterate()
        await queue.close()

    async def test_set_and_get_progress_as_number(self):
        queue = Queue(queueName, {"prefix": prefix})
        job = await queue.add("test-job", {"foo": "bar"}, {})
        await job.updateProgress(42)
        stored_job = await Job.fromId(queue, job.id)
        self.assertEqual(stored_job.progress, 42)

        await queue.close()

    async def test_set_and_get_progress_as_object(self):
        queue = Queue(queueName, {"prefix": prefix})
        job = await queue.add("test-job", {"foo": "bar"}, {})
        await job.updateProgress({"total": 120, "completed": 40})
        stored_job = await Job.fromId(queue, job.id)
        self.assertEqual(stored_job.progress, {"total": 120, "completed": 40})

        await queue.close()

    async def test_get_job_state(self):
        queue = Queue(queueName, {"prefix": prefix})
        job = await queue.add("test-job", {"foo": "bar"}, {})
        state = await job.getState()

        self.assertEqual(state, "waiting")

        await queue.close()

    async def test_job_log(self):
        queue = Queue(queueName, {"prefix": prefix})
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
        queue = Queue(queueName, {"prefix": prefix})
        job = await queue.add("test", {"foo": "bar"}, {})
        await job.updateData({"baz": "qux"})
        stored_job = await Job.fromId(queue, job.id)

        self.assertEqual(stored_job.data, {"baz": "qux"})

        await queue.close()

    async def test_job_data_json_compliant(self):
        queue = Queue(queueName, {"prefix": prefix})
        job = await queue.add("test", {"foo": "bar"}, {})
        with self.assertRaises(ValueError) as error:
            await job.updateData({"baz": float('nan')})

        self.assertEqual(str(error.exception), "Out of range float values are not JSON compliant")

        await queue.close()

    async def test_update_job_data_when_is_removed(self):
        queue = Queue(queueName, {"prefix": prefix})
        job = await queue.add("test", {"foo": "bar"}, {})
        await job.remove()
        with self.assertRaises(TypeError) as error:
            await job.updateData({"baz": "qux"})

        self.assertEqual(str(error.exception), f"Missing key for job {job.id}. updateData")

        await queue.close()

    async def test_promote_delayed_job(self):
        queue = Queue(queueName, {"prefix": prefix})
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

    async def test_when_parent_key_is_missing(self):
        queue = Queue(queueName, {"prefix": prefix})
        parent_id = uuid4().hex
        with self.assertRaises(TypeError) as error:
            await queue.add("test", {"foo": "bar"}, {
                "parent": {
                    "id": parent_id,
                    "queue": f"{prefix}{queueName}"
                }
            })

        self.assertEqual(str(error.exception), f"Missing key for parent job {prefix}{queueName}:{parent_id}. addJob")

        await queue.close()

if __name__ == '__main__':
    unittest.main()
