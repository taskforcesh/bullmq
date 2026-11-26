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

        flow = FlowProducer({"prefix": prefix})
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

        flow = FlowProducer({"prefix": prefix})
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

        flow = FlowProducer({"prefix": prefix})
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

        flow = FlowProducer({"prefix": prefix})
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


    async def test_get_flow_tree(self):
        """Mirrors 'should get a flow tree' in tests/flow.test.ts."""
        top_queue_name = f"__test_parent_queue__{uuid4().hex}"
        child_queue_name = f"__test_queue__{uuid4().hex}"
        name = "child-job"

        flow = FlowProducer({"prefix": prefix})
        try:
            original_tree = await flow.add({
                "name": "root-job",
                "queueName": top_queue_name,
                "data": {},
                "children": [{
                    "name": name,
                    "data": {"idx": 0, "foo": "bar"},
                    "queueName": child_queue_name,
                    "children": [{
                        "name": name,
                        "data": {"idx": 1, "foo": "baz"},
                        "queueName": child_queue_name,
                        "children": [{
                            "name": name,
                            "data": {"idx": 2, "foo": "qux"},
                            "queueName": child_queue_name,
                        }],
                    }],
                }],
            })
            top_job = original_tree["job"]

            tree = await flow.getFlow({
                "id": top_job.id,
                "queueName": top_queue_name,
                "prefix": prefix,
            })

            self.assertIn("job", tree)
            self.assertIn("children", tree)
            job = tree["job"]
            children = tree["children"]
            self.assertEqual(job.id, top_job.id)
            self.assertEqual(job.queueName, top_queue_name)
            self.assertTrue(await job.isWaitingChildren())
            self.assertEqual(len(children), 1)

            self.assertTrue(children[0]["job"].id)
            self.assertEqual(children[0]["job"].data["foo"], "bar")
            self.assertEqual(children[0]["job"].queueName, child_queue_name)
            self.assertEqual(len(children[0]["children"]), 1)

            grandchild = children[0]["children"][0]
            self.assertTrue(grandchild["job"].id)
            self.assertEqual(grandchild["job"].queueName, child_queue_name)
            self.assertEqual(grandchild["job"].data["foo"], "baz")

            leaf = grandchild["children"][0]
            self.assertTrue(leaf["job"].id)
            self.assertEqual(leaf["job"].data["foo"], "qux")
            # Leaves carry no "children" key, like JobNode in Node.
            self.assertNotIn("children", leaf)

            # Default prefix comes from the FlowProducer when omitted.
            default_prefix_tree = await flow.getFlow({
                "id": top_job.id,
                "queueName": top_queue_name,
            })
            self.assertEqual(default_prefix_tree["job"].id, top_job.id)
            self.assertEqual(len(default_prefix_tree["children"]), 1)

            # Unknown root job.
            self.assertIsNone(await flow.getFlow({
                "id": "does-not-exist",
                "queueName": top_queue_name,
            }))
        finally:
            await flow.close()
            for qn in (top_queue_name, child_queue_name):
                q = Queue(qn, {"prefix": prefix})
                await q.obliterate(force=True)
                await q.close()

    async def test_get_part_of_flow_tree(self):
        """Mirrors 'should get part of flow tree' in tests/flow.test.ts:
        `depth` limits the levels visited."""
        top_queue_name = f"__test_parent_queue__{uuid4().hex}"
        child_queue_name = f"__test_queue__{uuid4().hex}"
        name = "child-job"

        flow = FlowProducer({"prefix": prefix})
        try:
            original_tree = await flow.add({
                "name": "root-job",
                "queueName": top_queue_name,
                "data": {},
                "children": [
                    {
                        "name": name,
                        "data": {"idx": 0, "foo": "bar"},
                        "queueName": child_queue_name,
                        "children": [{
                            "name": name,
                            "data": {"idx": 1, "foo": "baz"},
                            "queueName": child_queue_name,
                            "children": [{
                                "name": name,
                                "data": {"idx": 2, "foo": "qux"},
                                "queueName": child_queue_name,
                            }],
                        }],
                    },
                    {"name": name, "data": {"idx": 3, "foo": "bax"}, "queueName": child_queue_name},
                    {"name": name, "data": {"idx": 4, "foo": "baz"}, "queueName": child_queue_name},
                ],
            })
            top_job = original_tree["job"]

            tree = await flow.getFlow({
                "id": top_job.id,
                "queueName": top_queue_name,
                "depth": 2,
                "maxChildren": 2,
                "prefix": prefix,
            })

            self.assertTrue(await tree["job"].isWaitingChildren())
            children = tree["children"]
            # SSCAN's COUNT is only a hint, so at least `maxChildren` come back.
            self.assertGreaterEqual(len(children), 2)
            for child in children:
                self.assertTrue(child["job"].id)
                # depth=2: the second level is returned without its children.
                self.assertNotIn("children", child)

            # depth=1 returns only the root job.
            root_only = await flow.getFlow({
                "id": top_job.id,
                "queueName": top_queue_name,
                "depth": 1,
            })
            self.assertEqual(root_only["job"].id, top_job.id)
            self.assertNotIn("children", root_only)
        finally:
            await flow.close()
            for qn in (top_queue_name, child_queue_name):
                q = Queue(qn, {"prefix": prefix})
                await q.obliterate(force=True)
                await q.close()

    async def test_get_flow_includes_processed_children(self):
        """Processed children are still part of the tree."""
        parent_queue_name = f"__test_parent_queue__{uuid4().hex}"
        child_queue_name = f"__test_queue__{uuid4().hex}"

        children_done = Future()
        processed = 0

        async def process_child(job: Job, token: str):
            nonlocal processed
            processed += 1
            if processed == 2:
                children_done.set_result(None)
            return job.data["idx"]

        child_worker = Worker(child_queue_name, process_child, {"prefix": prefix})
        flow = FlowProducer({"prefix": prefix})
        try:
            tree = await flow.add({
                "name": "parent",
                "queueName": parent_queue_name,
                "data": {},
                "children": [
                    {"name": "child", "data": {"idx": 0}, "queueName": child_queue_name},
                    {"name": "child", "data": {"idx": 1}, "queueName": child_queue_name},
                ],
            })
            await asyncio.wait_for(children_done, 10)
            await child_worker.close()

            flow_tree = await flow.getFlow({
                "id": tree["job"].id,
                "queueName": parent_queue_name,
            })
            self.assertEqual(len(flow_tree["children"]), 2)
            self.assertEqual(
                sorted(c["job"].data["idx"] for c in flow_tree["children"]),
                [0, 1],
            )
            # Parent was moved to wait once both children completed.
            self.assertEqual(await flow_tree["job"].getState(), "waiting")
        finally:
            await child_worker.close()
            await flow.close()
            for qn in (parent_queue_name, child_queue_name):
                q = Queue(qn, {"prefix": prefix})
                await q.obliterate(force=True)
                await q.close()

    async def test_get_ignored_children_failures(self):
        """Mirrors 'when ignoreDependencyOnFailure is provided' in
        tests/flow.test.ts."""
        parent_queue_name = f"__test_parent_queue__{uuid4().hex}"
        child_queue_name = f"__test_queue__{uuid4().hex}"
        name = "child-job"

        async def process_child(job: Job, token: str):
            raise Exception("error")

        parent_completed = Future()

        async def process_parent(job: Job, token: str):
            return "done"

        child_worker = Worker(child_queue_name, process_child, {"prefix": prefix})
        parent_worker = Worker(parent_queue_name, process_parent, {"prefix": prefix})
        parent_worker.on(
            "completed",
            lambda job, result: parent_completed.done() or parent_completed.set_result(job),
        )
        child_queue = Queue(child_queue_name, {"prefix": prefix})

        flow = FlowProducer({"prefix": prefix})
        try:
            tree = await flow.add({
                "name": "parent-job",
                "queueName": parent_queue_name,
                "data": {},
                "children": [
                    {
                        "name": name,
                        "data": {"idx": i, "foo": foo},
                        "queueName": child_queue_name,
                        "opts": {"ignoreDependencyOnFailure": True},
                    }
                    for i, foo in enumerate(["bar", "baz", "qux"])
                ],
            })
            job = tree["job"]
            children = tree["children"]
            # No state assertion here: the workers are already running and the
            # children fail at once, so the parent may already have left
            # 'waiting-children' by the time we could check it.
            self.assertEqual(len(children), 3)

            await asyncio.wait_for(parent_completed, 10)

            ignored = await job.getIgnoredChildrenFailures()
            self.assertEqual(ignored, {
                f"{child_queue.qualifiedName}:{child['job'].id}": "error"
                for child in children
            })

            dependencies = await job.getDependencies()
            self.assertEqual(dependencies["ignored"], ignored)
            self.assertEqual(dependencies["processed"], {})
            self.assertEqual(dependencies["unprocessed"], [])

            flow_tree = await flow.getFlow({
                "id": job.id,
                "queueName": parent_queue_name,
            })
            self.assertEqual(len(flow_tree["children"]), 3)

            # A job without children has no ignored failures.
            self.assertEqual(
                await children[0]["job"].getIgnoredChildrenFailures(), {}
            )
        finally:
            await child_worker.close()
            await parent_worker.close()
            await flow.close()
            await child_queue.obliterate(force=True)
            await child_queue.close()
            parent_queue = Queue(parent_queue_name, {"prefix": prefix})
            await parent_queue.obliterate(force=True)
            await parent_queue.close()

    async def test_get_dependencies_pagination(self):
        parent_queue_name = f"__test_parent_queue__{uuid4().hex}"
        queue_names = {
            category: f"__test_{category}_queue__{uuid4().hex}"
            for category in ("processed", "unprocessed", "ignored", "failed")
        }
        queues = {
            category: Queue(name, {"prefix": prefix})
            for category, name in queue_names.items()
        }
        children_per_category = 8
        job_ids = {
            category: [
                f"{category}-{i}-{uuid4().hex}-{'x' * 64}"
                for i in range(children_per_category)
            ]
            for category in queue_names
        }

        flow = FlowProducer({"prefix": prefix})
        workers = []
        try:
            tree = await flow.add({
                "name": "parent",
                "queueName": parent_queue_name,
                "data": {},
                "children": [
                    {
                        "name": category,
                        "queueName": queue_names[category],
                        "data": {"idx": i},
                        "opts": {
                            "jobId": job_id,
                            **(
                                {"ignoreDependencyOnFailure": True}
                                if category == "ignored"
                                else (
                                    {"failParentOnFailure": True}
                                    if category == "failed"
                                    else {}
                                )
                            ),
                        },
                    }
                    for category in queue_names
                    for i, job_id in enumerate(job_ids[category])
                ],
            })

            done = {
                category: asyncio.Event()
                for category in ("processed", "ignored", "failed")
            }
            finished_counts = {category: 0 for category in done}

            def mark_finished(category):
                finished_counts[category] += 1
                if finished_counts[category] == children_per_category:
                    done[category].set()

            def make_processor(category):
                async def process(job: Job, token: str):
                    if category == "processed":
                        return {"idx": job.data["idx"]}
                    raise Exception(category)

                return process

            for category in done:
                worker = Worker(
                    queue_names[category],
                    make_processor(category),
                    {"prefix": prefix},
                )
                worker.on(
                    "completed" if category == "processed" else "failed",
                    lambda *args, category=category: mark_finished(category),
                )
                workers.append(worker)

            await asyncio.wait_for(
                asyncio.gather(*(event.wait() for event in done.values())),
                10,
            )

            job = tree["job"]
            options = {
                category: {"cursor": 0, "count": 1}
                for category in queue_names
            }
            page = await job.getDependencies(options)
            next_cursors = {
                "processed": "nextProcessedCursor",
                "unprocessed": "nextUnprocessedCursor",
                "ignored": "nextIgnoredCursor",
                "failed": "nextFailedCursor",
            }

            expected_keys = {
                category: {
                    f"{queues[category].qualifiedName}:{job_id}"
                    for job_id in job_ids[category]
                }
                for category in queue_names
            }
            expected_processed = {
                f"{queues['processed'].qualifiedName}:{job_id}": {"idx": i}
                for i, job_id in enumerate(job_ids["processed"])
            }
            expected_ignored = {
                f"{queues['ignored'].qualifiedName}:{job_id}": "ignored"
                for job_id in job_ids["ignored"]
            }
            results = {
                "processed": dict(page["processed"]),
                "unprocessed": set(page["unprocessed"]),
                "ignored": dict(page["ignored"]),
                "failed": set(page["failed"]),
            }
            for category in queue_names:
                nonzero_cursor_page = await job.getDependencies({
                    category: {"cursor": 1, "count": 1},
                })
                self.assertEqual(
                    set(nonzero_cursor_page),
                    {category, next_cursors[category]},
                )
                cursor = page[next_cursors[category]]
                for _ in range(children_per_category * 4):
                    if cursor == 0:
                        break
                    next_page = await job.getDependencies({
                        category: {"cursor": cursor, "count": 1},
                    })
                    self.assertEqual(
                        set(next_page),
                        {category, next_cursors[category]},
                    )
                    results[category].update(next_page[category])
                    cursor = next_page[next_cursors[category]]
                self.assertEqual(cursor, 0)
                self.assertEqual(set(results[category]), expected_keys[category])

            self.assertEqual(results["processed"], expected_processed)
            self.assertEqual(results["ignored"], expected_ignored)
        finally:
            for worker in workers:
                await worker.close()
            await flow.close()
            for queue in queues.values():
                await queue.obliterate(force=True)
                await queue.close()
            parent_queue = Queue(parent_queue_name, {"prefix": prefix})
            await parent_queue.obliterate(force=True)
            await parent_queue.close()


if __name__ == '__main__':
    unittest.main()
