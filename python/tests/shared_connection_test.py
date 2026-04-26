"""
Tests for sharing a ``redis.asyncio.Redis`` instance with ``Queue`` and
``Worker``.

The blocking client used for ``BZPOPMIN`` cannot share a socket with the
regular command client; sharing one causes the blocking command to
monopolise the socket and corrupt replies of subsequent commands. These
tests cover:

* ``RedisConnection`` honours the caller's ownership of an externally
  supplied Redis client (``shared=True``) and never closes it;
* ``isBlocking=True`` derives a dedicated sibling client from the
  caller's pool and treats that sibling as our own to release;
* a ``Worker`` built from a shared client exposes distinct underlying
  clients for regular vs blocking commands.
"""

import unittest
from unittest.mock import MagicMock, patch

import redis.asyncio as redis

from bullmq.redis_connection import RedisConnection
from bullmq.worker import Worker


def _make_fake_redis():
    """Build a MagicMock that passes ``isinstance(obj, redis.Redis)``.

    The class is spec'ed against ``redis.Redis`` so attribute access
    matches the real client. ``client()`` returns a fresh sibling mock
    to simulate a dedicated connection, mirroring the redis-py
    behaviour.
    """
    client = MagicMock(spec=redis.Redis)
    # Make isinstance(client, redis.Redis) return True.
    client.__class__ = redis.Redis
    client.client = MagicMock(
        side_effect=lambda: _make_fake_redis_sibling()
    )
    return client


def _make_fake_redis_sibling():
    sibling = MagicMock(spec=redis.Redis)
    sibling.__class__ = redis.Redis
    return sibling


class TestSharedConnection(unittest.TestCase):
    """Behaviour of RedisConnection when handed an external Redis client."""

    @patch.object(RedisConnection, 'loadCommands')
    def test_shared_flag_set_when_reusing_caller_client(self, _mock_load):
        client = _make_fake_redis()
        conn = RedisConnection(client)
        self.assertTrue(conn.shared)
        self.assertIs(conn.conn, client)

    @patch.object(RedisConnection, 'loadCommands')
    def test_shared_flag_unset_when_blocking_derives_sibling(self, _mock_load):
        # The blocking sibling is created by us, not handed in by the
        # caller, so it must be eligible for cleanup in close().
        client = _make_fake_redis()
        conn = RedisConnection(client, isBlocking=True)
        self.assertFalse(conn.shared)
        self.assertIsNot(conn.conn, client)

    @patch.object(RedisConnection, 'loadCommands')
    def test_blocking_calls_redis_client_to_derive_sibling(self, _mock_load):
        client = _make_fake_redis()
        RedisConnection(client, isBlocking=True)
        client.client.assert_called_once_with()

    @patch.object(RedisConnection, 'loadCommands')
    def test_close_leaves_caller_client_open(self, _mock_load):
        import asyncio
        client = _make_fake_redis()
        conn = RedisConnection(client)
        asyncio.run(conn.close())
        client.aclose.assert_not_called()

    @patch.object(RedisConnection, 'loadCommands')
    def test_close_releases_derived_blocking_sibling(self, _mock_load):
        # The sibling is owned by us, so close() must release it.
        import asyncio
        client = _make_fake_redis()
        conn = RedisConnection(client, isBlocking=True)
        sibling = conn.conn
        asyncio.run(conn.close())
        sibling.aclose.assert_awaited_once()
        client.aclose.assert_not_called()

    @patch.object(RedisConnection, 'loadCommands')
    def test_shared_disconnect_is_a_noop(self, _mock_load):
        # redis.asyncio.Redis instances do not expose disconnect()
        # directly, so the early-return must fire before any attribute
        # access on the caller's client.
        client = _make_fake_redis()
        conn = RedisConnection(client)
        self.assertIsNone(conn.disconnect())

    @patch.object(RedisConnection, 'loadCommands')
    def test_worker_isolates_blocking_client_from_shared_caller_client(
        self, _mock_load
    ):
        # Patch out Lua-script registration and the autorun timer so we
        # don't spin up an event loop during construction.
        with patch('bullmq.worker.Scripts'), \
                patch('bullmq.worker.Timer'):
            client = _make_fake_redis()
            worker = Worker(
                'test-queue',
                None,
                {"connection": client, "autorun": False},
            )

            self.assertIsNotNone(worker.redisConnection)
            self.assertIsNotNone(worker.blockingRedisConnection)

            # The regular connection reuses the caller's client and is
            # left alone on close(). The blocking connection is derived
            # from the caller's pool but owned by us, so close() releases
            # it without touching the caller's client.
            self.assertTrue(worker.redisConnection.shared)
            self.assertFalse(worker.blockingRedisConnection.shared)

            self.assertIs(worker.client, client)
            self.assertIsNot(worker.bclient, client)
            self.assertIsNot(worker.bclient, worker.client)

            import asyncio
            asyncio.run(worker.close(force=True))
            client.aclose.assert_not_called()
            worker.bclient.aclose.assert_awaited()


if __name__ == '__main__':
    unittest.main()
