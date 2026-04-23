import unittest
from unittest.mock import patch

from bullmq.redis_connection import RedisConnection


class TestRedisConnectionSingleClient(unittest.TestCase):
    @patch.object(RedisConnection, 'loadCommands')
    def test_dict_opts_uses_single_connection(self, _mock_load):
        conn = RedisConnection({"host": "localhost"})
        self.assertTrue(conn.conn.single_connection_client)

    @patch.object(RedisConnection, 'loadCommands')
    def test_url_opts_uses_single_connection(self, _mock_load):
        conn = RedisConnection("redis://localhost:6379")
        self.assertTrue(conn.conn.single_connection_client)

    @patch.object(RedisConnection, 'loadCommands')
    def test_caller_single_connection_client_does_not_raise(self, _mock_load):
        # Passing single_connection_client in redisOpts should not cause
        # TypeError from duplicate keyword argument
        conn = RedisConnection({"host": "localhost", "single_connection_client": False})
        self.assertTrue(conn.conn.single_connection_client)
