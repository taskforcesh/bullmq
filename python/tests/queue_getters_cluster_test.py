import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from bullmq import Queue


def _install_client(queue, client):
    """Point the queue's backend at a fake client and make close() a no-op.

    ``get_workers`` reaches the datastore exclusively through
    ``queue.backend.getClientList()``, which reads ``backend.connection.conn``.
    We replace that client with a fake and disable connection ownership so the
    lazily-created real connection is never touched by ``close()``.
    """
    queue.backend.connection.conn = client
    queue.backend.owns_connection = False


class TestQueueClusterGetters(unittest.IsolatedAsyncioTestCase):
    async def test_get_workers_cluster_uses_node_with_most_matches(self):
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

        _install_client(queue, cluster_client)

        workers = await queue.get_workers()
        self.assertEqual(len(workers), 2)
        self.assertTrue(node1_client.client_list.called)
        self.assertTrue(node2_client.client_list.called)

        await queue.close()

    async def test_get_workers_non_cluster(self):
        queue = Queue("test-queue", {"prefix": "bull"})

        client_list = "id=1 addr=127.0.0.1:6379 name=bull:test-queue age=10\n"
        client = SimpleNamespace(client_list=AsyncMock(return_value=client_list))

        _install_client(queue, client)

        workers = await queue.get_workers()
        self.assertEqual(len(workers), 1)
        self.assertEqual(workers[0]["name"], "test-queue")

        await queue.close()

    async def test_get_workers_uses_backend_client_name_prefix(self):
        queue = Queue("test-queue", {"prefix": "bull"})
        queue.backend.clientName = lambda suffix=None: f"tenant-a:test-queue{suffix or ''}"

        client_list = "id=1 addr=127.0.0.1:6379 name=tenant-a:test-queue:w:w1 age=10\n"
        client = SimpleNamespace(client_list=AsyncMock(return_value=client_list))
        _install_client(queue, client)

        workers = await queue.get_workers()
        self.assertEqual(len(workers), 1)
        self.assertEqual(workers[0]["rawname"], "tenant-a:test-queue:w:w1")

        await queue.close()

    async def test_get_workers_count_cluster(self):
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

        _install_client(queue, cluster_client)

        workers_count = await queue.get_workers_count()
        self.assertEqual(workers_count, 3)

        await queue.close()
