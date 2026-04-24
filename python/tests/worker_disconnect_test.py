"""
Regression tests for the Redis-disconnect handling in the Worker class.

See https://github.com/taskforcesh/bullmq/issues/3103 — when Redis becomes
unavailable (e.g. the server is stopped) the Python worker used to enter
a tight error loop, flooding stderr with tracebacks and starving the
application's event loop. The fixes live in ``bullmq/worker.py`` and
consist of:

* broader ``isConnectionError`` classification, so Redis' ``TimeoutError``,
  ``BusyLoadingError`` and bare ``OSError``/``asyncio.TimeoutError`` are
  all treated as transient connection failures;
* a short backoff inside ``waitForJob`` before transient errors are
  re-raised, mirroring the Node.js worker;
* a short backoff inside ``retryIfFailed`` when ``only_emit_error`` is
  set and a non-connection error is swallowed, so the outer main loop
  cannot busy-spin on repeated errors.

These tests exercise those paths with mocks so they do not require a
running Redis instance.
"""

import asyncio
import errno
import time
import unittest
from unittest.mock import AsyncMock, MagicMock

import redis.exceptions

from bullmq import Worker


def _build_offline_worker():
    """Create a Worker whose Redis port is guaranteed to be closed.

    The Worker is instantiated with ``autorun=False`` so the run loop
    never starts; callers drive the pieces of the worker they want to
    exercise directly.
    """
    return Worker(
        "issue_3103_queue",
        None,
        {
            "connection": {"host": "127.0.0.1", "port": 59999},
            "autorun": False,
            "runRetryDelay": 50,
        },
    )


class TestIsConnectionError(unittest.TestCase):
    """``isConnectionError`` must classify all transient Redis failures."""

    def setUp(self):
        self.worker = _build_offline_worker()

    def tearDown(self):
        # Ensure the worker does not keep asyncio resources dangling; we
        # never started run() so close() is a best-effort cleanup.
        asyncio.run(self.worker.close(force=True))

    def test_redis_connection_error_is_transient(self):
        err = redis.exceptions.ConnectionError("connection reset")
        self.assertTrue(self.worker.isConnectionError(err))

    def test_redis_timeout_error_is_transient(self):
        err = redis.exceptions.TimeoutError("Timeout reading from socket")
        self.assertTrue(self.worker.isConnectionError(err))

    def test_redis_busy_loading_error_is_transient(self):
        err = redis.exceptions.BusyLoadingError("Redis is loading the dataset")
        self.assertTrue(self.worker.isConnectionError(err))

    def test_builtin_connection_refused_error_is_transient(self):
        err = ConnectionRefusedError(errno.ECONNREFUSED, "refused")
        self.assertTrue(self.worker.isConnectionError(err))

    def test_asyncio_timeout_is_transient(self):
        self.assertTrue(self.worker.isConnectionError(asyncio.TimeoutError()))

    def test_os_error_with_econnrefused_message_is_transient(self):
        # Mirrors the bare OSError raised by asyncio before the redis
        # client has a chance to wrap it.
        err = OSError(
            "Multiple exceptions: [Errno 61] Connect call failed "
            "('127.0.0.1', 6379) - ECONNREFUSED"
        )
        self.assertTrue(self.worker.isConnectionError(err))

    def test_plain_value_error_is_not_transient(self):
        # Programmer errors must still bubble up so users can fix them.
        self.assertFalse(self.worker.isConnectionError(ValueError("bug")))


