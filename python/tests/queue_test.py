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

queueName = ""
prefix = os.environ.get('BULLMQ_TEST_PREFIX') or "bull"

class TestQueue(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        print("Setting up test queue")
        queueName = f"__test_queue__{uuid4().hex}"

    async def asyncTearDown(self):
        connection = redis.Redis(host='localhost')
        await connection.flushdb()

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

        waiting_count = await queue.getWaitingCount()

        self.assertEqual(waiting_count, 0)

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

    async def test_obliterate_with_force_false_should_fail_with_active_jobs(self):
        """Test that obliterate without force fails when there are active jobs"""
        queue = Queue(queueName, {"prefix": prefix})
        
        # Add jobs
        await queue.add("test-job", {"foo": "bar"}, {})
        await queue.add("test-job", {"qux": "baz"}, {})
        
        # Create a worker that processes jobs slowly
        async def process(job: Job, token: str):
            await asyncio.sleep(1)
            return "done"
        
        worker = Worker(queueName, process, {"prefix": prefix, "autorun": False})

        active_event = Future()
        worker.on("active", lambda job, result: active_event.set_result(None))

        asyncio.ensure_future(worker.run())

        await active_event
        
        # Try to obliterate without force - should fail
        with self.assertRaises(Exception) as context:
            await queue.obliterate(force=False)
        
        self.assertIn("Cannot obliterate queue with active jobs", str(context.exception))
        
        await worker.close()
        await queue.close()

    async def test_obliterate_with_force_true_should_succeed_with_active_jobs(self):
        """Test that obliterate with force=True succeeds even with active jobs"""
        queue = Queue(queueName, {"prefix": prefix})
        
        # Add jobs
        await queue.add("test-job", {"foo": "bar"}, {})
        await queue.add("test-job", {"qux": "baz"}, {})
        await queue.add("test-job", {"foo": "bar2"}, {})
        
        # Create a worker that processes jobs slowly
        async def process(job: Job, token: str):
            await asyncio.sleep(2)
            return "done"
        
        worker = Worker(queueName, process, {"prefix": prefix, "autorun": False})

        active_event = Future()
        worker.on("active", lambda job, result: active_event.set_result(None))

        asyncio.ensure_future(worker.run())

        await active_event
        
        # Verify there are active jobs
        job_counts = await queue.getJobCounts('active')
        self.assertGreater(job_counts.get('active', 0), 0)
        
        # Obliterate with force=True - should succeed
        await queue.obliterate(force=True)
        
        # Verify all keys are deleted
        keys = await queue.client.keys(f"{prefix}:{queueName}:*")
        self.assertEqual(len(keys), 0)
        
        await worker.close()
        await queue.close()

    async def test_obliterate_with_force_true_parameter_conversion(self):
        """Test that force=True is properly converted to string for Redis"""
        queue = Queue(queueName, {"prefix": prefix})
        
        # Add a few jobs
        await queue.add("test-job", {"foo": "bar"}, {})
        await queue.add("test-job", {"foo": "baz"}, {})
        
        await queue.obliterate(force=True)
        
        await queue.close()

    async def test_drain_count_added_unprocessed_jobs(self):
        """Test drain removes all waiting jobs but leaves infrastructure keys"""
        queue = Queue(queueName, {"prefix": prefix})
        max_jobs = 100
        
        # Add jobs with priorities
        for i in range(1, max_jobs + 1):
            await queue.add("test", {"foo": "bar", "num": i}, {"priority": i})
        
        # Check initial counts
        initial_count = await queue.getJobCountByTypes("waiting", "prioritized")
        self.assertEqual(initial_count, max_jobs)
        
        prioritized_count = await queue.getJobCounts("prioritized")
        self.assertEqual(prioritized_count["prioritized"], max_jobs)
        
        # Drain the queue
        await queue.drain()
        
        # Check that all jobs are removed
        count_after_drain = await queue.getJobCountByTypes("waiting", "prioritized")
        self.assertEqual(count_after_drain, 0)
        
        # Check that infrastructure keys remain
        keys = await queue.client.keys(f"{prefix}:{queueName}:*")
        self.assertEqual(len(keys), 5)
        
        # Verify expected infrastructure keys exist
        key_types = []
        for key in keys:
            key_type = key.split(':')[2]
            key_types.append(key_type)
        
        expected_keys = ['marker', 'events', 'meta', 'pc', 'id']
        for expected_key in expected_keys:
            self.assertIn(expected_key, key_types)
        
        await queue.close()

    async def test_drain_delayed_false(self):
        """Test drain with delayed=False keeps delayed jobs"""
        queue = Queue(queueName, {"prefix": prefix})
        max_jobs = 50
        max_delayed_jobs = 50
        
        # Add regular jobs
        for i in range(1, max_jobs + 1):
            await queue.add("test", {"foo": "bar", "num": i}, {})
        
        # Add delayed jobs
        for i in range(1, max_delayed_jobs + 1):
            await queue.add("test", {"foo": "bar", "num": i}, {"delay": 10000})
        
        # Check initial count
        initial_count = await queue.getJobCountByTypes("waiting", "delayed")
        self.assertEqual(initial_count, max_jobs + max_delayed_jobs)
        
        # Drain without delayed jobs
        await queue.drain(delayed=False)
        
        # Check that only delayed jobs remain
        count_after_drain = await queue.getJobCountByTypes("waiting", "delayed")
        self.assertEqual(count_after_drain, max_delayed_jobs)
        
        await queue.close()

    async def test_drain_delayed_true(self):
        """Test drain with delayed=True removes all jobs including delayed"""
        queue = Queue(queueName, {"prefix": prefix})
        max_jobs = 50
        max_delayed_jobs = 50
        
        # Add regular jobs
        for i in range(1, max_jobs + 1):
            await queue.add("test", {"foo": "bar", "num": i}, {})
        
        # Add delayed jobs
        for i in range(1, max_delayed_jobs + 1):
            await queue.add("test", {"foo": "bar", "num": i}, {"delay": 10000})
        
        # Check initial count
        initial_count = await queue.getJobCountByTypes("waiting", "delayed")
        self.assertEqual(initial_count, max_jobs + max_delayed_jobs)
        
        # Drain including delayed jobs
        await queue.drain(delayed=True)
        
        # Check that all jobs are removed
        count_after_drain = await queue.getJobCountByTypes("waiting", "delayed")
        self.assertEqual(count_after_drain, 0)
        
        await queue.close()

    async def test_drain_paused_queue(self):
        """Test drain removes paused jobs when queue is paused"""
        queue = Queue(queueName, {"prefix": prefix})
        max_jobs = 50
        
        # Pause the queue first
        await queue.pause()
        
        # Add jobs (they will go to paused state)
        for i in range(1, max_jobs + 1):
            await queue.add("test", {"foo": "bar", "num": i}, {})
        
        # Check initial count
        initial_count = await queue.getJobCountByTypes("paused")
        self.assertEqual(initial_count, max_jobs)
        
        paused_counts = await queue.getJobCounts("paused")
        self.assertEqual(paused_counts["paused"], max_jobs)
        
        # Drain the queue
        await queue.drain()
        
        # Check that all jobs are removed
        count_after_drain = await queue.getJobCountByTypes("paused")
        self.assertEqual(count_after_drain, 0)
        
        await queue.close()

    async def test_default_job_options(self):
        """Test that defaultJobOptions are applied to jobs added to the queue"""
        queue_name = f"__test_queue__{uuid4().hex}"
        default_attempts = 5
        default_delay = 2000
        queue = Queue(queue_name, {
            "prefix": prefix,
            "defaultJobOptions": {
                "attempts": default_attempts,
                "delay": default_delay
            }
        })
        
        # Add a job without specifying options
        job1 = await queue.add("test-job", {"foo": "bar"})
        
        # Verify that default options were applied
        self.assertEqual(job1.attempts, default_attempts)
        self.assertEqual(job1.delay, default_delay)
        
        # Add a job with custom options that should override defaults
        custom_attempts = 10
        job2 = await queue.add("test-job", {"foo": "baz"}, {"attempts": custom_attempts})
        
        # Verify that custom options override defaults
        self.assertEqual(job2.attempts, custom_attempts)
        self.assertEqual(job2.delay, default_delay)  # Should still use default delay
        
        await queue.close()

if __name__ == '__main__':
    unittest.main()
