import unittest
from unittest.mock import patch

from bullmq.redis_connection import RedisConnection
from bullmq.utils import isRedisVersionLowerThan


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

class TestRedisConnectionGetRedisVersion(unittest.IsolatedAsyncioTestCase):
    @patch.object(RedisConnection, 'loadCommands')
    async def test_get_redis_version_returns_none_when_info_lacks_redis_version(self, _mock_load):
        # Some Redis-compatible hosts (e.g. certain managed services) may not
        # surface a ``redis_version`` field. ``getRedisVersion`` should return
        # ``None`` in that case rather than raising.
        from unittest.mock import AsyncMock
        conn = RedisConnection({"host": "localhost"})
        conn.conn = AsyncMock()
        conn.conn.info = AsyncMock(return_value={"maxmemory_policy": "noeviction"})

        version = await conn.getRedisVersion()

        self.assertIsNone(version)
        self.assertIsNone(conn.version)
        # capabilities should still be set; with an unknown version we treat
        # the server as "modern" (i.e. not lower than any minimum we check).
        self.assertTrue(conn.capabilities["canBlockFor1Ms"])
        self.assertTrue(conn.capabilities["canDoubleTimeout"])

    @patch.object(RedisConnection, 'loadCommands')
    async def test_get_redis_version_returns_string_when_info_has_redis_version(self, _mock_load):
        from unittest.mock import AsyncMock
        conn = RedisConnection({"host": "localhost"})
        conn.conn = AsyncMock()
        conn.conn.info = AsyncMock(return_value={
            "redis_version": "7.2.0",
            "maxmemory_policy": "noeviction",
        })

        version = await conn.getRedisVersion()

        self.assertEqual(version, "7.2.0")
        self.assertEqual(conn.version, "7.2.0")
        self.assertTrue(conn.capabilities["canBlockFor1Ms"])
        self.assertTrue(conn.capabilities["canDoubleTimeout"])

class TestIsRedisVersionLowerThan(unittest.TestCase):
    def test_returns_false_when_current_version_is_none(self):
        # Treat unknown version as "modern" so callers that propagate a
        # missing redis_version do not crash.
        self.assertFalse(isRedisVersionLowerThan(None, '6.0.0'))

    def test_returns_true_when_current_below_minimum(self):
        self.assertTrue(isRedisVersionLowerThan('5.0.0', '6.0.0'))

    def test_returns_false_when_current_at_or_above_minimum(self):
        self.assertFalse(isRedisVersionLowerThan('6.0.0', '6.0.0'))
        self.assertFalse(isRedisVersionLowerThan('7.2.0', '6.0.0'))

class TestRedisConnectionSkipFlags(unittest.IsolatedAsyncioTestCase):
    @patch.object(RedisConnection, 'loadCommands')
    def test_default_skip_flags_are_false(self, _mock_load):
        conn = RedisConnection({"host": "localhost"})
        self.assertFalse(conn.skipVersionCheck)
        self.assertFalse(conn.skipWaitingForReady)

    @patch.object(RedisConnection, 'loadCommands')
    def test_skip_flags_persist_when_set(self, _mock_load):
        conn = RedisConnection(
            {"host": "localhost"},
            skipVersionCheck=True,
            skipWaitingForReady=True,
        )
        self.assertTrue(conn.skipVersionCheck)
        self.assertTrue(conn.skipWaitingForReady)

    @patch.object(RedisConnection, 'loadCommands')
    async def test_skip_version_check_short_circuits_get_redis_version(self, _mock_load):
        # When skipVersionCheck is True, getRedisVersion should NOT call info()
        # and should report the documented minimum supported version.
        from unittest.mock import AsyncMock
        conn = RedisConnection(
            {"host": "localhost"},
            skipVersionCheck=True,
        )
        conn.conn = AsyncMock()
        conn.conn.info = AsyncMock(side_effect=AssertionError(
            "info() should not be called when skipVersionCheck is True"
        ))

        version = await conn.getRedisVersion()

        self.assertEqual(version, RedisConnection.minimum_version)
        self.assertEqual(conn.version, RedisConnection.minimum_version)
        # capabilities should still be populated based on the assumed version.
        self.assertIn("canBlockFor1Ms", conn.capabilities)
        self.assertIn("canDoubleTimeout", conn.capabilities)

