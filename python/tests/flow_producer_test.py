import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from bullmq.backends.redis_backend import RedisBackend
from bullmq.flow_producer import FlowProducer


class _FakeBackend:
    def __init__(self):
        self.qualifiedName = "bull:default"
        self.addFlow = AsyncMock()
        self.close = AsyncMock()

    def forQueue(self, queue_name: str, prefix: str | None = None):
        qualified_name = f"{prefix}:{queue_name}" if prefix else queue_name
        return SimpleNamespace(qualifiedName=qualified_name)


class TestFlowProducer(unittest.IsolatedAsyncioTestCase):
    async def test_add_does_not_mutate_queues_default_job_options(self):
        backend = _FakeBackend()

        with patch("bullmq.flow_producer.create_backend", return_value=backend):
            flow = FlowProducer()
            default_job_options = {"removeOnComplete": True}
            queues_options = {
                "paint": {"defaultJobOptions": default_job_options},
            }

            tree = await flow.add(
                {
                    "name": "job",
                    "queueName": "paint",
                    "data": {"color": "blue"},
                    "opts": {"attempts": 3},
                },
                {"queuesOptions": queues_options},
            )

        self.assertEqual(default_job_options, {"removeOnComplete": True})
        self.assertEqual(
            queues_options["paint"]["defaultJobOptions"],
            {"removeOnComplete": True},
        )
        self.assertEqual(tree["job"].opts["attempts"], 3)
        self.assertTrue(tree["job"].opts["removeOnComplete"])
        backend.addFlow.assert_awaited_once()


class _FakePipeline:
    def __init__(self, results):
        self._results = results

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def execute(self):
        return self._results


class TestRedisBackendFlowInsertion(unittest.IsolatedAsyncioTestCase):
    async def test_add_flow_uses_each_job_backend_scripts(self):
        pipeline = _FakePipeline(["parent-id", "child-id"])
        connection = SimpleNamespace(
            conn=SimpleNamespace(pipeline=lambda transaction=True: pipeline),
            commands={},
        )
        backend = RedisBackend("root", connection, prefix="root-prefix", owns_connection=False)
        backend.scripts.resetQueueKeys = Mock(
            side_effect=AssertionError("shared scripts should not be re-scoped")
        )

        parent_scripts = SimpleNamespace(
            addParentJob=AsyncMock(),
            addJob=AsyncMock(),
        )
        child_scripts = SimpleNamespace(
            addParentJob=AsyncMock(),
            addJob=AsyncMock(),
        )
        parent_job = SimpleNamespace(
            id=None,
            queue=SimpleNamespace(
                name="parent",
                backend=SimpleNamespace(scripts=parent_scripts),
            ),
        )
        child_job = SimpleNamespace(
            id=None,
            queue=SimpleNamespace(
                name="child",
                backend=SimpleNamespace(scripts=child_scripts),
            ),
        )

        results = await backend.addFlow(
            [
                {"job": parent_job, "is_parent": True},
                {"job": child_job, "is_parent": False},
            ]
        )

        parent_scripts.addParentJob.assert_awaited_once_with(parent_job, pipeline)
        child_scripts.addJob.assert_awaited_once_with(child_job, pipeline)
        self.assertEqual(results, ["parent-id", "child-id"])
        self.assertEqual(parent_job.id, "parent-id")
        self.assertEqual(child_job.id, "child-id")
