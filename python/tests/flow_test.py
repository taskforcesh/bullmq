"""
Tests for flow producer class.

https://bbc.github.io/cloudfit-public-docs/asyncio/testing.html
"""

import asyncio
import os
import redis.asyncio as redis

from asyncio import Future
from bullmq import Queue, Job, FlowProducer, Worker
from uuid import uuid4

import unittest

queue_name = ""
prefix = os.environ.get('BULLMQ_TEST_PREFIX') or "bull"

class TestJob(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        print("Setting up test queue")
        queueName = f"__test_queue__{uuid4().hex}"

    async def asyncTearDown(self):
        connection = redis.Redis(host='localhost')
        await connection.flushdb()

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

    async def test_should_fail_parent_when_child_with_failParentOnFailure_fails(self):
        """Test that parent job fails when child job with failParentOnFailure fails"""
        parent_queue_name = f"__test_parent_queue__{uuid4().hex}"
        child_queue_name = f"__test_child_queue__{uuid4().hex}"

        processing_child = Future()

        # Child worker that fails
        async def process_child(job: Job, token: str):
            processing_child.set_result(None)
            raise Exception("Child job failed")

        # Parent worker should not be called because parent should fail
        async def process_parent(job: Job, token: str):
            return 1

        parent_worker = Worker(parent_queue_name, process_parent, {"prefix": prefix})
        child_worker = Worker(child_queue_name, process_child, {"prefix": prefix})

        flow = FlowProducer({}, {"prefix": prefix})
        parent_tree = await flow.add(
            {
                "name": 'parent-job',
                "queueName": parent_queue_name,
                "data": {},
                "children": [
                    {
                        "name": 'child-job',
                        "data": {"foo": 'bar'},
                        "queueName": child_queue_name,
                        "opts": {"failParentOnFailure": True}
                    }
                ]
            }
        )

        parent_job_id = parent_tree["job"].id

        # Wait for child to be processed (and fail)
        await processing_child

        # Give some time for the failure to propagate
        await asyncio.sleep(1.0)

        # Check that the parent job is in failed state
        parent_queue = Queue(parent_queue_name, {"prefix": prefix})
        parent_job = await Job.fromId(parent_queue, parent_job_id)
        
        self.assertIsNotNone(parent_job, "Parent job should exist")
        
        # Check the job state
        job_state = await parent_job.getState()
        self.assertEqual(job_state, "failed", f"Parent job should be in failed state but is in {job_state}")
        
        # Check that the failed reason mentions children
        self.assertIsNotNone(parent_job.failedReason, "Parent job should have a failed reason")

        await parent_worker.close()
        await child_worker.close()
        await flow.close()

        await parent_queue.pause()
        await parent_queue.obliterate()
        await parent_queue.close()

        child_queue = Queue(child_queue_name, {"prefix": prefix})
        await child_queue.pause()
        await child_queue.obliterate()
        await child_queue.close()

    async def test_add_after_close_returns_none(self):
        """Adding a flow after the producer is closed must be a no-op
        rather than raising on a closed connection."""
        flow = FlowProducer({}, {"prefix": prefix})
        await flow.close()

        result = await flow.add(
            {
                "name": "noop",
                "queueName": f"__test_queue__{uuid4().hex}",
                "data": {},
            }
        )
        self.assertIsNone(result)

        bulk_result = await flow.addBulk([
            {
                "name": "noop",
                "queueName": f"__test_queue__{uuid4().hex}",
                "data": {},
            }
        ])
        self.assertIsNone(bulk_result)

    async def test_add_raises_when_parent_does_not_exist(self):
        """Adding a flow whose root references a non-existent parent
        must raise instead of silently dropping the job. Mirrors GH #3264
        on the Node side."""
        child_queue_name = f"__test_child_queue__{uuid4().hex}"
        parent_queue_name = f"__test_parent_queue__{uuid4().hex}"

        bogus_parent_id = uuid4().hex
        bogus_parent_queue_qname = f"{prefix}:{parent_queue_name}"

        flow = FlowProducer({}, {"prefix": prefix})
        with self.assertRaises(Exception) as ctx:
            await flow.add(
                {
                    "name": "orphan",
                    "queueName": child_queue_name,
                    "data": {},
                    "opts": {
                        "parent": {
                            "id": bogus_parent_id,
                            "queue": bogus_parent_queue_qname,
                        }
                    },
                }
            )

        # The Lua script returns ErrorCode.ParentJobNotExist (-5); the
        # producer attaches the numeric code to the exception so callers
        # can branch on it.
        self.assertEqual(getattr(ctx.exception, "code", None), -5)
        self.assertIn("parent job", str(ctx.exception).lower())

        await flow.close()

        child_queue = Queue(child_queue_name, {"prefix": prefix})
        await child_queue.obliterate()
        await child_queue.close()

    async def test_addBulk_does_not_raise_on_missing_parent(self):
        """`addBulk` uses lenient semantics: a root command that
        returns a negative error code (e.g. parent does not exist)
        must NOT raise, must still return one tree per input flow,
        and must reconcile ids for the flows that succeeded."""
        good_queue_name = f"__test_good_queue__{uuid4().hex}"
        bad_queue_name = f"__test_bad_queue__{uuid4().hex}"
        bogus_parent_queue_qname = (
            f"{prefix}:__test_missing_parent_queue__{uuid4().hex}"
        )

        flow = FlowProducer({}, {"prefix": prefix})
        good_queue = Queue(good_queue_name, {"prefix": prefix})
        try:
            # If addBulk raises here, the exception itself fails the
            # test with a clear traceback — no need to swallow + .fail().
            trees = await flow.addBulk([
                {
                    "name": "ok-root",
                    "queueName": good_queue_name,
                    "data": {"ok": True},
                },
                {
                    "name": "orphan-root",
                    "queueName": bad_queue_name,
                    "data": {},
                    "opts": {
                        "parent": {
                            "id": uuid4().hex,
                            "queue": bogus_parent_queue_qname,
                        }
                    },
                },
            ])

            self.assertIsNotNone(trees)
            self.assertEqual(len(trees), 2)
            # The successful root should have a job id assigned and be
            # retrievable from Redis.
            good_id = trees[0]["job"].id
            self.assertIsNotNone(good_id)

            round_tripped = await Job.fromId(good_queue, good_id)
            self.assertIsNotNone(round_tripped)
            self.assertEqual(round_tripped.data, {"ok": True})
        finally:
            # Ensure connections are released even if any assertion or
            # the addBulk call itself raises; otherwise leaked Redis
            # connections can destabilise subsequent tests.
            await flow.close()
            await good_queue.obliterate()
            await good_queue.close()

    async def test_root_job_id_round_trips_through_redis(self):
        """After `add`, the returned `jobs_tree["job"].id` must match the
        job that actually lives in Redis. Catches regressions where the
        FlowProducer fails to reconcile the id with the script result."""
        local_queue_name = f"__test_queue__{uuid4().hex}"

        flow = FlowProducer({}, {"prefix": prefix})
        jobs_tree = await flow.add(
            {
                "name": "root",
                "queueName": local_queue_name,
                "data": {"hello": "world"},
            }
        )

        returned_id = jobs_tree["job"].id
        self.assertIsNotNone(returned_id)

        queue = Queue(local_queue_name, {"prefix": prefix})
        round_tripped = await Job.fromId(queue, returned_id)
        self.assertIsNotNone(round_tripped)
        self.assertEqual(round_tripped.id, returned_id)
        self.assertEqual(round_tripped.data, {"hello": "world"})

        await flow.close()
        await queue.obliterate()
        await queue.close()


if __name__ == '__main__':
    unittest.main()
