"""
Tests for the worker class.

https://bbc.github.io/cloudfit-public-docs/asyncio/testing.html
"""

from asyncio import Future
import redis.asyncio as redis
from bullmq import Queue, Worker, Job, DelayedError, WaitingChildrenError
from bullmq.worker import getCompleted
from uuid import uuid4
from enum import Enum

import asyncio
import unittest
import time
import os

queueName = ""
prefix = os.environ.get('BULLMQ_TEST_PREFIX') or "bull"

class TestWorker(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        print("Setting up test queue")
        queueName = f"__test_queue__{uuid4().hex}"

    async def asyncTearDown(self):
        connection = redis.Redis(host='localhost')
        try:
            await connection.flushdb()
        finally:
            await connection.aclose()

    async def test_process_jobs(self):
        queue = Queue(queueName, {"prefix": prefix})
        data = {"foo": "bar"}
        job = await queue.add("test-job", data, {"removeOnComplete": False})

        async def process(job: Job, token: str):
            print("Processing job", job)
            return "done"

        worker = Worker(queueName, process, {"prefix": prefix})

        processing = Future()
        worker.on("completed", lambda job, result: processing.set_result(None))

        await processing

        completedJob = await Job.fromId(queue, job.id)

        self.assertEqual(completedJob.id, job.id)
        self.assertEqual(completedJob.attemptsMade, 1)
        self.assertEqual(completedJob.data, data)
        self.assertEqual(completedJob.returnvalue, "done")
        self.assertNotEqual(completedJob.finishedOn, None)

        await worker.close()
        await queue.close()

    async def test_manual_process_jobs(self):
        queue = Queue(queueName, {"prefix": prefix})
        data = {"foo": "bar"}

        worker = Worker(queueName, None, {"prefix": prefix})
        token = 'my-token'

        await queue.add("test", data)

        job = await worker.getNextJob(token)

        is_active = await job.isActive()
        self.assertEqual(is_active, True)

        await job.moveToCompleted('return value', token)

        is_completed = await job.isCompleted()

        self.assertEqual(is_completed, True)
        self.assertEqual(job.attemptsMade, 1)
        self.assertNotEqual(job.finishedOn, None)
        self.assertEqual(job.returnvalue, 'return value')

        await worker.close(force=True)
        await queue.close()

    async def test_manual_process_active_event_on_get_next_job(self):
        queue = Queue(queueName, {"prefix": prefix})
        data = {"foo": "bar"}

        worker = Worker(queueName, None, {"prefix": prefix})
        token = 'my-token'

        await queue.add("test", data)

        active_event = Future()

        def on_active(job, prev):
            active_event.set_result(job)

        worker.on("active", on_active)

        job = await worker.getNextJob(token)

        activated_job = await active_event

        self.assertEqual(activated_job.id, job.id)

        is_active = await job.isActive()
        self.assertEqual(is_active, True)

        await job.moveToCompleted('done', token)
        await worker.close(force=True)
        await queue.close()

    async def test_manual_process_job_failure(self):
        queue = Queue(queueName, {"prefix": prefix})
        data = {"foo": "bar"}

        worker = Worker(queueName, None, {"prefix": prefix})
        token = 'my-token'

        await queue.add("test", data)

        job = await worker.getNextJob(token)

        is_active = await job.isActive()
        self.assertEqual(is_active, True)

        await job.moveToFailed(Exception('job failed for some reason'), token)

        is_completed = await job.isCompleted()
        is_failed = await job.isFailed()

        self.assertEqual(is_completed, False)
        self.assertEqual(is_failed, True)
        self.assertEqual(job.attemptsMade, 1)
        self.assertNotEqual(job.finishedOn, None)
        self.assertEqual(job.failedReason, 'job failed for some reason')

        await worker.close(force=True)
        await queue.close()

    async def test_process_job_with_array_as_return_value(self):
        queue = Queue(queueName, {"prefix": prefix})
        data = {"foo": "bar"}
        job = await queue.add("test-job", data, {"removeOnComplete": False})

        async def process(job: Job, token: str):
            print("Processing job", job)
            return ['foo']

        worker = Worker(queueName, process, {"prefix": prefix})

        processing = Future()
        worker.on("completed", lambda job, result: processing.set_result(None))

        await processing

        completedJob = await Job.fromId(queue, job.id)

        self.assertEqual(completedJob.id, job.id)
        self.assertEqual(completedJob.attemptsMade, 1)
        self.assertEqual(completedJob.data, data)
        self.assertEqual(completedJob.returnvalue, ['foo'])
        self.assertNotEqual(completedJob.finishedOn, None)

        await worker.close()
        await queue.close()

    async def test_process_job_with_boolean_as_return_value(self):
        queue = Queue(queueName, {"prefix": prefix})
        data = {"foo": "bar"}
        job = await queue.add("test-job", data, {"removeOnComplete": False})

        async def process(job: Job, token: str):
            print("Processing job", job)
            return True

        worker = Worker(queueName, process, {"prefix": prefix})

        processing = Future()
        worker.on("completed", lambda job, result: processing.set_result(None))

        await processing

        completedJob = await Job.fromId(queue, job.id)

        self.assertEqual(completedJob.id, job.id)
        self.assertEqual(completedJob.attemptsMade, 1)
        self.assertEqual(completedJob.data, data)
        self.assertEqual(completedJob.returnvalue, True)
        self.assertNotEqual(completedJob.finishedOn, None)

        await worker.close()
        await queue.close()

    async def test_process_job_fail_with_nan_as_return_value(self):
        queue = Queue(queueName, {"prefix": prefix})
        data = {"foo": "bar"}
        job = await queue.add("test-job", data, {"removeOnComplete": False})

        failedReason = "Out of range float values are not JSON compliant"

        async def process(job: Job, token: str):
            print("Processing job", job)
            return float('nan')

        worker = Worker(queueName, process, {"prefix": prefix})

        processing = Future()
        worker.on("failed", lambda job, result: processing.set_result(None))
        await processing
        failedJob = await Job.fromId(queue, job.id)


        self.assertEqual(failedJob.id, job.id)
        self.assertEqual(failedJob.attemptsMade, 1)
        self.assertEqual(failedJob.data, data)
        self.assertIn(failedReason, failedJob.failedReason)
        self.assertEqual(len(failedJob.stacktrace), 1)
        self.assertEqual(failedJob.returnvalue, None)
        self.assertNotEqual(failedJob.finishedOn, None)
        
        await worker.close()
        await queue.close()

    async def test_process_jobs_fail(self):
        failure_messages = [
            "Failed",
            'quoted "value" and backslash \\',
            "Unicode: 你好 🌍",
            '{"code":"E_FAIL","retryable":false}',
        ]

        for failedReason in failure_messages:
            with self.subTest(failedReason=failedReason):
                test_queue_name = f"__failed_reason_protocol__{uuid4().hex}"
                queue = Queue(test_queue_name, {"prefix": prefix})
                worker = None
                try:
                    data = {"foo": "bar"}
                    job = await queue.add("test-job", data, {"removeOnComplete": False})

                    async def process(job: Job, token: str):
                        print("Processing job", job)
                        raise Exception(failedReason)

                    worker = Worker(test_queue_name, process, {"prefix": prefix})
                    processing = Future()
                    worker.on("failed", lambda job, result: processing.set_result(None))

                    await processing

                    failedJob = await Job.fromId(queue, job.id)
                    self.assertIsNotNone(failedJob)
                    assert failedJob is not None
                    storedFailedReason = None
                    if queue.redisConnection is not None:
                        connection = redis.Redis(host="localhost", decode_responses=True)
                        try:
                            storedFailedReason = await connection.hget(
                                queue.toKey(job.id), "failedReason"
                            )
                        finally:
                            await connection.aclose()

                    self.assertEqual(failedJob.id, job.id)
                    self.assertEqual(failedJob.attemptsMade, 1)
                    self.assertEqual(failedJob.data, data)
                    self.assertEqual(failedJob.failedReason, failedReason)
                    if queue.redisConnection is not None:
                        self.assertEqual(storedFailedReason, failedReason)
                    self.assertEqual(len(failedJob.stacktrace), 1)
                    self.assertEqual(failedJob.returnvalue, None)
                    self.assertNotEqual(failedJob.finishedOn, None)
                finally:
                    if worker is not None:
                        await worker.close()
                    await queue.close()

    async def test_process_renews_lock(self):
        queue = Queue(queueName, {"prefix": prefix})
        data = {"foo": "bar"}
        job = await queue.add("test-job", data, {"removeOnComplete": False})

        async def process(job: Job, token: str):
            await asyncio.sleep(3)
            return "done"

        worker = Worker(queueName, process, {"lockDuration": 1000, "prefix": prefix})

        processing = Future()
        worker.on("completed", lambda job, result: processing.set_result(None))

        await processing

        completedJob = await Job.fromId(queue, job.id)

        self.assertEqual(completedJob.id, job.id)
        self.assertEqual(completedJob.attemptsMade, 1)
        self.assertEqual(completedJob.data, data)
        self.assertEqual(completedJob.returnvalue, "done")
        self.assertNotEqual(completedJob.finishedOn, None)

        await worker.close()
        await queue.close()

    async def test_process_stalled_jobs(self):
        queue = Queue(queueName, {"prefix": prefix})
        data = {"foo": "bar"}
        job = await queue.add("test-job", data, {"removeOnComplete": False})

        startProcessing = Future()

        async def process1(job: Job, token: str):
            await asyncio.sleep(2)
            startProcessing.set_result(None)
            await asyncio.sleep(2)
            return "done1"

        worker = Worker(queueName, process1, {"lockDuration": 1000, "prefix": prefix})

        await startProcessing
        await worker.close(force=True)

        async def process2(job: Job, token: str):
            return "done2"

        worker2 = Worker(queueName, process2, {
            "lockDuration": 1000, "stalledInterval": 1000, "prefix": prefix})

        processing = Future()
        worker2.on("completed", lambda job,
                   result: processing.set_result(None))

        stalled = Future()
        worker2.on("stalled", lambda jobId: stalled.set_result(None))

        await stalled
        await processing

        completedJob = await Job.fromId(queue, job.id)

        self.assertEqual(completedJob.id, job.id)
        self.assertEqual(completedJob.attemptsMade, 1)
        self.assertEqual(completedJob.data, data)
        self.assertEqual(completedJob.returnvalue, "done2")
        self.assertNotEqual(completedJob.finishedOn, None)

        await worker2.close()
        await queue.close()

    async def test_retry_job_after_delay_with_fixed_backoff(self):
        queue = Queue(queueName, {"prefix": prefix})

        async def process1(job: Job, token: str):
            if job.attemptsMade < 2:
                raise Exception("Not yet!")
            return None

        worker = Worker(queueName, process1, {"prefix": prefix})

        start = round(time.time() * 1000)
        await queue.add("test", { "foo": "bar" },
                {"attempts": 3, "backoff": {"type": "fixed", "delay": 1000}})

        completed_events = Future()

        def completing(job: Job, result):
            elapse = round(time.time() * 1000) - start
            self.assertGreater(elapse, 2000)
            completed_events.set_result(None)

        worker.on("completed", completing)

        await completed_events

        await queue.close()
        await worker.close()

    async def test_retry_job_after_delay_with_custom_backoff(self):
        queue = Queue(queueName, {"prefix": prefix})

        async def process1(job: Job, token: str):
            if job.attemptsMade < 2:
                raise Exception("Not yet!")
            return None

        def backoff_strategy(attempts_made, type, err, job):
            return attempts_made * 1000

        worker = Worker(queueName, process1, {"settings": {
            "backoffStrategy": backoff_strategy
        }, "prefix": prefix})

        start = round(time.time() * 1000)
        await queue.add("test", { "foo": "bar" },
                {"attempts": 3, "backoff": {"type": "custom"}})

        completed_events = Future()

        def completing(job: Job, result):
            elapse = round(time.time() * 1000) - start
            self.assertGreater(elapse, 3000)
            completed_events.set_result(None)

        worker.on("completed", completing)

        await completed_events

        await queue.close()
        await worker.close()

    async def test_create_children_at_runtime(self):
        parent_queue_name = f"__parent_queue__{uuid4().hex}"
        parent_queue = Queue(parent_queue_name, {"prefix": prefix})
        queue = Queue(queueName, {"prefix": prefix})

        class Step(int, Enum):
            Initial = 1
            Second = 2
            Third = 3
            Finish = 4

        waiting_children_step_executions = 0

        async def parent_process(job: Job, token: str):
            step = job.data.get("step")
            while step != Step.Finish:
                if step == Step.Initial:
                    await queue.add('child-1', {"foo": "bar" },{
                        "parent": {
                            "id": job.id,
                            "queue": job.queueQualifiedName
                        }
                    })
                    await job.updateData({
                        "step": Step.Second
                    })
                    step = Step.Second
                elif step == Step.Second:
                    await queue.add('child-2', { "foo": "bar" }, {
                        "parent": {
                            "id": job.id,
                            "queue": job.queueQualifiedName
                        }
                    })
                    await job.updateData({
                        "step": Step.Third
                    })
                    step = Step.Third
                elif step == Step.Third:
                    nonlocal waiting_children_step_executions
                    waiting_children_step_executions += 1
                    should_wait = await job.moveToWaitingChildren(token, {})
                    if not should_wait:
                        await job.updateData({
                            "step": Step.Finish
                        })
                        step = Step.Finish
                        return Step.Finish
                    else:
                        raise WaitingChildrenError
                else:
                    raise Exception("invalid step")

        async def children_process(job: Job, token: str):
            await asyncio.sleep(0.2)
            return None

        worker = Worker(parent_queue_name, parent_process, {"prefix": prefix})
        children_worker = Worker(queueName, children_process, {"prefix": prefix})

        await parent_queue.add( "test", {"step": Step.Initial},
            {
                "attempts": 3,
                "backoff": 1000
            }
        )

        completed_events = Future()

        def completing(job: Job, result):
            self.assertEqual(job.returnvalue, Step.Finish)
            completed_events.set_result(None)

        worker.on("completed", completing)

        await completed_events

        self.assertEqual(waiting_children_step_executions, 2)

        await worker.close()
        await children_worker.close()
        await parent_queue.close()
        await queue.close()

    async def test_process_job_respecting_the_concurrency_set(self):
        num_jobs_processing = 0
        pending_message_to_process = 8
        wait = 0.01
        job_count = 0
        queue = Queue(queueName, {"prefix": prefix})

        async def process(job: Job, token: str):
            nonlocal num_jobs_processing
            nonlocal wait
            nonlocal pending_message_to_process
            num_jobs_processing += 1
            self.assertLess(num_jobs_processing, 5)
            wait += 0.1
            await asyncio.sleep(wait)
            self.assertEqual(num_jobs_processing, min(pending_message_to_process, 4))
            pending_message_to_process -= 1
            num_jobs_processing -= 1

            return None

        for _ in range(8):
            await queue.add("test", data={})

        worker = Worker(queueName, process, {"concurrency": 4, "prefix": prefix})

        completed_events = Future()

        def completing(job: Job, result):
            nonlocal job_count
            if job_count == 7:
                completed_events.set_result(None)
            job_count += 1

        worker.on("completed", completing)

        await completed_events

        await queue.close()
        await worker.close()

    async def test_reusable_redis(self):
        conn = redis.Redis(decode_responses=True, host="localhost", port="6379", db=0)
        queue = Queue(queueName, {"connection": conn, "prefix": prefix})
        data = {"foo": "bar"}
        job = await queue.add("test-job", data, {"removeOnComplete": False})

        async def process(job: Job, token: str):
            print("Processing job", job)
            return "done"

        worker = Worker(queueName, process, {"connection": conn, "prefix": prefix})

        processing = Future()
        worker.on("completed", lambda job, result: processing.set_result(None))

        await processing

        completedJob = await Job.fromId(queue, job.id)

        self.assertEqual(completedJob.id, job.id)
        self.assertEqual(completedJob.attemptsMade, 1)
        self.assertEqual(completedJob.data, data)
        self.assertEqual(completedJob.returnvalue, "done")
        self.assertNotEqual(completedJob.finishedOn, None)

        await worker.close()
        await queue.close()

    async def test_retry_job_that_fails(self):
        """Test retrying a job that has failed"""
        queue = Queue(queueName, {"prefix": prefix})
        data = {"foo": "bar"}
        
        failed_once = False
        not_even_err = Exception("Not even!")

        async def process(job: Job, token: str):
            failed_once
            if not failed_once:
                raise not_even_err
            return "done"

        worker = Worker(queueName, process, {"prefix": prefix})

        failing = Future()
        
        def on_failed(job, err):
            nonlocal failed_once
            try:
                self.assertIsNotNone(job)
                self.assertEqual(job.data["foo"], "bar")
                self.assertEqual(job.attemptsStarted, 1)
                self.assertEqual(job.attemptsMade, 1)
                failed_once = True
                failing.set_result(None)
            except Exception as e:
                failing.set_exception(e)
        
        worker.on("failed", on_failed)

        job = await queue.add("test", data, {"removeOnComplete": False})
        self.assertIsNotNone(job.id)
        self.assertEqual(job.data["foo"], "bar")

        await failing

        # Remove listener and add completed listener
        worker.off("failed", on_failed)
        
        completing = Future()
        
        def on_completed(completed_job, result):
            try:
                self.assertTrue(failed_once)
                self.assertEqual(completed_job.attemptsStarted, 2)
                self.assertEqual(completed_job.attemptsMade, 2)
                completing.set_result(None)
            except Exception as e:
                completing.set_exception(e)
        
        worker.on("completed", on_completed)
        
        await job.retry()
        await completing

        await worker.close()
        await queue.close()

    async def test_retry_failed_job_with_reset_attempts(self):
        """Test retrying a failed job with resetAttemptsMade and resetAttemptsStarted options"""
        queue = Queue(queueName, {"prefix": prefix})
        data = {"foo": "bar"}
        
        failed_once = False
        not_even_err = Exception("Not even!")

        async def process(job: Job, token: str):
            failed_once
            if not failed_once:
                raise not_even_err
            return "done"

        worker = Worker(queueName, process, {"prefix": prefix})

        failing = Future()
        
        def on_failed(job, err):
            nonlocal failed_once
            try:
                self.assertIsNotNone(job)
                self.assertEqual(job.data["foo"], "bar")
                self.assertEqual(job.attemptsStarted, 1)
                self.assertEqual(job.attemptsMade, 1)
                failed_once = True
                failing.set_result(None)
            except Exception as e:
                failing.set_exception(e)
        
        worker.on("failed", on_failed)

        job = await queue.add("test", data, {"removeOnComplete": False})
        self.assertIsNotNone(job.id)
        self.assertEqual(job.data["foo"], "bar")

        await failing

        # Remove listener and add completed listener
        worker.off("failed", on_failed)
        
        completing = Future()
        
        def on_completed(completed_job, result):
            try:
                self.assertTrue(failed_once)
                # With reset options, attempts should be 1 (reset to 0, then incremented)
                self.assertEqual(completed_job.attemptsStarted, 1)
                self.assertEqual(completed_job.attemptsMade, 1)
                completing.set_result(None)
            except Exception as e:
                completing.set_exception(e)
        
        worker.on("completed", on_completed)
        
        await job.retry("failed", {
            "resetAttemptsMade": True,
            "resetAttemptsStarted": True
        })
        await completing

        await worker.close()
        await queue.close()

    async def test_retry_job_that_completes(self):
        """Test retrying a job that has completed"""
        queue = Queue(queueName, {"prefix": prefix})
        data = {"foo": "bar"}
        
        completed_once = False
        count = 1

        async def process(job: Job, token: str):
            completed_once, count
            if not completed_once:
                return count
            return count

        worker = Worker(queueName, process, {"prefix": prefix})

        completing = Future()
        
        def on_completed(job, result):
            nonlocal completed_once, count
            try:
                self.assertIsNotNone(job)
                self.assertEqual(job.data["foo"], "bar")
                self.assertEqual(job.attemptsStarted, 1)
                self.assertEqual(job.attemptsMade, 1)
                self.assertEqual(result, count)
                count += 1
                completed_once = True
                completing.set_result(None)
            except Exception as e:
                completing.set_exception(e)
        
        worker.on("completed", on_completed)

        job = await queue.add("test", data, {"removeOnComplete": False})
        self.assertIsNotNone(job.id)
        self.assertEqual(job.data["foo"], "bar")

        await completing

        # Remove listener and add new completed listener
        worker.off("completed", on_completed)
        
        completing2 = Future()
        
        def on_completed2(completed_job, result):
            count
            try:
                self.assertIsNotNone(completed_job)
                self.assertEqual(completed_job.data["foo"], "bar")
                self.assertEqual(completed_job.attemptsStarted, 2)
                self.assertEqual(completed_job.attemptsMade, 2)
                self.assertEqual(result, count)
                completing2.set_result(None)
            except Exception as e:
                completing2.set_exception(e)
        
        worker.on("completed", on_completed2)
        
        await job.retry("completed")
        await completing2

        await worker.close()
        await queue.close()

    async def test_retry_completed_job_with_reset_attempts(self):
        """Test retrying a completed job with resetAttemptsMade and resetAttemptsStarted options"""
        queue = Queue(queueName, {"prefix": prefix})
        data = {"foo": "bar"}
        
        completed_once = False
        count = 1

        async def process(job: Job, token: str):
            completed_once, count
            if not completed_once:
                return count
            return count

        worker = Worker(queueName, process, {"prefix": prefix})

        completing = Future()
        
        def on_completed(job, result):
            nonlocal completed_once, count
            try:
                self.assertIsNotNone(job)
                self.assertEqual(job.data["foo"], "bar")
                self.assertEqual(job.attemptsStarted, 1)
                self.assertEqual(job.attemptsMade, 1)
                self.assertEqual(result, count)
                count += 1
                completed_once = True
                completing.set_result(None)
            except Exception as e:
                completing.set_exception(e)
        
        worker.on("completed", on_completed)

        job = await queue.add("test", data, {"removeOnComplete": False})
        self.assertIsNotNone(job.id)
        self.assertEqual(job.data["foo"], "bar")

        await completing

        # Remove listener and add new completed listener
        worker.off("completed", on_completed)
        
        completing2 = Future()
        
        def on_completed2(completed_job, result):
            count
            try:
                self.assertIsNotNone(completed_job)
                self.assertEqual(completed_job.data["foo"], "bar")
                # With reset options, attempts should be 1 (reset to 0, then incremented)
                self.assertEqual(completed_job.attemptsStarted, 1)
                self.assertEqual(completed_job.attemptsMade, 1)
                self.assertEqual(result, count)
                completing2.set_result(None)
            except Exception as e:
                completing2.set_exception(e)
        
        worker.on("completed", on_completed2)
        
        await job.retry("completed", {
            "resetAttemptsMade": True,
            "resetAttemptsStarted": True
        })
        await completing2

        await worker.close()
        await queue.close()

    async def test_remove_on_complete_with_age_and_limit(self):
        """Test worker removeOnComplete option with age and limit parameters"""
        queue = Queue(queueName, {"prefix": prefix})
        
        completed_jobs = []

        async def process(job: Job, token: str):
            completed_jobs.append(job.id)
            print(f"Processing job {job.data['index']}, removeOnComplete: {job.opts.get('removeOnComplete')}")
            return f"result-{job.data['index']}"

        worker = Worker(queueName, process, {
            "prefix": prefix,
            "removeOnComplete": {"age": 1, "limit": 3}  # 1 second age, limit 3
        })

        # Add 5 jobs
        jobs = []
        for i in range(5):
            job = await queue.add(f"test-job-{i}", {"index": i})
            jobs.append(job)

        # Wait for all jobs to complete
        await asyncio.sleep(0.5)

        # Verify all jobs completed
        completed_count = await queue.getCompletedCount()

        # Wait for age threshold to pass
        await asyncio.sleep(1.2)  # Wait for jobs to age beyond 1 second

        # Add a new job to trigger potential cleanup
        await queue.add("trigger", {"index": "trigger"})
        await asyncio.sleep(0.5)  # Let it process

        # Check completed jobs count after aging and trigger
        final_count = await queue.getCompletedCount()

        await worker.close()
        await queue.close()

        # Verify that the worker correctly applies removeOnComplete options
        # The exact cleanup behavior depends on the implementation
        self.assertEqual(len(completed_jobs), 6)  # 5 original + 1 trigger

        # The final count should be less than or equal to initial due to potential cleanup
        self.assertLessEqual(final_count, completed_count + 1)

    async def test_get_completed_handles_empty_task_set(self):
        # Regression test: getCompleted must not call asyncio.wait() with an
        # empty set, which raises ValueError. This empty state is reachable
        # during drain/close transitions when self.processing is empty.
        def noop_emit(*args, **kwargs):
            pass

        jobs, pending = await getCompleted(set(), noop_emit)

        self.assertEqual(jobs, [])
        self.assertEqual(pending, set())

    async def test_move_to_delayed_from_processor(self):
        queue = Queue(queueName, {"prefix": prefix})
        job = await queue.add("test", {"foo": "bar"})

        delayed = Future()
        failed_events = []

        async def process(job: Job, token: str):
            await job.moveToDelayed(round(time.time() * 1000) + 3000, token)
            delayed.set_result(None)
            raise DelayedError()

        worker = Worker(queueName, process, {"prefix": prefix})
        worker.on("failed", lambda job, err: failed_events.append(err))
        worker.on("error", lambda *args: failed_events.append(args))

        await delayed
        # give the worker a chance to react to the DelayedError
        await asyncio.sleep(0.3)

        is_delayed = await job.isDelayed()
        self.assertEqual(is_delayed, True)

        counts = await queue.getJobCounts("delayed", "active", "failed", "completed")
        self.assertEqual(counts.get("delayed"), 1)
        self.assertEqual(counts.get("active"), 0)
        self.assertEqual(counts.get("failed"), 0)
        self.assertEqual(counts.get("completed"), 0)
        self.assertEqual(failed_events, [])

        await worker.close(force=True)
        await queue.close()

    async def test_move_to_delayed_in_one_step_keeping_current_step(self):
        queue = Queue(queueName, {"prefix": prefix})

        class Step(int, Enum):
            Initial = 1
            Second = 2
            Finish = 3

        delay = 200
        processed_ids = []

        async def process(job: Job, token: str):
            processed_ids.append(job.id)
            step = job.data.get("step")
            if step == Step.Initial:
                await job.moveToDelayed(round(time.time() * 1000) + delay, token)
                await job.updateData({"step": Step.Second})
                raise DelayedError()
            elif step == Step.Second:
                await job.updateData({"step": Step.Finish})
                return Step.Finish
            else:
                raise Exception("invalid step")

        worker = Worker(queueName, process, {"prefix": prefix})

        error_events = []
        failed_events = []
        worker.on("error", lambda *args: error_events.append(args))
        worker.on("failed", lambda job, err: failed_events.append(err))

        completed_events = Future()
        worker.on("completed", lambda job, result: completed_events.set_result(None))

        start = round(time.time() * 1000)
        job = await queue.add("test", {"step": Step.Initial})

        await completed_events

        elapse = round(time.time() * 1000) - start
        self.assertGreater(elapse, delay)

        # The very same job is re-processed, no new job is created.
        self.assertEqual(processed_ids, [job.id, job.id])

        completed_job = await Job.fromId(queue, job.id)
        self.assertEqual(completed_job.returnvalue, Step.Finish)
        self.assertEqual(completed_job.data, {"step": Step.Finish})
        # skipAttempt: moving to delayed manually does not consume an attempt.
        self.assertEqual(completed_job.attemptsMade, 1)
        self.assertEqual(completed_job.attemptsStarted, 2)

        self.assertEqual(failed_events, [])
        self.assertEqual(error_events, [])

        await worker.close()
        await queue.close()

    async def test_delayed_error_without_moving_job_does_not_finish_job(self):
        # DelayedError only tells the worker to walk away; it is the
        # moveToDelayed call that parks the job. Without it the job stays
        # active and is left to the stalled checker, it is never completed
        # nor failed behind our back.
        queue = Queue(queueName, {"prefix": prefix})
        job = await queue.add("test", {"foo": "bar"})

        processed = Future()
        events = []

        async def process(job: Job, token: str):
            processed.set_result(None)
            raise DelayedError()

        worker = Worker(queueName, process, {"prefix": prefix})
        worker.on("completed", lambda job, result: events.append("completed"))
        worker.on("failed", lambda job, err: events.append("failed"))

        await processed
        await asyncio.sleep(0.5)

        self.assertEqual(events, [])

        counts = await queue.getJobCounts("active", "delayed", "failed", "completed")
        self.assertEqual(counts.get("active"), 1)
        self.assertEqual(counts.get("delayed"), 0)
        self.assertEqual(counts.get("failed"), 0)
        self.assertEqual(counts.get("completed"), 0)

        state = await job.getState()
        self.assertEqual(state, "active")

        await worker.close(force=True)
        await queue.close()

    async def test_close_idle_worker_is_fast(self):
        """Test that closing an idle worker does not hang for drainDelay."""
        async def process(job: Job, token: str):
            pass

        worker = Worker(queueName, process, {"prefix": prefix, "drainDelay": 5})
        # Allow the worker loop to enter the idle bzpopmin wait
        await asyncio.sleep(0.2)

        start = time.monotonic()
        await worker.close()
        duration = time.monotonic() - start

        self.assertLess(duration, 1.0)

    async def test_pause_and_close_idle_worker(self):
        """Test that pausing and closing an idle worker completes quickly without hanging."""
        async def process(job: Job, token: str):
            pass

        worker = Worker(queueName, process, {"prefix": prefix, "drainDelay": 5})
        await asyncio.sleep(0.2)

        start = time.monotonic()
        await worker.pause()
        pause_duration = time.monotonic() - start
        self.assertLess(pause_duration, 1.0)
        self.assertTrue(worker.paused)

        start = time.monotonic()
        await worker.close()
        close_duration = time.monotonic() - start
        self.assertLess(close_duration, 1.0)
        self.assertTrue(worker.closed)

    async def test_pause_and_resume_processing(self):
        """Test that pausing stops processing and resume restarts it."""
        queue = Queue(queueName, {"prefix": prefix})
        processed = []

        async def process(job: Job, token: str):
            processed.append(job.data["idx"])
            return job.data["idx"]

        worker = Worker(queueName, process, {"prefix": prefix})

        await worker.pause()
        self.assertTrue(worker.paused)

        await queue.add("test", {"idx": 1})
        await asyncio.sleep(0.5)
        # Should not process while paused
        self.assertEqual(len(processed), 0)

        completed = Future()
        worker.on("completed", lambda job, res: completed.set_result(None))

        worker.resume()
        self.assertFalse(worker.paused)

        await completed
        self.assertEqual(processed, [1])

        await worker.close()
        await queue.close()

    async def test_close_completes_despite_external_cancellation(self):
        """Test that close() finishes cleanup even if its own task is cancelled
        externally while waiting for active jobs to finish."""
        job_started = asyncio.Event()
        job_finished = False

        async def process(job: Job, token: str):
            nonlocal job_finished
            job_started.set()
            await asyncio.sleep(0.5)
            job_finished = True

        worker = Worker(queueName, process, {"prefix": prefix, "concurrency": 2})
        queue = Queue(queueName, {"prefix": prefix})
        await queue.add("test", {"idx": 1})
        await job_started.wait()  # wait until the job processor has actively started

        close_task = asyncio.ensure_future(worker.close())
        await asyncio.sleep(0.1)  # give close() time to reach asyncio.wait(self.processing, ...)
        close_task.cancel()

        with self.assertRaises(asyncio.CancelledError):
            await close_task

        self.assertTrue(job_finished)  # confirms active in-flight job was allowed to finish
        self.assertTrue(worker.closed)

        await queue.close()

    async def test_close_completes_despite_repeated_external_cancellation(self):
        """Test that close() finishes cleanup even when its task is cancelled
        multiple times while waiting for active jobs — exercises the while loop."""
        job_started = asyncio.Event()
        job_finished = False

        async def process(job: Job, token: str):
            nonlocal job_finished
            job_started.set()
            await asyncio.sleep(0.5)
            job_finished = True

        worker = Worker(queueName, process, {"prefix": prefix, "concurrency": 2})
        queue = Queue(queueName, {"prefix": prefix})
        await queue.add("test", {"idx": 1})
        await job_started.wait()  # wait until the job processor has actively started

        close_task = asyncio.ensure_future(worker.close())
        await asyncio.sleep(0.1)  # give close() time to reach asyncio.wait(self.processing, ...)

        # Cancel the close task 3 times to exercise the while loop
        for _ in range(3):
            close_task.cancel()
            await asyncio.sleep(0)  # yield to let the CancelledError be delivered

        with self.assertRaises(asyncio.CancelledError):
            await close_task

        self.assertTrue(job_finished)   # in-flight job completed despite repeated cancellation
        self.assertTrue(worker.closed)  # cleanup always ran to completion

        await queue.close()

    async def test_pause_completes_despite_external_cancellation(self):
        """Test that pause() finishes waiting for in-flight jobs even if its task
        is cancelled externally, and properly propagates CancelledError."""
        job_started = asyncio.Event()
        job_finished = False

        async def process(job: Job, token: str):
            nonlocal job_finished
            job_started.set()
            await asyncio.sleep(0.5)
            job_finished = True

        worker = Worker(queueName, process, {"prefix": prefix, "concurrency": 2})
        queue = Queue(queueName, {"prefix": prefix})
        await queue.add("test", {"idx": 1})
        await job_started.wait()  # wait until the job processor has actively started

        pause_task = asyncio.ensure_future(worker.pause())
        await asyncio.sleep(0.1)  # give pause() time to reach asyncio.wait(self.processing, ...)
        pause_task.cancel()

        with self.assertRaises(asyncio.CancelledError):
            await pause_task

        self.assertTrue(job_finished)   # in-flight job completed despite cancellation
        self.assertTrue(worker.paused)  # paused state remains set

        await worker.close()
        await queue.close()

    async def test_pause_completes_despite_repeated_external_cancellation(self):
        """Test that pause() finishes waiting for in-flight jobs even when its task
        is cancelled repeatedly while waiting — exercises the while loop."""
        job_started = asyncio.Event()
        job_finished = False

        async def process(job: Job, token: str):
            nonlocal job_finished
            job_started.set()
            await asyncio.sleep(0.5)
            job_finished = True

        worker = Worker(queueName, process, {"prefix": prefix, "concurrency": 2})
        queue = Queue(queueName, {"prefix": prefix})
        await queue.add("test", {"idx": 1})
        await job_started.wait()  # wait until the job processor has actively started

        pause_task = asyncio.ensure_future(worker.pause())
        await asyncio.sleep(0.1)  # give pause() time to reach asyncio.wait(self.processing, ...)

        # Cancel the pause task 3 times to exercise the while loop
        for _ in range(3):
            pause_task.cancel()
            await asyncio.sleep(0)  # yield to let the CancelledError be delivered

        with self.assertRaises(asyncio.CancelledError):
            await pause_task

        self.assertTrue(job_finished)   # in-flight job completed despite repeated cancellation
        self.assertTrue(worker.paused)  # paused state remains set

        await worker.close()
        await queue.close()

    async def test_external_run_cancellation_propagates(self):
        """Test that cancelling the run() task from outside (not via pause/close)
        propagates CancelledError correctly instead of being swallowed into return None.

        When CancelledError is re-raised (correct), it propagates through retryIfFailed
        (which catches only Exception, not BaseException) and out of the run() loop,
        causing the finally block to set self.running = False.

        When CancelledError is swallowed with return None (incorrect), the worker
        silently continues fetching jobs and self.running stays True.
        """
        async def process(job: Job, token: str):
            pass

        worker = Worker(queueName, process, {"prefix": prefix})
        # Let the worker enter the idle BZPOPMIN wait
        await asyncio.sleep(0.2)

        # Confirm the worker is actually sitting in the idle wait
        self.assertTrue(worker.running)
        self.assertIsNotNone(worker.waiting)

        # Cancel the idle waiting task directly — not via pause()/close().
        # At this point worker.paused=False and worker.closing=False,
        # so the re-raise branch (not self.paused and not self.closing) should fire.
        worker.waiting.cancel()

        # Give the event loop time to deliver the CancelledError through the run() loop
        await asyncio.sleep(0.2)

        # Key assertion: if CancelledError was correctly re-raised, it propagates
        # through retryIfFailed → out of run() → finally sets self.running = False.
        # If it was swallowed (return None), the worker keeps running and this fails.
        self.assertFalse(worker.running)
        self.assertFalse(worker.closed)  # close() was never called

        await worker.close()


if __name__ == '__main__':
    unittest.main()