class TestRetryIfFailedDoesNotBusyLoop(unittest.IsolatedAsyncioTestCase):
    """``retryIfFailed`` must not tight-loop on either error class."""

    async def asyncSetUp(self):
        self.worker = _build_offline_worker()

    async def asyncTearDown(self):
        await self.worker.close(force=True)

    async def test_connection_error_triggers_delayed_retry(self):
        # ``runRetryDelay`` is 50ms for this worker; a single retry must
        # take at least that long. If the fix regresses and the loop
        # spins without sleeping this assertion will fail. We cap the
        # retry count by raising a non-connection error on the second
        # attempt so the coroutine terminates.
        calls = []

        async def flaky():
            calls.append(time.monotonic())
            if len(calls) == 1:
                raise redis.exceptions.ConnectionError("redis down")
            return "recovered"

        started = time.monotonic()
        result = await self.worker.retryIfFailed(
            flaky,
            {"delay_in_ms": 50, "only_emit_error": True},
        )
        elapsed = time.monotonic() - started

        self.assertEqual(result, "recovered")
        self.assertEqual(len(calls), 2)
        # We slept at least once between the two attempts.
        self.assertGreaterEqual(elapsed, 0.045)

    async def test_non_connection_error_with_only_emit_error_is_paced(self):
        # This is the specific path that busy-looped before the fix:
        # ``only_emit_error=True`` caused ``retryIfFailed`` to return
        # ``None`` immediately, and the outer worker loop would then
        # re-enter with no delay.
        attempts = []
        emitted = []

        self.worker.on("error", lambda err: emitted.append(err))

        async def always_fails():
            attempts.append(time.monotonic())
            raise ValueError("not a connection error")

        started = time.monotonic()
        # Drive the same call-pattern the outer loop uses: repeatedly
        # wrap the failing function in ``retryIfFailed`` and see how
        # many times we can complete it within a bounded wall-clock
        # budget. With the fix each call sleeps for ``short_retry_delay``
        # (100ms) so we should see far fewer than, say, 200 attempts in
        # a second. Without the fix attempts would be CPU-bound.
        budget = 0.6
        max_calls = 40
        while (
            time.monotonic() - started < budget
            and len(attempts) < max_calls
        ):
            await self.worker.retryIfFailed(
                always_fails,
                {"delay_in_ms": 5_000, "only_emit_error": True},
            )

        # Sanity: we at least tried once, and the error was emitted.
        self.assertGreaterEqual(len(attempts), 1)
        self.assertGreaterEqual(len(emitted), 1)
        # The important assertion: attempts are rate-limited. We budget
        # 600ms and expect roughly one attempt per 100ms, so definitely
        # fewer than 20.
        self.assertLess(
            len(attempts),
            20,
            f"retryIfFailed is busy-looping: {len(attempts)} attempts "
            f"in {budget * 1000:.0f}ms",
        )


class TestWaitForJobBacksOff(unittest.IsolatedAsyncioTestCase):
    """``waitForJob`` should sleep briefly before re-raising errors."""

    async def asyncSetUp(self):
        self.worker = _build_offline_worker()

    async def asyncTearDown(self):
        await self.worker.close(force=True)

    async def test_waitForJob_delays_before_raising_connection_error(self):
        # Replace the blocking command with one that raises immediately.
        boom = redis.exceptions.ConnectionError("redis down")
        self.worker.bclient = MagicMock()
        self.worker.bclient.bzpopmin = AsyncMock(side_effect=boom)

        started = time.monotonic()
        with self.assertRaises(redis.exceptions.ConnectionError):
            await self.worker.waitForJob()
        elapsed = time.monotonic() - started

        # ``short_retry_delay`` is 100ms. Allow a generous lower bound
        # so the test is not flaky on slow CI.
        self.assertGreaterEqual(
            elapsed,
            0.05,
            f"waitForJob re-raised after only {elapsed * 1000:.1f}ms; "
            "the short backoff did not kick in",
        )

    async def test_worker_can_be_closed_after_disconnect_errors(self):
        # After a burst of connection errors the worker must still be
        # closeable without hanging the event loop.
        self.worker.bclient = MagicMock()
        self.worker.bclient.bzpopmin = AsyncMock(
            side_effect=redis.exceptions.ConnectionError("redis down")
        )

        for _ in range(3):
            with self.assertRaises(redis.exceptions.ConnectionError):
                await self.worker.waitForJob()

        # If close() is well-behaved this finishes promptly; otherwise
        # pytest's 30s timeout will fire.
        await self.worker.close(force=True)
        self.assertTrue(self.worker.closed)


if __name__ == "__main__":
    unittest.main()
