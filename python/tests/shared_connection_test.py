"""
Regression tests for issue #3401.

When a user passes the SAME ``redis.asyncio.Redis`` instance to both
``Queue`` and ``Worker``, the worker's blocking client (used for
``BZPOPMIN``) must not share its underlying socket with the regular
command client. Otherwise the blocking command monopolises the socket
and corrupts replies of subsequent commands, surfacing as empty job
data and a ``None`` job name inside the processor.

These tests exercise ``RedisConnection`` and ``Worker`` construction
with a shared client and verify that:

1. A ``Worker`` created from an externally-supplied ``redis.Redis``
   instance uses a distinct underlying ``conn`` for blocking commands
   than the one used for regular commands.
2. A shared ``RedisConnection`` never closes or disconnects the
   caller-owned client.
3. The non-blocking shared ``RedisConnection`` still exposes the exact
   same client instance the caller provided (so it is genuinely
   shared).
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


class TestSharedConnectionBlockingDuplication(unittest.TestCase):
    """Issue #3401 regression tests."""

    @patch.object(RedisConnection, 'loadCommands')
    def test_shared_flag_set_when_client_is_external(self, _mock_load):
        client = _make_fake_redis()
        conn = RedisConnection(client)
        self.assertTrue(conn.shared)

    @patch.object(RedisConnection, 'loadCommands')
    def test_non_blocking_shared_reuses_caller_client(self, _mock_load):
        client = _make_fake_redis()
        conn = RedisConnection(client, isBlocking=False)
        self.assertIs(conn.conn, client)
        client.client.assert_not_called()

    @patch.object(RedisConnection, 'loadCommands')
    def test_blocking_shared_does_not_reuse_caller_client(self, _mock_load):
        """The blocking wrapper MUST NOT reuse the caller's client.

        This is the core of the bug fix: with a shared client, the
        blocking connection has to derive a dedicated socket via
        ``Redis.client()`` so that ``BZPOPMIN`` does not starve and
        interleave replies of subsequent commands.
        """
        client = _make_fake_redis()
        conn = RedisConnection(client, isBlocking=True)
        self.assertIsNot(conn.conn, client)
        client.client.assert_called_once_with()

    @patch.object(RedisConnection, 'loadCommands')
    def test_shared_close_does_not_close_caller_client(self, _mock_load):
        import asyncio
        client = _make_fake_redis()
        conn = RedisConnection(client)
        asyncio.run(conn.close())
        client.aclose.assert_not_called()

    @patch.object(RedisConnection, 'loadCommands')
    def test_shared_disconnect_is_a_noop(self, _mock_load):
        """disconnect() must not touch a caller-owned client.

        ``redis.asyncio.Redis`` instances do not expose ``disconnect``
        directly, so the pre-fix code would have attempted it on the
        user's pool. We simply assert the call returns cleanly and the
        shared flag is honoured.
        """
        client = _make_fake_redis()
        conn = RedisConnection(client)
        # Must not raise and must not touch the client.
        result = conn.disconnect()
        self.assertIsNone(result)

    @patch.object(RedisConnection, 'loadCommands')
    def test_worker_blocking_connection_is_isolated_when_sharing_client(
        self, _mock_load
    ):
        """End-to-end check for issue #3401.

        When a single ``redis.Redis`` instance is handed to both
        ``Queue`` and ``Worker``, the worker's blocking client must be
        a different Redis wrapper than its regular command client.
        """
        # Patch out the Lua-script registration path that Scripts runs
        # during Worker construction, and the autorun so we don't spin
        # up an event loop.
        with patch('bullmq.worker.Scripts'), \
                patch('bullmq.worker.Timer'):
            client = _make_fake_redis()
            worker = Worker(
                'test-queue',
                None,
                {"connection": client, "autorun": False},
            )

            # Both connections exist.
            self.assertIsNotNone(worker.redisConnection)
            self.assertIsNotNone(worker.blockingRedisConnection)

            # They must be flagged as shared (externally owned).
            self.assertTrue(worker.redisConnection.shared)
            self.assertTrue(worker.blockingRedisConnection.shared)

            # CRITICAL: the regular client is the caller's client,
            # but the blocking client is a distinct instance so that
            # BZPOPMIN does not corrupt replies of regular commands.
            self.assertIs(worker.client, client)
            self.assertIsNot(worker.bclient, client)
            self.assertIsNot(worker.bclient, worker.client)


if __name__ == '__main__':
    unittest.main()
