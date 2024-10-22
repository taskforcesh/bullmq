"""
Tests for job class.

https://bbc.github.io/cloudfit-public-docs/asyncio/testing.html
"""

import unittest

from asyncio import Future
from bullmq import Queue, Job, Worker, FlowProducer
from uuid import uuid4

queueName = f"__test_queue__{uuid4().hex}"

class TestJob(unittest.IsolatedAsyncioTestCase):

    async def asyncSetUp(self):
        print("Setting up test queue")
        # Delete test queue
        queue = Queue(queueName)
        await queue.pause()
        await queue.obliterate()
        await queue.close()

    async def test_set_and_get_progress_as_number(self):
        queue = Queue(queueName)
        job = await queue.add("test-job", {"foo": "bar"}, {})
        await job.updateProgress(42)
        stored_job = await Job.fromId(queue, job.id)
        self.assertEqual(stored_job.progress, 42)

        await queue.close()

    async def test_set_and_get_progress_as_object(self):
        queue = Queue(queueName)
        job = await queue.add("test-job", {"foo": "bar"}, {})
        await job.updateProgress({"total": 120, "completed": 40})
        stored_job = await Job.fromId(queue, job.id)
        self.assertEqual(stored_job.progress, {"total": 120, "completed": 40})

        await queue.close()

    async def test_get_job_state(self):
        queue = Queue(queueName)
        job = await queue.add("test-job", {"foo": "bar"}, {})
        state = await job.getState()

        self.assertEqual(state, "waiting")

        await queue.close()

    async def test_job_log(self):
        queue = Queue(queueName)
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
        queue = Queue(queueName)
        job = await queue.add("test", {"foo": "bar"}, {})
        await job.updateData({"baz": "qux"})
        stored_job = await Job.fromId(queue, job.id)

        self.assertEqual(stored_job.data, {"baz": "qux"})

        await queue.close()

    async def test_job_data_json_compliant(self):
        queue = Queue(queueName)
        job = await queue.add("test", {"foo": "bar"}, {})
        with self.assertRaises(ValueError):
            await job.updateData({"baz": float('nan')})

        await queue.close()

    async def test_update_job_data_when_is_removed(self):
        queue = Queue(queueName)
        job = await queue.add("test", {"foo": "bar"}, {})
        await job.remove()
        with self.assertRaises(TypeError):
            await job.updateData({"baz": "qux"})

        await queue.close()

    async def test_promote_delayed_job(self):
        queue = Queue(queueName)
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

    async def test_get_children_values(self):
        child_job_name = 'child-job'
        children_data = [
            {"bar": None},
            {"baz": 12.93},
            {"qux": "string value"}
        ]
        parent_queue_name = f"__test_parent_queue__{uuid4().hex}"

        processing_children = Future()

        processed_children = 0
        async def process1(job: Job, token: str):
            nonlocal processed_children
            processed_children+=1
            if processed_children == len(children_data):
                processing_children.set_result(None)
            return children_data[job.data.get("idx")]

        processing_parent = Future()

        async def process2(job: Job, token: str):
            children_values = await job.getChildrenValues()
            processing_parent.set_result(children_values)
            return 1

        parent_worker = Worker(parent_queue_name, process2)
        children_worker = Worker(queueName, process1)

        flow = FlowProducer()
        await flow.add(
            {
                "name": 'parent-job',
                "queueName": parent_queue_name,
                "data": {},
                "children": [
                    {"name": child_job_name, "data": {"idx": 0, "foo": 'bar'}, "queueName": queueName},
                    {"name": child_job_name, "data": {"idx": 1, "foo": 'baz'}, "queueName": queueName},
                    {"name": child_job_name, "data": {"idx": 2, "foo": 'qux'}, "queueName": queueName}
                ]
            }
        )

        await processing_children
        await processing_parent

        def on_parent_processed(future):
            self.assertIn(children_data[0], future.result().values())
            self.assertIn(children_data[1], future.result().values())
            self.assertIn(children_data[2], future.result().values())

        processing_parent.add_done_callback(on_parent_processed)

        await parent_worker.close()
        await children_worker.close()
        await flow.close()

        parent_queue = Queue(parent_queue_name)
        await parent_queue.pause()
        await parent_queue.obliterate()
        await parent_queue.close()

    async def test_get_children_values_on_simple_jobs(self):
        queue = Queue(queueName)
        job = await queue.add("test", {"foo": "bar"}, {"delay": 1500})
        children_values = await job.getChildrenValues()
        self.assertEqual(children_values, {})

        await queue.close()

if __name__ == '__main__':
    unittest.main()
