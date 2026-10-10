import unittest
from types import SimpleNamespace
from typing import get_args, get_type_hints
from unittest.mock import AsyncMock, patch

from redis.asyncio.cluster import RedisCluster

from bullmq import Queue, Worker
from bullmq.redis_connection import RedisConnection
from bullmq.types import QueueBaseOptions, QueueEventsOptions, WorkerOptions


class TestRedisConnectionCluster(unittest.IsolatedAsyncioTestCase):
    async def test_set_client_name_non_cluster(self):
        connection = RedisConnection({})
        mock_pool = SimpleNamespace(connection_kwargs={})
        mock_client = SimpleNamespace(client_setname=AsyncMock(), connection_pool=mock_pool)
        connection.conn = mock_client

        await connection.set_client_name("bull:test-queue")

        mock_client.client_setname.assert_called_once_with("bull:test-queue")
        self.assertEqual(mock_pool.connection_kwargs.get("client_name"), "bull:test-queue")

    async def test_set_client_name_cluster(self):
        connection = RedisConnection({})

        node1_pool = SimpleNamespace(connection_kwargs={})
        node2_pool = SimpleNamespace(connection_kwargs={})
        node1_client = SimpleNamespace(client_setname=AsyncMock(), connection_pool=node1_pool)
        node2_client = SimpleNamespace(client_setname=AsyncMock(), connection_pool=node2_pool)

        cluster_client = SimpleNamespace(
            is_cluster=True,
            nodes=lambda: [SimpleNamespace(client=node1_client), SimpleNamespace(client=node2_client)],
        )
        connection.conn = cluster_client

        await connection.set_client_name("bull:test-queue:w:worker")

        node1_client.client_setname.assert_called_once_with("bull:test-queue:w:worker")
        node2_client.client_setname.assert_called_once_with("bull:test-queue:w:worker")
        self.assertEqual(node1_pool.connection_kwargs.get("client_name"), "bull:test-queue:w:worker")
        self.assertEqual(node2_pool.connection_kwargs.get("client_name"), "bull:test-queue:w:worker")

    async def test_accepts_a_redis_cluster_client(self):
        cluster = RedisCluster(host="localhost", port=7000)
        connection = RedisConnection(cluster)

        self.assertIs(connection.conn, cluster)
        self.assertTrue(connection.commands)

    async def test_queue_and_worker_use_a_passed_cluster_client(self):
        cluster = RedisCluster(host="localhost", port=7000)

        queue = Queue("test-queue", {"prefix": "{bull}", "connection": cluster})
        self.addAsyncCleanup(queue.close)

        async def process(job, token):
            return None

        worker = Worker(
            "test-queue",
            process,
            {"prefix": "{bull}", "connection": cluster, "autorun": False},
        )
        self.addAsyncCleanup(worker.close)

        self.assertIs(queue.backend.connection.conn, cluster)
        self.assertIs(worker.backend.connection.conn, cluster)
        self.assertIs(worker.backend.blocking_connection.conn, cluster)

    async def test_set_client_name_connects_a_lazy_cluster_client_first(self):
        cluster = RedisCluster(host="localhost", port=7000)
        connection = RedisConnection(cluster)
        node = SimpleNamespace(connection_kwargs={}, execute_command=AsyncMock())
        discovered = []

        async def initialize():
            discovered.append(node)
            return cluster

        with patch.object(cluster, "initialize", side_effect=initialize), patch.object(
            cluster, "get_nodes", side_effect=lambda: list(discovered)
        ):
            await connection.set_client_name("bull:test-queue:w:worker")

        node.execute_command.assert_awaited_once_with(
            "CLIENT", "SETNAME", "bull:test-queue:w:worker"
        )
        # New connections on the node carry the name too.
        self.assertEqual(node.connection_kwargs.get("client_name"), "bull:test-queue:w:worker")

    async def test_client_list_connects_a_lazy_cluster_client_first(self):
        cluster = RedisCluster(host="localhost", port=7000)
        queue = Queue("test-queue", {"prefix": "{bull}", "connection": cluster})
        self.addAsyncCleanup(queue.close)
        listing = "id=1 name={bull}:test-queue:w:worker"
        node = SimpleNamespace(client_list=AsyncMock(return_value=listing))
        discovered = []

        async def initialize():
            discovered.append(node)
            return cluster

        with patch.object(cluster, "initialize", side_effect=initialize), patch.object(
            cluster, "get_nodes", side_effect=lambda: list(discovered)
        ):
            self.assertEqual(await queue.backend.getClientList(), [listing])

    def test_connection_option_types_accept_a_cluster_client(self):
        for options in (QueueBaseOptions, WorkerOptions, QueueEventsOptions):
            with self.subTest(options=options.__name__):
                self.assertIn(RedisCluster, get_args(get_type_hints(options)["connection"]))


if __name__ == "__main__":
    unittest.main()
