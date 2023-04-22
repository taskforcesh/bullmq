"""
Tests for the worker class.

https://bbc.github.io/cloudfit-public-docs/asyncio/testing.html
"""

from asyncio import Future

import asyncio
import unittest
import bullmq

queueName = "__test_queue__"


class TestWorker(unittest.IsolatedAsyncioTestCase):

    async def asyncSetUp(self):
        print("Setting up test queue")
        # Delete test queue
        queue = bullmq.Queue(queueName)
        await queue.pause()
        await queue.obliterate()
        await queue.close()

    async def test_process_jobs(self):
        queue = bullmq.Queue(queueName)
        data = {"foo": "bar"}
        job = await queue.add("test-job", data, {"removeOnComplete": False})

        async def process(job: bullmq.Job, token: str):
            print("Processing job", job)
            return "done"

        worker = bullmq.Worker(queueName, process)

        processing = Future()
        worker.on("completed", lambda job, result: processing.set_result(None))

        await processing

        completedJob = await bullmq.Job.fromId(queue, job.id)

        self.assertEqual(completedJob.id, job.id)
        self.assertEqual(completedJob.attemptsMade, 1)
        self.assertEqual(completedJob.data, data)
        self.assertEqual(completedJob.returnvalue, "done")
        self.assertNotEqual(completedJob.finishedOn, None)

        await worker.close(force=True)
        await queue.close()

    async def test_process_jobs_fail(self):
        queue = bullmq.Queue(queueName)
        data = {"foo": "bar"}
        job = await queue.add("test-job", data, {"removeOnComplete": False})

        failedReason = "Failed"

        async def process(job: bullmq.Job, token: str):
            print("Processing job", job)
            raise Exception(failedReason)

        worker = bullmq.Worker(queueName, process)

        processing = Future()
        worker.on("failed", lambda job, result: processing.set_result(None))

        await processing

        failedJob = await bullmq.Job.fromId(queue, job.id)

        self.assertEqual(failedJob.id, job.id)
        self.assertEqual(failedJob.attemptsMade, 1)
        self.assertEqual(failedJob.data, data)
        self.assertEqual(failedJob.failedReason, failedReason)
        self.assertEqual(failedJob.stacktrace, [])
        self.assertEqual(failedJob.returnvalue, None)
        self.assertEqual(failedJob.returnvalue, None)
        self.assertNotEqual(failedJob.finishedOn, None)

        await worker.close(force=True)
        await queue.close()

    async def test_process_renews_lock(self):
        queue = bullmq.Queue(queueName)
        data = {"foo": "bar"}
        job = await queue.add("test-job", data, {"removeOnComplete": False})

        async def process(job: bullmq.Job, token: str):
            await asyncio.sleep(3)
            return "done"

        worker = bullmq.Worker(queueName, process, {"lockDuration": 1000})

        processing = Future()
        worker.on("completed", lambda job, result: processing.set_result(None))

        await processing

        completedJob = await bullmq.Job.fromId(queue, job.id)

        self.assertEqual(completedJob.id, job.id)
        self.assertEqual(completedJob.attemptsMade, 1)
        self.assertEqual(completedJob.data, data)
        self.assertEqual(completedJob.returnvalue, "done")
        self.assertNotEqual(completedJob.finishedOn, None)

        await worker.close(force=True)
        await queue.close()

    async def test_process_stalled_jobs(self):
        queue = bullmq.Queue(queueName)
        data = {"foo": "bar"}
        job = await queue.add("test-job", data, {"removeOnComplete": False})

        startProcessing = Future()

        async def process1(job: bullmq.Job, token: str):
            await asyncio.sleep(2)
            startProcessing.set_result(None)
            await asyncio.sleep(2)
            return "done1"

        worker = bullmq.Worker(queueName, process1, {"lockDuration": 1000})

        await startProcessing
        await worker.close(force=True)

        async def process2(job: bullmq.Job, token: str):
            return "done2"

        worker2 = bullmq.Worker(queueName, process2, {
            "lockDuration": 1000, "stalledInterval": 1000})

        processing = Future()
        worker2.on("completed", lambda job,
                   result: processing.set_result(None))

        stalled = Future()
        worker2.on("stalled", lambda jobId: stalled.set_result(None))

        await stalled
        await processing

        completedJob = await bullmq.Job.fromId(queue, job.id)

        self.assertEqual(completedJob.id, job.id)
        self.assertEqual(completedJob.attemptsMade, 2)
        self.assertEqual(completedJob.data, data)
        self.assertEqual(completedJob.returnvalue, "done2")
        self.assertNotEqual(completedJob.finishedOn, None)

        await worker2.close(force=True)
        await queue.close()


if __name__ == '__main__':
    unittest.main()
