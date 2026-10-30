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

    @patch.object(RedisConnection, 'loadCommands')
    def test_blocking_timeout_raises_default_socket_timeout(self, _mock_load):
        # redis-py >= 8 defaults socket_timeout to 5s, which is shorter than
        # the 10s BZPOPMIN a worker may issue on its blocking connection.
        conn = RedisConnection({"host": "localhost", "socket_timeout": 5}, blockingTimeout=10)
        socket_timeout = conn.conn.connection_pool.connection_kwargs["socket_timeout"]
        self.assertGreater(socket_timeout, 10)

    @patch.object(RedisConnection, 'loadCommands')
    def test_blocking_timeout_raises_url_socket_timeout(self, _mock_load):
        conn = RedisConnection("redis://localhost:6379?socket_timeout=5", blockingTimeout=10)
        socket_timeout = conn.conn.connection_pool.connection_kwargs["socket_timeout"]
        self.assertGreater(socket_timeout, 10)

    @patch.object(RedisConnection, 'loadCommands')
    def test_blocking_timeout_updates_original_socket_timeout(self, _mock_load):
        conn = RedisConnection({"host": "localhost", "socket_timeout": 5})
        connection_kwargs = conn.conn.connection_pool.connection_kwargs
        connection_kwargs["orig_socket_timeout"] = 5

        conn._ensure_socket_timeout_exceeds(10)

        self.assertGreater(connection_kwargs["socket_timeout"], 10)
        self.assertEqual(
            connection_kwargs["orig_socket_timeout"],
            connection_kwargs["socket_timeout"],
        )

    @patch.object(RedisConnection, 'loadCommands')
    def test_blocking_timeout_raises_default_url_socket_timeout(self, _mock_load):
        conn = RedisConnection("redis://localhost:6379", blockingTimeout=10)
        connection = conn.conn.connection_pool.make_connection()
        self.assertTrue(
            connection.socket_timeout is None or connection.socket_timeout > 10
        )

    @patch.object(RedisConnection, 'loadCommands')
    def test_unbounded_blocking_timeout_disables_socket_timeout(self, _mock_load):
        conn = RedisConnection(
            {"host": "localhost", "socket_timeout": 5}, blockingTimeout=0
        )
        connection_kwargs = conn.conn.connection_pool.connection_kwargs
        connection = conn.conn.connection_pool.make_connection()
        self.assertIsNone(connection.socket_timeout)
        if "orig_socket_timeout" in connection_kwargs:
            self.assertIsNone(connection_kwargs["orig_socket_timeout"])

    @patch.object(RedisConnection, 'loadCommands')
    def test_blocking_timeout_keeps_larger_or_disabled_socket_timeout(self, _mock_load):
        conn = RedisConnection({"host": "localhost", "socket_timeout": 30}, blockingTimeout=10)
        self.assertEqual(conn.conn.connection_pool.connection_kwargs["socket_timeout"], 30)
        conn = RedisConnection({"host": "localhost", "socket_timeout": None}, blockingTimeout=10)
        self.assertIsNone(conn.conn.connection_pool.connection_kwargs["socket_timeout"])

    @patch.object(RedisConnection, 'loadCommands')
    def test_socket_timeout_untouched_without_blocking_timeout(self, _mock_load):
        conn = RedisConnection({"host": "localhost", "socket_timeout": 5})
        self.assertEqual(conn.conn.connection_pool.connection_kwargs["socket_timeout"], 5)

    @patch.object(RedisConnection, 'loadCommands')
    def test_worker_blocking_connection_outlasts_long_idle_wait(self, _mock_load):
        from bullmq.backends import create_redis_backend
        backend = create_redis_backend(
            "test",
            {"connection": {"host": "localhost"}, "drainDelay": 30.5},
            with_blocking_connection=True,
        )
        blocking_kwargs = backend.blocking_connection.conn.connection_pool.connection_kwargs
        socket_timeout = blocking_kwargs.get(
            "socket_timeout", blocking_kwargs.get("orig_socket_timeout")
        )
        self.assertTrue(socket_timeout is None or socket_timeout > 31)

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

    @patch.object(RedisConnection, 'loadCommands')
    def test_skip_flags_persist_when_set(self, _mock_load):
        conn = RedisConnection(
            {"host": "localhost"},
            skipVersionCheck=True,
        )
        self.assertTrue(conn.skipVersionCheck)

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
