import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from bullmq.redis_connection import RedisConnection


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
