import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

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
