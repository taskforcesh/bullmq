"""
Tests for flow producer class.

https://bbc.github.io/cloudfit-public-docs/asyncio/testing.html
"""

from asyncio import Future
import os

from bullmq import Queue, Job, FlowProducer, Worker
from uuid import uuid4

import unittest

queue_name = f"__test_queue__{uuid4().hex}"
prefix = os.environ.get('BULLMQ_TEST_PREFIX') or "bull"

class TestJob(unittest.IsolatedAsyncioTestCase):

    async def asyncSetUp(self):
        print("Setting up test queue")
        # Delete test queue
        queue = Queue(queue_name, {"prefix": prefix})
        await queue.pause()
        await queue.obliterate()
        await queue.close()

    async def test_should_process_children_before_parent(self):
        child_job_name = 'child-job'
        children_data = [
            {"bar": 'something'},
            {"baz": 'something'},
            {"qux": 'something'}
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
            processing_parent.set_result(None)
            return 1

        parent_worker = Worker(parent_queue_name, process2, {"prefix": prefix})
        children_worker = Worker(queue_name, process1, {"prefix": prefix})

        flow = FlowProducer({}, {"prefix": prefix})
        await flow.add(
            {
                "name": 'parent-job',
                "queueName": parent_queue_name,
                "data": {},
                "children": [
                    {"name": child_job_name, "data": {"idx": 0, "foo": 'bar'}, "queueName": queue_name},
                    {"name": child_job_name, "data": {"idx": 1, "foo": 'baz'}, "queueName": queue_name},
                    {"name": child_job_name, "data": {"idx": 2, "foo": 'qux'}, "queueName": queue_name}
                ]
            }
        )

        await processing_children
        await processing_parent

        await parent_worker.close()
        await children_worker.close()
        await flow.close()

        parent_queue = Queue(parent_queue_name, {"prefix": prefix})
        await parent_queue.pause()
        await parent_queue.obliterate()
        await parent_queue.close()

    async def test_addBulk_should_process_children_before_parent(self):
        child_job_name = 'child-job'
        children_data = [
            {"idx": 0, "bar": 'something'},
            {"idx": 1, "baz": 'something'}
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

        processing_parents = Future()

        processed_parents = 0
        async def process2(job: Job, token: str):
            nonlocal processed_parents
            processed_parents+=1
            if processed_parents == 2:
                processing_parents.set_result(None)
            return 1

        parent_worker = Worker(parent_queue_name, process2, {"prefix": prefix})
        children_worker = Worker(queue_name, process1, {"prefix": prefix})

        flow = FlowProducer({},{"prefix": prefix})
        await flow.addBulk([
            {
                "name": 'parent-job-1',
                "queueName": parent_queue_name,
                "data": {},
                "children": [
                    {"name": child_job_name, "data": {"idx": 0, "foo": 'bar'}, "queueName": queue_name}
                ]
            },
            {
                "name": 'parent-job-2',
                "queueName": parent_queue_name,
                "data": {},
                "children": [
                    {"name": child_job_name, "data": {"idx": 1, "foo": 'baz'}, "queueName": queue_name}
                ]
            }
        ])

        await processing_children
        await processing_parents

        await parent_worker.close()
        await children_worker.close()
        await flow.close()

        parent_queue = Queue(parent_queue_name, {"prefix": prefix})
        await parent_queue.pause()
        await parent_queue.obliterate()
        await parent_queue.close()

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

        parent_worker = Worker(parent_queue_name, process2, {"prefix": prefix})
        children_worker = Worker(queue_name, process1, {"prefix": prefix})

        flow = FlowProducer({},{"prefix": prefix})
        await flow.add(
            {
                "name": 'parent-job',
                "queueName": parent_queue_name,
                "data": {},
                "children": [
                    {"name": child_job_name, "data": {"idx": 0, "foo": 'bar'}, "queueName": queue_name},
                    {"name": child_job_name, "data": {"idx": 1, "foo": 'baz'}, "queueName": queue_name},
                    {"name": child_job_name, "data": {"idx": 2, "foo": 'qux'}, "queueName": queue_name}
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

        parent_queue = Queue(parent_queue_name, {"prefix": prefix})
        await parent_queue.pause()
        await parent_queue.obliterate()
        await parent_queue.close()

    async def test_get_children_values_on_simple_jobs(self):
        queue = Queue(queue_name, {"prefix": prefix})
        job = await queue.add("test", {"foo": "bar"}, {"delay": 1500})
        children_values = await job.getChildrenValues()
        self.assertEqual(children_values, {})

        await queue.close()

if __name__ == '__main__':
    unittest.main()
