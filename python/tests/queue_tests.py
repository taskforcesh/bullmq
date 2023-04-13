"""
Tests for the queue class.

https://bbc.github.io/cloudfit-public-docs/asyncio/testing.html
"""

import asyncio
import unittest
from asyncio import Future

from bullmq import Queue, Worker, Job;

queueName = "__bullmq_test_queue__"

class TestQueue(unittest.IsolatedAsyncioTestCase):

    async def asyncSetUp(self):
        print("Setting up test queue")
        # Delete test queue
        queue = Queue(queueName)
        await queue.pause()
        await queue.obliterate()
        await queue.close()

    async def test_add_job(self):
        queue = Queue(queueName)
        job = await queue.add("test-job", {"foo": "bar"}, {})
            
        self.assertEqual(job.id, "1")
        await queue.close()
        
    async def test_add_job_with_options(self):
        queue = Queue(queueName)
        data = {"foo": "bar"}
        attempts = 3,
        delay = 1000
        job = await queue.add("test-job", data=data , opts={"attempts": attempts, "delay": delay})

        self.assertEqual(job.id, "1")
        self.assertEqual(job.attempts, attempts)
        self.assertEqual(job.delay, delay)
        self.assertEqual(job.data, data)

        await queue.close()

    async def test_retry_failed_jobs(self):
        queue = Queue(queueName)
        job_count = 8

        fail = True

        async def process(job: Job, token: str):
            await asyncio.sleep(1)
            if fail:
                raise Exception("failed")
            return
        order = 0

        worker = Worker(queueName, process)

        failed_events = Future()
        def failing(job: Job, result):
            nonlocal order
            if order == (job_count - 1):
                failed_events.set_result(None)
            order+=1

        worker.on("failed", failing)

        for index in range(job_count):
            data = {"idx": index}
            await queue.add("test", data=data )
        
        await failed_events

        failed_count = await queue.getJobCounts('failed')

        self.assertEqual(failed_count['failed'], 8)

        order = 0

        completed_events = Future()
        def completing(job: Job, result):
            nonlocal order
            if order == (job_count - 1):
                completed_events.set_result(None)
            order+=1

        worker.on("completed", completing)

        fail=False

        await queue.retryJobs({ 'count': 2 })

        await completed_events

        completed_count = await queue.getJobCounts('completed')
        self.assertEqual(completed_count['completed'], 8)

        await queue.close()
        await worker.close()

    async def test_retry_completed_jobs(self):
        queue = Queue(queueName)
        job_count = 8

        async def process(job: Job, token: str):
            await asyncio.sleep(1)
            return
        order = 0

        worker = Worker(queueName, process)

        completed_events1 = Future()
        def completing1(job: Job, result):
            nonlocal order
            if order == (job_count - 1):
                completed_events1.set_result(None)
            order+=1

        worker.on("completed", completing1)

        for index in range(job_count):
            data = {"idx": index}
            await queue.add("test", data=data )
        
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
            order+=1

        worker.on("completed", completing2)

        await queue.retryJobs({ 'count': 2, 'state': 'completed' })

        await completed_events2

        worker.off('completed', completing2)

        completed_count2 = await queue.getJobCounts('completed')
        self.assertEqual(completed_count2['completed'], job_count)

        await queue.close()
        await worker.close()

if __name__ == '__main__':
    unittest.main()
