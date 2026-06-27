import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from bullmq import Queue
from bullmq.queue_keys import QueueKeys


class DummyScripts:
    def __init__(self, prefix, queue_name, redis_connection):
        self.queue_keys = QueueKeys(prefix)

    def getKeys(self, name):
        return self.queue_keys.getKeys(name)


class TestQueueClusterGetters(unittest.IsolatedAsyncioTestCase):
    async def test_get_workers_cluster_uses_node_with_most_matches(self):
        with patch("bullmq.queue.Scripts", new=DummyScripts):
            queue = Queue("test-queue", {"prefix": "bull"})

            client_list_node1 = "id=1 addr=127.0.0.1:6379 name=bull:test-queue:w:w1 age=10\n"
            client_list_node2 = (
                "id=2 addr=127.0.0.1:6380 name=bull:test-queue:w:w1 age=10\n"
                "id=3 addr=127.0.0.1:6380 name=bull:test-queue:w:w2 age=5\n"
            )

            node1_client = SimpleNamespace(client_list=AsyncMock(return_value=client_list_node1))
            node2_client = SimpleNamespace(client_list=AsyncMock(return_value=client_list_node2))

            cluster_client = SimpleNamespace(
                is_cluster=True,
                nodes=lambda: [
                    SimpleNamespace(client=node1_client),
                    SimpleNamespace(client=node2_client),
                ],
            )

            queue.client = cluster_client

            workers = await queue.get_workers()
            self.assertEqual(len(workers), 2)
            self.assertTrue(node1_client.client_list.called)
            self.assertTrue(node2_client.client_list.called)

            await queue.close()

    async def test_get_workers_non_cluster(self):
        with patch("bullmq.queue.Scripts", new=DummyScripts):
            queue = Queue("test-queue", {"prefix": "bull"})

            client_list = "id=1 addr=127.0.0.1:6379 name=bull:test-queue age=10\n"
            client = SimpleNamespace(client_list=AsyncMock(return_value=client_list))

            queue.client = client

            workers = await queue.get_workers()
            self.assertEqual(len(workers), 1)
            self.assertEqual(workers[0]["name"], "test-queue")

            await queue.close()

    async def test_get_workers_count_cluster(self):
        with patch("bullmq.queue.Scripts", new=DummyScripts):
            queue = Queue("test-queue", {"prefix": "bull"})

            client_list_node1 = "id=1 addr=127.0.0.1:6379 name=bull:test-queue:w:w1 age=10\n"
            client_list_node2 = (
                "id=2 addr=127.0.0.1:6380 name=bull:test-queue:w:w1 age=10\n"
                "id=3 addr=127.0.0.1:6380 name=bull:test-queue:w:w2 age=5\n"
                "id=4 addr=127.0.0.1:6380 name=bull:test-queue:w:w3 age=5\n"
            )

            node1_client = SimpleNamespace(client_list=AsyncMock(return_value=client_list_node1))
            node2_client = SimpleNamespace(client_list=AsyncMock(return_value=client_list_node2))

            cluster_client = SimpleNamespace(
                is_cluster=True,
                nodes=lambda: [
                    SimpleNamespace(client=node1_client),
                    SimpleNamespace(client=node2_client),
                ],
            )

            queue.client = cluster_client

            workers_count = await queue.get_workers_count()
            self.assertEqual(workers_count, 3)

            await queue.close()
