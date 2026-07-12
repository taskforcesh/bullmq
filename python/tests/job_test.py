"""
Tests for job class.

https://bbc.github.io/cloudfit-public-docs/asyncio/testing.html
"""

import unittest
import os
import redis.asyncio as redis

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

        self.assertIn("Out of range float values are not JSON compliant", str(error.exception))

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

    async def test_move_to_delayed_with_fetch_next_returns_next_job_data(self):
        """
        when attempts are given and backoff is non zero,
        fetchNext is true and another job is waiting,
        it returns the next job data after moving the failed job to delayed
        """
        queue = Queue(queueName, {"prefix": prefix})
        worker = Worker(queueName, None, {"prefix": prefix})
        token = 'my-token'

        await queue.add("test", {"foo": "bar"}, {"attempts": 3, "backoff": 300})
        next_job = await queue.add("test2", {"baz": "qux"}, {})

        job = await worker.getNextJob(token)

        result = await job.moveToFailed(
            Exception('test error'), token, True
        )

        is_delayed = await job.isDelayed()
        self.assertTrue(is_delayed)

        # result should contain the next job data: [jobData, jobId, limitUntil, delayUntil]
        self.assertIsNotNone(result)
        self.assertIsInstance(result, list)
        self.assertEqual(result[1], next_job.id)
        self.assertEqual(result[0]["name"], "test2")
        self.assertEqual(result[2], 0)
        self.assertEqual(result[3], 0)

        await worker.close(force=True)
        await queue.close()

    async def test_move_to_delayed_with_fetch_next_no_waiting_job(self):
        """
        when attempts are given and backoff is non zero,
        fetchNext is true and no job is waiting,
        it does not return any job data after moving the failed job to delayed
        """
        queue = Queue(queueName, {"prefix": prefix})
        worker = Worker(queueName, None, {"prefix": prefix})
        token = 'my-token'

        await queue.add("test", {"foo": "bar"}, {"attempts": 3, "backoff": 300})

        job = await worker.getNextJob(token)

        result = await job.moveToFailed(
            Exception('test error'), token, True
        )

        is_delayed = await job.isDelayed()
        self.assertTrue(is_delayed)

        self.assertIsNone(result)

        await worker.close(force=True)
        await queue.close()

    async def test_move_to_delayed_without_fetch_next_does_not_return_job_data(self):
        """
        when attempts are given and backoff is non zero,
        fetchNext is false and another job is waiting,
        it does not return next job data
        """
        queue = Queue(queueName, {"prefix": prefix})
        worker = Worker(queueName, None, {"prefix": prefix})
        token = 'my-token'

        await queue.add("test", {"foo": "bar"}, {"attempts": 3, "backoff": 300})
        await queue.add("test2", {"baz": "qux"}, {})

        job = await worker.getNextJob(token)

        result = await job.moveToFailed(
            Exception('test error'), token, False
        )

        is_delayed = await job.isDelayed()
        self.assertTrue(is_delayed)

        # when fetchNext is false, the result should not contain job data
        self.assertIsNone(result)

        await worker.close(force=True)
        await queue.close()

if __name__ == '__main__':
    unittest.main()
