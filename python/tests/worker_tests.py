"""
Tests for the worker class.

https://bbc.github.io/cloudfit-public-docs/asyncio/testing.html
"""

from asyncio import Future
from bullmq import Queue, Worker, Job

import asyncio
import unittest
import time

queueName = "__test_queue__"


class TestWorker(unittest.IsolatedAsyncioTestCase):

    async def asyncSetUp(self):
        print("Setting up test queue")
        # Delete test queue
        queue = Queue(queueName)
        await queue.pause()
        await queue.obliterate()
        await queue.close()

    async def test_process_jobs(self):
        queue = Queue(queueName)
        data = {"foo": "bar"}
        job = await queue.add("test-job", data, {"removeOnComplete": False})

        async def process(job: Job, token: str):
            print("Processing job", job)
            return "done"

        worker = Worker(queueName, process)

        processing = Future()
        worker.on("completed", lambda job, result: processing.set_result(None))

        await processing

        completedJob = await Job.fromId(queue, job.id)

        self.assertEqual(completedJob.id, job.id)
        self.assertEqual(completedJob.attemptsMade, 1)
        self.assertEqual(completedJob.data, data)
        self.assertEqual(completedJob.returnvalue, "done")
        self.assertNotEqual(completedJob.finishedOn, None)

        await worker.close(force=True)
        await queue.close()

    async def test_process_jobs_fail(self):
        queue = Queue(queueName)
        data = {"foo": "bar"}
        job = await queue.add("test-job", data, {"removeOnComplete": False})

        failedReason = "Failed"

        async def process(job: Job, token: str):
            print("Processing job", job)
            raise Exception(failedReason)

        worker = Worker(queueName, process)

        processing = Future()
        worker.on("failed", lambda job, result: processing.set_result(None))

        await processing

        failedJob = await Job.fromId(queue, job.id)

        self.assertEqual(failedJob.id, job.id)
        self.assertEqual(failedJob.attemptsMade, 1)
        self.assertEqual(failedJob.data, data)
        self.assertEqual(failedJob.failedReason, failedReason)
        self.assertEqual(len(failedJob.stacktrace), 1)
        self.assertEqual(failedJob.returnvalue, None)
        self.assertNotEqual(failedJob.finishedOn, None)

        await worker.close(force=True)
        await queue.close()

    async def test_process_renews_lock(self):
        queue = Queue(queueName)
        data = {"foo": "bar"}
        job = await queue.add("test-job", data, {"removeOnComplete": False})

        async def process(job: Job, token: str):
            await asyncio.sleep(3)
            return "done"

        worker = Worker(queueName, process, {"lockDuration": 1000})

        processing = Future()
        worker.on("completed", lambda job, result: processing.set_result(None))

        await processing

        completedJob = await Job.fromId(queue, job.id)

        self.assertEqual(completedJob.id, job.id)
        self.assertEqual(completedJob.attemptsMade, 1)
        self.assertEqual(completedJob.data, data)
        self.assertEqual(completedJob.returnvalue, "done")
        self.assertNotEqual(completedJob.finishedOn, None)

        await worker.close(force=True)
        await queue.close()

    async def test_process_stalled_jobs(self):
        queue = Queue(queueName)
        data = {"foo": "bar"}
        job = await queue.add("test-job", data, {"removeOnComplete": False})

        startProcessing = Future()

        async def process1(job: Job, token: str):
            await asyncio.sleep(2)
            startProcessing.set_result(None)
            await asyncio.sleep(2)
            return "done1"

        worker = Worker(queueName, process1, {"lockDuration": 1000})

        await startProcessing
        await worker.close(force=True)

        async def process2(job: Job, token: str):
            return "done2"

        worker2 = Worker(queueName, process2, {
            "lockDuration": 1000, "stalledInterval": 1000})

        processing = Future()
        worker2.on("completed", lambda job,
                   result: processing.set_result(None))

        stalled = Future()
        worker2.on("stalled", lambda jobId: stalled.set_result(None))

        await stalled
        await processing

        completedJob = await Job.fromId(queue, job.id)

        self.assertEqual(completedJob.id, job.id)
        self.assertEqual(completedJob.attemptsMade, 2)
        self.assertEqual(completedJob.data, data)
        self.assertEqual(completedJob.returnvalue, "done2")
        self.assertNotEqual(completedJob.finishedOn, None)

        await worker2.close(force=True)
        await queue.close()

    async def test_retry_job_after_delay_with_custom_backoff(self):
        queue = Queue(queueName)

        async def process1(job: Job, token: str):
            if job.attemptsMade < 3:
                raise Exception("Not yet!")
            return None

        def backoff_strategy(attempts_made, type, err, job):
            return attempts_made * 1000

        worker = Worker(queueName, process1, {"settings": {
            "backoffStrategy": backoff_strategy
        }})

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


if __name__ == '__main__':
    unittest.main()
