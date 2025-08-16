"""
Tests for the queue class.

https://bbc.github.io/cloudfit-public-docs/asyncio/testing.html
"""

from asyncio import Future
import redis.asyncio as redis
from bullmq import Queue, Worker, Job
from uuid import uuid4

import asyncio
import unittest
import os
import time

queueName = f"__test_queue__{uuid4().hex}"
prefix = os.environ.get('BULLMQ_TEST_PREFIX') or "bull"

class TestQueue(unittest.IsolatedAsyncioTestCase):

    async def asyncSetUp(self):
        print("Setting up test queue")
        # Delete test queue
        queue = Queue(queueName, {"prefix": prefix})
        await queue.pause()
        await queue.obliterate()
        await queue.close()

    async def test_connection_str(self):
        queue = Queue(queueName, {"connection": "redis://localhost:6379", "prefix": prefix})

        self.assertIsInstance(queue, Queue)
        await queue.close()

    async def test_add_job(self):
        queue = Queue(queueName, {"prefix": prefix})
        job = await queue.add("test-job", {"foo": "bar"}, {})

        self.assertEqual(job.id, "1")
        await queue.close()

    async def test_get_jobs(self):
        queue = Queue(queueName, {"prefix": prefix})
        job1 = await queue.add("test-job", {"foo": "bar"}, {})
        job2 = await queue.add("test-job", {"foo": "bar"}, {})
        jobs = await queue.getJobs(["wait"])

        self.assertEqual(job2.id, jobs[0].id)
        self.assertEqual(job1.id, jobs[1].id)
        await queue.close()

    async def test_get_job_state(self):
        queue = Queue(queueName, {"prefix": prefix})
        job = await queue.add("test-job", {"foo": "bar"}, {})
        state = await queue.getJobState(job.id)

        self.assertEqual(state, "waiting")
        await queue.close()

    async def test_add_job_with_options(self):
        queue = Queue(queueName, {"prefix": prefix})
        data = {"foo": "bar"}
        attempts = 3
        delay = 1000
        job = await queue.add("test-job", data=data, opts={"attempts": attempts, "delay": delay})

        self.assertEqual(job.id, "1")
        self.assertEqual(job.attempts, attempts)
        self.assertEqual(job.delay, delay)
        self.assertEqual(job.data, data)

        await queue.close()

    async def test_is_paused(self):
        queue = Queue(queueName, {"prefix": prefix})
        await queue.pause()
        isPaused = await queue.isPaused()

        self.assertEqual(isPaused, True)

        await queue.resume()

        isPaused = await queue.isPaused()

        self.assertEqual(isPaused, False)

        await queue.close()

    async def test_is_paused_with_custom_prefix(self):
        custom_prefix = "{" + prefix + "}"
        queue = Queue(queueName, {"prefix": custom_prefix})
        await queue.pause()
        isPaused = await queue.isPaused()

        self.assertEqual(isPaused, True)

        await queue.resume()

        isPaused = await queue.isPaused()

        self.assertEqual(isPaused, False)

        await queue.obliterate()
        await queue.close()

    async def test_trim_events_manually(self):
        queue = Queue(queueName, {"prefix": prefix})
        await queue.add("test", data={}, opts={})
        await queue.add("test", data={}, opts={})
        await queue.add("test", data={}, opts={})
        await queue.add("test", data={}, opts={})

        events_length = await queue.client.xlen(f"{queue.prefix}:{queueName}:events")
        self.assertEqual(events_length, 8)

        await queue.trimEvents(0)

        events_length = await queue.client.xlen(f"{queue.prefix}:{queue.name}:events")

        self.assertEqual(events_length, 0)

        await queue.close()

    async def test_trim_events_manually_with_custom_prefix(self):
        custom_prefix = "{" + prefix + "}"
        queue = Queue(queueName, {"prefix": custom_prefix})
        await queue.add("test", data={}, opts={})
        await queue.add("test", data={}, opts={})
        await queue.add("test", data={}, opts={})
        await queue.add("test", data={}, opts={})

        events_length = await queue.client.xlen(f"{custom_prefix}:{queueName}:events")
        self.assertEqual(events_length, 8)

        await queue.trimEvents(0)

        events_length = await queue.client.xlen(f"{custom_prefix}:{queue.name}:events")

        self.assertEqual(events_length, 0)

        await queue.obliterate()
        await queue.close()

    async def test_get_delayed_count(self):
        queue = Queue(queueName, {"prefix": prefix})
        data = {"foo": "bar"}
        delay = 1000
        await queue.add("test-job", data=data, opts={"delay": delay})
        await queue.add("test-job", data=data, opts={"delay": delay * 2})

        count = await queue.getDelayedCount()
        self.assertEqual(count, 2)

        await queue.close()

    async def test_retry_failed_jobs(self):
        queue = Queue(queueName, {"prefix": prefix})
        job_count = 8

        fail = True

        async def process(job: Job, token: str):
            await asyncio.sleep(1)
            if fail:
                raise Exception("failed")
            return
        order = 0

        worker = Worker(queueName, process, {"prefix": prefix})

        failed_events = Future()

        def failing(job: Job, result):
            nonlocal order
            if order == (job_count - 1):
                failed_events.set_result(None)
            order += 1

        worker.on("failed", failing)

        for index in range(job_count):
            data = {"idx": index}
            await queue.add("test", data=data)

        await failed_events

        worker.off('failed', failing)

        failed_count = await queue.getFailedCount()

        self.assertEqual(failed_count, job_count)

        order = 0

        completed_events = Future()

        def completing(job: Job, result):
            nonlocal order
            if order == (job_count - 1):
                completed_events.set_result(None)
            order += 1

        worker.on("completed", completing)

        fail = False

        await queue.retryJobs({'count': 2})

        await completed_events

        worker.off('completed', completing)

        completed_count = await queue.getJobCounts('completed')
        self.assertEqual(completed_count['completed'], job_count)

        await queue.close()
        await worker.close()

    async def test_retry_completed_jobs(self):
        queue = Queue(queueName, {"prefix": prefix})
        job_count = 8

        async def process(job: Job, token: str):
            await asyncio.sleep(1)
            return
        order = 0

        worker = Worker(queueName, process, {"prefix": prefix})

        completed_events1 = Future()

        def completing1(job: Job, result):
            nonlocal order
            if order == (job_count - 1):
                completed_events1.set_result(None)
            order += 1

        worker.on("completed", completing1)

        for index in range(job_count):
            data = {"idx": index}
            await queue.add("test", data=data)

        await completed_events1

        worker.off('completed', completing1)

        completed_count1 = await queue.getJobCounts('completed')
        self.assertEqual(completed_count1['completed'], job_count)

        order = 0

        completed_events2 = Future()

        def completing2(job: Job, result):
            nonlocal order
            if order == (job_count - 1):
                completed_events2.set_result(None)
            order += 1

        worker.on("completed", completing2)

        await queue.retryJobs({'count': 2, 'state': 'completed'})

        await completed_events2

        worker.off('completed', completing2)

        completed_count2 = await queue.getJobCounts('completed')
        self.assertEqual(completed_count2['completed'], job_count)

        await queue.close()
        await worker.close()

    async def test_retry_failed_jobs_before_timestamp(self):
        queue = Queue(queueName, {"prefix": prefix})
        job_count = 8

        fail = True

        async def process(job: Job, token: str):
            await asyncio.sleep(1)
            if fail:
                raise Exception("failed")
            return
        order = 0

        worker = Worker(queueName, process, {"prefix": prefix})

        failed_events = Future()
        timestamp = 0

        def failing(job: Job, result):
            nonlocal order
            nonlocal timestamp
            if order == (job_count - 1):
                failed_events.set_result(None)
            if job.data['idx'] == (job_count/2 - 1):
                timestamp = round(time.time() * 1000)
            order += 1

        worker.on("failed", failing)

        for index in range(job_count):
            data = {"idx": index}
            await queue.add("test", data=data)

        await failed_events

        worker.off('failed', failing)

        failed_count = await queue.getJobCounts('failed')

        self.assertEqual(failed_count['failed'], 8)

        order = 0

        completed_events = Future()

        def completing(job: Job, result):
            nonlocal order
            if order == (job_count/2 - 1):
                completed_events.set_result(None)
            order += 1

        worker.on("completed", completing)

        fail = False

        await queue.retryJobs({'count': 2, 'timestamp': timestamp})

        await completed_events

        worker.off('completed', completing)

        completed_count = await queue.getCompletedCount()
        self.assertEqual(completed_count, 4)

        await queue.close()
        await worker.close()

    async def test_retry_jobs_when_queue_is_paused(self):
        queue = Queue(queueName, {"prefix": prefix})
        job_count = 8

        fail = True

        async def process(job: Job, token: str):
            await asyncio.sleep(1)
            if fail:
                raise Exception("failed")
            return
        order = 0

        worker = Worker(queueName, process, {"prefix": prefix})

        failed_events = Future()

        def failing(job: Job, result):
            nonlocal order
            if order == (job_count - 1):
                failed_events.set_result(None)
            order += 1

        worker.on("failed", failing)

        for index in range(job_count):
            data = {"idx": index}
            await queue.add("test", data=data)

        await failed_events

        worker.off('failed', failing)

        failed_count = await queue.getJobCounts('failed')

        self.assertEqual(failed_count['failed'], 8)

        order = 0

        fail = False

        await queue.pause()
        await queue.retryJobs({'count': 2})

        paused_count = await queue.getJobCounts('paused')
        self.assertEqual(paused_count['paused'], job_count)

        await queue.close()
        await worker.close()

    async def test_promote_all_delayed_jobs(self):
        queue = Queue(queueName, {"prefix": prefix})
        job_count = 8

        for index in range(job_count):
            data = { "idx": index }
            await queue.add("test", data=data, opts={ "delay": 5000 })

        delayed_count = await queue.getJobCounts('delayed')
        self.assertEqual(delayed_count['delayed'], job_count)

        await queue.promoteJobs()

        waiting_count = await queue.getJobCounts('waiting')
        self.assertEqual(waiting_count['waiting'], job_count)

        async def process(job: Job, token: str):
            await asyncio.sleep(0.1)
            return
        order = 0

        worker = Worker(queueName, process, {"prefix": prefix})

        completed_events = Future()

        def completing(job: Job, result):
            nonlocal order
            if order == (job_count - 1):
                completed_events.set_result(None)
            order += 1

        worker.on("completed", completing)

        await completed_events

        worker.off('completed', completing)

        delayed_count = await queue.getJobCounts('delayed')

        self.assertEqual(delayed_count['delayed'], 0)

        await queue.close()
        await worker.close()

    async def test_remove_job(self):
        queue = Queue(queueName, {"prefix": prefix})
        job = await queue.add("test", {"foo": "bar"}, {})
        await queue.remove(job.id)
        job = await Job.fromId(queue, job.id)
        self.assertIsNone(job)

        await queue.close()

    async def test_get_counts_per_priority(self):
        queue = Queue(queueName, {"prefix": prefix})
        jobs = [{
            "name": "test",
            "data": {},
            "opts": {
                "priority": index % 4
            }
        } for index in range(42)]
        await queue.addBulk(jobs)
        counts = await queue.getCountsPerPriority([0, 1, 2, 3])
        self.assertEqual(counts, {
            "0": 11,
            "1": 11,
            "2": 10,
            "3": 10
        })

        await queue.close()

    async def test_reusable_redis(self):
        conn = redis.Redis(decode_responses=True, host="localhost", port="6379", db=0)
        queue = Queue(queueName, {"connection": conn, "prefix": prefix})
        job = await queue.add("test-job", {"foo": "bar"}, {})

        self.assertEqual(job.id, "1")
        await queue.close()

if __name__ == '__main__':
    unittest.main()
