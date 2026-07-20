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
import socket
import sys
import time
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import redis.exceptions

from bullmq import Worker


def _find_closed_port():
    """Return a TCP port that is guaranteed to be closed at the moment
    the function returns.

    Binding to port 0 lets the OS pick a free port; we close the socket
    immediately so the port is released. There is a tiny race window
    where another process could grab the port before the Worker's
    Redis client tries to connect, but for these tests we never let
    the run loop start, so the port is only ever inspected — not
    actually connected to. This is more reliable than hard-coding a
    high port that might be in use on some CI runners.
    """
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


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
            "connection": {"host": "127.0.0.1", "port": _find_closed_port()},
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

    def test_postgres_disconnect_errors_are_transient_when_postgres_backend_is_enabled(self):
        class FakeOperationalError(Exception):
            pass

        class FakeInterfaceError(Exception):
            pass

        fake_psycopg = SimpleNamespace(
            OperationalError=FakeOperationalError,
            InterfaceError=FakeInterfaceError,
        )
        worker = Worker(
            "issue_3103_queue",
            None,
            {
                "backend": "postgres",
                "connection": {"host": "127.0.0.1", "port": _find_closed_port()},
                "autorun": False,
            },
        )

        try:
            with unittest.mock.patch.dict(sys.modules, {"psycopg": fake_psycopg}):
                self.assertTrue(worker.isConnectionError(FakeOperationalError("db down")))
                self.assertTrue(worker.isConnectionError(FakeInterfaceError("db closed")))
        finally:
            asyncio.run(worker.close(force=True))

    def test_os_error_with_aggregated_errno_message_is_transient(self):
        # Mirrors the bare OSError asyncio raises when every connect()
        # attempt fails: a single string message embedding "[Errno N]"
        # per host, with err.errno left unset. This is the exact failure
        # mode reported in issue #3103.
        err = OSError(
            f"Multiple exceptions: [Errno {errno.ECONNREFUSED}] "
            "Connect call failed ('127.0.0.1', 6379)"
        )
        self.assertIsNone(err.errno)
        self.assertTrue(self.worker.isConnectionError(err))

    def test_os_error_with_errno_attribute_is_transient(self):
        # Covers the simpler case where err.errno is populated directly.
        err = OSError(errno.ECONNRESET, "connection reset")
        self.assertTrue(self.worker.isConnectionError(err))

    def test_os_error_with_mnemonic_message_is_transient(self):
        # Some failure paths (notably hiredis-backed errors and certain
        # asyncio variants) raise an OSError whose errno is None and
        # whose message carries only the mnemonic, e.g. "ECONNREFUSED"
        # or "Connection refused", with no embedded "[Errno N]".
        for message in (
            "ECONNREFUSED",
            "[hiredis] ECONNRESET while reading",
            "Connection refused",
            "Connection reset by peer",
            "Network is unreachable",
        ):
            with self.subTest(message=message):
                err = OSError(message)
                self.assertIsNone(err.errno)
                self.assertTrue(
                    self.worker.isConnectionError(err),
                    f"OSError({message!r}) was not classified as transient",
                )

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
        self.worker.backend.waitForJob = AsyncMock(side_effect=boom)

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

    async def test_waitForJob_does_not_delay_programmer_error(self):
        # Programmer errors (e.g. ValueError) must propagate immediately.
        # Adding the connection-error backoff to every exception type
        # would silently throttle real bugs at 1-per-100ms, making them
        # much harder to diagnose in production logs.
        boom = ValueError("not a connection error")
        self.worker.backend.waitForJob = AsyncMock(side_effect=boom)

        started = time.monotonic()
        with self.assertRaises(ValueError):
            await self.worker.waitForJob()
        elapsed = time.monotonic() - started

        self.assertLess(
            elapsed,
            0.05,
            f"waitForJob delayed a programmer error by {elapsed * 1000:.1f}ms; "
            "the connection-error backoff is leaking onto non-transient errors",
        )

    async def test_waitForJob_propagates_cancelled_error_immediately(self):
        # asyncio.CancelledError implements cooperative cancellation;
        # delaying its propagation would defeat the cancel signal and
        # could keep run() alive past close(force=True).
        self.worker.backend.waitForJob = AsyncMock(side_effect=asyncio.CancelledError())

        started = time.monotonic()
        with self.assertRaises(asyncio.CancelledError):
            await self.worker.waitForJob()
        elapsed = time.monotonic() - started

        self.assertLess(elapsed, 0.05)

    async def test_waitForJob_does_not_emit_error_directly(self):
        # waitForJob must rely on retryIfFailed to emit "error" exactly
        # once per failure. Emitting from both sites caused duplicate
        # error events / log lines for a single Redis failure.
        emitted = []
        self.worker.on("error", lambda err: emitted.append(err))

        self.worker.backend.waitForJob = AsyncMock(
            side_effect=ValueError("not a connection error")
        )

        with self.assertRaises(ValueError):
            await self.worker.waitForJob()

        self.assertEqual(emitted, [])

    async def test_worker_can_be_closed_after_disconnect_errors(self):
        # After a burst of connection errors the worker must still be
        # closeable without hanging the event loop.
        self.worker.backend.waitForJob = AsyncMock(
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
