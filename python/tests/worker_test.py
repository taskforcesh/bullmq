"""
Tests for the worker class.

https://bbc.github.io/cloudfit-public-docs/asyncio/testing.html
"""

from asyncio import Future
import redis.asyncio as redis
from bullmq import Queue, Worker, Job, WaitingChildrenError
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
        await connection.flushdb()

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
        queue = Queue(queueName, {"prefix": prefix})
        data = {"foo": "bar"}
        job = await queue.add("test-job", data, {"removeOnComplete": False})

        failedReason = "Failed"

        async def process(job: Job, token: str):
            print("Processing job", job)
            raise Exception(failedReason)

        worker = Worker(queueName, process, {"prefix": prefix})

        processing = Future()
        worker.on("failed", lambda job, result: processing.set_result(None))

        await processing

        failedJob = await Job.fromId(queue, job.id)

        self.assertEqual(failedJob.id, job.id)
        self.assertEqual(failedJob.attemptsMade, 1)
        self.assertEqual(failedJob.data, data)
        self.assertEqual(failedJob.failedReason, f'"{failedReason}"')
        self.assertEqual(len(failedJob.stacktrace), 1)
        self.assertEqual(failedJob.returnvalue, None)
        self.assertNotEqual(failedJob.finishedOn, None)

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

if __name__ == '__main__':
    unittest.main()
