"""
Tests for the worker class.

https://bbc.github.io/cloudfit-public-docs/asyncio/testing.html
"""

from asyncio import Future
from bullmq import Queue, Worker, Job, WaitingChildrenError
from uuid import uuid4
from enum import Enum

import asyncio
import unittest
import time

queueName = f"__test_queue__{uuid4().hex}"

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

    async def test_process_job_with_array_as_return_value(self):
        queue = Queue(queueName)
        data = {"foo": "bar"}
        job = await queue.add("test-job", data, {"removeOnComplete": False})

        async def process(job: Job, token: str):
            print("Processing job", job)
            return ['foo']

        worker = Worker(queueName, process)

        processing = Future()
        worker.on("completed", lambda job, result: processing.set_result(None))

        await processing

        completedJob = await Job.fromId(queue, job.id)

        self.assertEqual(completedJob.id, job.id)
        self.assertEqual(completedJob.attemptsMade, 1)
        self.assertEqual(completedJob.data, data)
        self.assertEqual(completedJob.returnvalue, ['foo'])
        self.assertNotEqual(completedJob.finishedOn, None)

        await worker.close(force=True)
        await queue.close()

    async def test_process_job_with_boolean_as_return_value(self):
        queue = Queue(queueName)
        data = {"foo": "bar"}
        job = await queue.add("test-job", data, {"removeOnComplete": False})

        async def process(job: Job, token: str):
            print("Processing job", job)
            return True

        worker = Worker(queueName, process)

        processing = Future()
        worker.on("completed", lambda job, result: processing.set_result(None))

        await processing

        completedJob = await Job.fromId(queue, job.id)

        self.assertEqual(completedJob.id, job.id)
        self.assertEqual(completedJob.attemptsMade, 1)
        self.assertEqual(completedJob.data, data)
        self.assertEqual(completedJob.returnvalue, True)
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
        self.assertEqual(failedJob.failedReason, f'"{failedReason}"')
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

    async def test_retry_job_after_delay_with_fixed_backoff(self):
        queue = Queue(queueName)

        async def process1(job: Job, token: str):
            if job.attemptsMade < 3:
                raise Exception("Not yet!")
            return None

        worker = Worker(queueName, process1)

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

    async def test_create_children_at_runtime(self):
        parent_queue_name = f"__parent_queue__{uuid4().hex}"
        parent_queue = Queue(parent_queue_name)
        queue = Queue(queueName)

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
                    await queue.add('child-2', {"foo": "bar" },{
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

        worker = Worker(parent_queue_name, parent_process, {})
        children_worker = Worker(queueName, children_process, {})

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
        queue = Queue(queueName)

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

        worker = Worker(queueName, process, {"concurrency": 4 })

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

if __name__ == '__main__':
    unittest.main()
