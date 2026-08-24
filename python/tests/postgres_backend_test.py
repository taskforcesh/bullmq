import asyncio
import unittest
import time
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock, patch

import psycopg

from bullmq.backends.postgres_backend import _row_to_job_map
from bullmq.backends.postgres_backend import PostgresBackend
from bullmq.backends.postgres_connection import (
    PostgresConnection,
    quote_schema_name,
    run_migrations,
)
from bullmq.job import Job
from bullmq.postgres import sql_loader


class TestPostgresBackendJobMapping(unittest.TestCase):
    def test_row_to_job_map_json_encodes_plain_strings(self):
        mapped = _row_to_job_map(
            {
                "name": "job",
                "data": "foo",
                "opts": "bar",
                "progress": "baz",
                "attempts_made": 0,
                "attempts_started": 0,
                "stalled_count": 0,
                "priority": 0,
                "stacktrace": [],
                "return_value": "done",
            }
        )

        self.assertEqual(mapped["data"], '"foo"')
        self.assertEqual(mapped["opts"], '"bar"')
        self.assertEqual(mapped["progress"], '"baz"')
        self.assertEqual(mapped["returnvalue"], '"done"')

    def test_job_from_json_round_trips_plain_string_fields(self):
        mapped = _row_to_job_map(
            {
                "name": "job",
                "data": "foo",
                "opts": {},
                "progress": "baz",
                "attempts_made": 0,
                "attempts_started": 0,
                "stalled_count": 0,
                "priority": 0,
                "stacktrace": [],
                "return_value": "done",
            }
        )

        queue = SimpleNamespace(backend=None, qualifiedName="bull:test")
        job = Job.fromJSON(queue, mapped, "1")

        self.assertEqual(job.data, "foo")
        self.assertEqual(job.progress, "baz")
        self.assertEqual(job.returnvalue, "done")

    def test_client_name_includes_schema_namespace(self):
        connection = SimpleNamespace(schema="tenant_a")
        backend = PostgresBackend("queue", connection)

        self.assertEqual(backend.clientName(), "tenant_a:queue")
        self.assertEqual(backend.clientName(":w:worker"), "tenant_a:queue:w:worker")


class TestPostgresBackendFailedReason(unittest.IsolatedAsyncioTestCase):
    async def test_move_to_failed_keeps_failed_reason_as_raw_text(self):
        backend = PostgresBackend(
            "queue", cast(PostgresConnection, SimpleNamespace(schema="bull"))
        )
        backend._run = AsyncMock(return_value=SimpleNamespace())
        backend._collect_metrics = AsyncMock()
        job = cast(
            Job,
            SimpleNamespace(
                id="job-1",
                queue=SimpleNamespace(opts={}),
            ),
        )
        failed_reason = '{"code":"E_FAIL","message":"你好 🌍"}'

        await backend.moveToFailed(
            job,
            failed_reason,
            False,
            "token",
            fetch_next=False,
            fields_to_update={"stacktrace": "[]"},
        )

        call = backend._run.await_args
        self.assertIsNotNone(call)
        assert call is not None
        params = call.args[1]
        self.assertEqual(params[3], failed_reason)


class _FakeCursor:
    def __init__(self, current_version):
        self.current_version = current_version
        self.executed = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def execute(self, query, params=None):
        self.executed.append((query, params))

    async def fetchone(self):
        return (self.current_version,)


class _FakeConnection:
    def __init__(self, cursor):
        self._cursor = cursor
        self.commit = AsyncMock()

    def cursor(self):
        return self._cursor


class _CursorContext:
    def __init__(self, cursor):
        self._cursor = cursor

    async def __aenter__(self):
        return self._cursor

    async def __aexit__(self, exc_type, exc, tb):
        return False


class TestRunMigrations(unittest.IsolatedAsyncioTestCase):
    async def test_returns_last_applied_migration_version(self):
        cursor = _FakeCursor(current_version=1)
        conn = _FakeConnection(cursor)

        with patch(
            "bullmq.backends.postgres_connection.sql_loader.migration_files",
            return_value=["0002_functions.sql", "0004_extra.sql"],
        ), patch(
            "bullmq.backends.postgres_connection.sql_loader.load_migration",
            side_effect=lambda filename: f"-- {filename}",
        ):
            version = await run_migrations(conn, skip_version_check=True)

        self.assertEqual(version, 4)
        conn.commit.assert_awaited_once()


class TestPostgresConnection(unittest.IsolatedAsyncioTestCase):
    def test_quote_schema_name_error_message_mentions_dollar_signs(self):
        with self.assertRaisesRegex(
            ValueError,
            r"letters, digits, underscores, or \$",
        ):
            quote_schema_name("bad-name")

    async def test_ensure_job_channel_listens_once_per_connection(self):
        listen_conn = SimpleNamespace(closed=False, execute=AsyncMock())
        connection = PostgresConnection()

        with patch(
            "bullmq.backends.postgres_connection.psycopg.AsyncConnection.connect",
            AsyncMock(return_value=listen_conn),
        ):
            first = await connection.ensure_job_channel()
            second = await connection.ensure_job_channel()

        self.assertIs(first, second)
        listen_conn.execute.assert_awaited_once_with("LISTEN bullmq_jobs")

    async def test_ensure_job_channel_relistens_after_reconnect(self):
        first_conn = SimpleNamespace(closed=False, execute=AsyncMock())
        second_conn = SimpleNamespace(closed=False, execute=AsyncMock())
        connect = AsyncMock(side_effect=[first_conn, second_conn])
        connection = PostgresConnection()

        with patch(
            "bullmq.backends.postgres_connection.psycopg.AsyncConnection.connect",
            connect,
        ):
            await connection.ensure_job_channel()
            first_conn.closed = True
            await connection.ensure_job_channel()

        self.assertEqual(connect.await_count, 2)
        first_conn.execute.assert_awaited_once_with("LISTEN bullmq_jobs")
        second_conn.execute.assert_awaited_once_with("LISTEN bullmq_jobs")

    async def test_ensure_events_channel_listens_once_per_connection(self):
        events_conn = SimpleNamespace(closed=False, execute=AsyncMock())
        connection = PostgresConnection()

        with patch(
            "bullmq.backends.postgres_connection.psycopg.AsyncConnection.connect",
            AsyncMock(return_value=events_conn),
        ):
            first = await connection.ensure_events_channel()
            second = await connection.ensure_events_channel()

        self.assertIs(first, second)
        events_conn.execute.assert_awaited_once_with(
            sql_loader.load_command("listen_events")
        )

    async def test_events_channel_uses_a_connection_of_its_own(self):
        """The two waits must not share a connection: `notifies()` consumes a
        notification, so one wait would swallow the other's wakeups."""
        jobs_conn = SimpleNamespace(closed=False, execute=AsyncMock())
        events_conn = SimpleNamespace(closed=False, execute=AsyncMock())
        connect = AsyncMock(side_effect=[jobs_conn, events_conn])
        connection = PostgresConnection()

        with patch(
            "bullmq.backends.postgres_connection.psycopg.AsyncConnection.connect",
            connect,
        ):
            jobs = await connection.ensure_job_channel()
            events = await connection.ensure_events_channel()

        self.assertIsNot(jobs, events)
        self.assertEqual(connect.await_count, 2)
        jobs_conn.execute.assert_awaited_once_with("LISTEN bullmq_jobs")
        events_conn.execute.assert_awaited_once_with(
            sql_loader.load_command("listen_events")
        )

    async def test_reset_events_channel_forces_new_listen_connection(self):
        first_conn = SimpleNamespace(
            closed=False, execute=AsyncMock(), close=AsyncMock()
        )
        second_conn = SimpleNamespace(closed=False, execute=AsyncMock())
        connect = AsyncMock(side_effect=[first_conn, second_conn])
        connection = PostgresConnection()

        with patch(
            "bullmq.backends.postgres_connection.psycopg.AsyncConnection.connect",
            connect,
        ):
            await connection.ensure_events_channel()
            await connection.reset_events_channel()
            await connection.ensure_events_channel()

        first_conn.close.assert_awaited_once()
        self.assertEqual(connect.await_count, 2)
        second_conn.execute.assert_awaited_once_with(
            sql_loader.load_command("listen_events")
        )

    async def test_reset_job_channel_forces_new_listen_connection(self):
        first_conn = SimpleNamespace(closed=False, execute=AsyncMock(), close=AsyncMock())
        second_conn = SimpleNamespace(closed=False, execute=AsyncMock())
        connect = AsyncMock(side_effect=[first_conn, second_conn])
        connection = PostgresConnection()

        with patch(
            "bullmq.backends.postgres_connection.psycopg.AsyncConnection.connect",
            connect,
        ):
            await connection.ensure_job_channel()
            await connection.reset_job_channel()
            await connection.ensure_job_channel()

        first_conn.close.assert_awaited_once()
        self.assertEqual(connect.await_count, 2)
        second_conn.execute.assert_awaited_once_with("LISTEN bullmq_jobs")

    async def test_listen_connection_applies_last_application_name_when_created(self):
        main_cursor = SimpleNamespace(execute=AsyncMock())
        main_conn = SimpleNamespace(
            closed=False,
            cursor=lambda: _CursorContext(main_cursor),
        )
        listen_conn = SimpleNamespace(closed=False, execute=AsyncMock())
        connect = AsyncMock(side_effect=[main_conn, listen_conn])
        connection = PostgresConnection()
        connection.wait_until_ready = AsyncMock()

        with patch(
            "bullmq.backends.postgres_connection.psycopg.AsyncConnection.connect",
            connect,
        ):
            self.assertIsNone(connection._listen_conn)
            await connection.set_application_name("tenant_a:queue:w:1")
            self.assertIsNone(connection._listen_conn)
            await connection.listen_connection()

        main_cursor.execute.assert_awaited_once_with(
            "SELECT set_config('application_name', %s, false)",
            ("tenant_a:queue:w:1",),
        )
        connection.wait_until_ready.assert_awaited_once()
        listen_conn.execute.assert_awaited_once_with(
            "SELECT set_config('application_name', %s, false)",
            ("tenant_a:queue:w:1",),
        )

    async def test_listen_connection_enables_tcp_keepalives(self):
        # A worker may block on the LISTEN connection for up to an hour, so a
        # silent drop must be detected in seconds, not after the OS default
        # keepalive idle time.
        listen_conn = SimpleNamespace(closed=False, execute=AsyncMock())
        connect = AsyncMock(return_value=listen_conn)
        connection = PostgresConnection()

        with patch(
            "bullmq.backends.postgres_connection.psycopg.AsyncConnection.connect",
            connect,
        ):
            await connection.listen_connection()

        kwargs = connect.await_args.kwargs
        self.assertEqual(kwargs["keepalives"], 1)
        self.assertEqual(kwargs["keepalives_idle"], 10)

    async def test_set_application_name_updates_existing_listen_connection(self):
        main_cursor = SimpleNamespace(execute=AsyncMock())
        main_conn = SimpleNamespace(
            closed=False,
            cursor=lambda: _CursorContext(main_cursor),
        )
        listen_conn = SimpleNamespace(closed=False, execute=AsyncMock())
        connect = AsyncMock(side_effect=[listen_conn, main_conn])
        connection = PostgresConnection()
        connection.wait_until_ready = AsyncMock()

        with patch(
            "bullmq.backends.postgres_connection.psycopg.AsyncConnection.connect",
            connect,
        ):
            await connection.listen_connection()
            self.assertIsNotNone(connection._listen_conn)
            listen_conn.execute.assert_not_awaited()
            await connection.set_application_name("tenant_a:queue:w:2")

        main_cursor.execute.assert_awaited_once_with(
            "SELECT set_config('application_name', %s, false)",
            ("tenant_a:queue:w:2",),
        )
        connection.wait_until_ready.assert_awaited_once()
        listen_conn.execute.assert_awaited_once_with(
            "SELECT set_config('application_name', %s, false)",
            ("tenant_a:queue:w:2",),
        )


class _FailingNotifiesConnection:
    def __init__(self):
        self.closed = False

    def notifies(self, timeout=None, stop_after=None):
        class _Iter:
            def __aiter__(self):
                return self

            async def __anext__(self):
                raise psycopg.OperationalError("listen connection dropped")

        return _Iter()


class _IdleNotifiesConnection:
    """A LISTEN connection that never receives a NOTIFY (blocks until timeout)."""

    def __init__(self):
        self.closed = False

    def notifies(self, timeout=None, stop_after=None):
        async def _iter():
            await asyncio.sleep(timeout or 0)
            if False:
                yield

        return _iter()


class _FakeWaitConnection:
    def __init__(self):
        self.schema = "bullmq"
        self.ensure_job_channel = AsyncMock(
            side_effect=[_FailingNotifiesConnection(), _IdleNotifiesConnection()]
        )
        self.reset_job_channel = AsyncMock()


class TestPostgresBackendWaitForJob(unittest.IsolatedAsyncioTestCase):
    async def test_wait_for_job_reconnects_listen_channel_after_psycopg_error(self):
        connection = _FakeWaitConnection()
        backend = PostgresBackend("queue", connection)
        # No claimable job when the wait starts; after the dropped LISTEN
        # connection is rebuilt the probe finds the job whose NOTIFY was lost.
        backend._has_waiting_job = AsyncMock(side_effect=[False, True])
        backend._next_delay_ms = AsyncMock(return_value=None)

        marker = await backend.waitForJob(0.2)

        self.assertEqual(marker, ["bullmq_jobs", "queue", 0])
        connection.reset_job_channel.assert_awaited_once()
        self.assertEqual(connection.ensure_job_channel.await_count, 2)

    async def test_wait_for_job_does_not_poll_while_blocked(self):
        # The whole point of the large Postgres `maximumBlockTimeout` is that an
        # idle worker lets the database go quiet, so the wait must rely on
        # LISTEN/NOTIFY only — no periodic claimable-job probing.
        connection = SimpleNamespace(
            schema="bullmq",
            ensure_job_channel=AsyncMock(return_value=_IdleNotifiesConnection()),
            reset_job_channel=AsyncMock(),
        )
        backend = PostgresBackend("queue", connection)
        backend._has_waiting_job = AsyncMock(return_value=False)
        backend._next_delay_ms = AsyncMock(return_value=None)

        marker = await backend.waitForJob(0.2)

        self.assertIsNone(marker)
        self.assertEqual(backend._has_waiting_job.await_count, 1)

    async def test_wait_for_job_returns_future_marker_when_only_delayed_jobs_exist(self):
        connection = SimpleNamespace(
            schema="bullmq",
            ensure_job_channel=AsyncMock(return_value=_IdleNotifiesConnection()),
            reset_job_channel=AsyncMock(),
        )
        backend = PostgresBackend("queue", connection)
        backend._has_waiting_job = AsyncMock(return_value=False)
        backend._next_delay_ms = AsyncMock(side_effect=[500, 500])

        before = int(time.time() * 1000)
        marker = await backend.waitForJob(0.001)
        after = int(time.time() * 1000)
        expected_min = before + 400
        expected_max = after + 600

        self.assertEqual(marker[0], "bullmq_jobs")
        self.assertEqual(marker[1], "queue")
        self.assertGreaterEqual(marker[2], expected_min)
        self.assertLessEqual(marker[2], expected_max)
        self.assertEqual(backend._next_delay_ms.await_count, 2)


class _EventsFakeConnection:
    """Minimal PostgresConnection stand-in for the event-stream tests."""

    def __init__(self, notify_conns=None):
        self.schema = "bullmq"
        self.ensure_events_channel = (
            AsyncMock(side_effect=notify_conns)
            if notify_conns
            else AsyncMock(return_value=_IdleNotifiesConnection())
        )
        self.reset_events_channel = AsyncMock()


class TestPostgresBackendEventStream(unittest.IsolatedAsyncioTestCase):
    async def test_publish_event_splits_the_event_name_from_the_payload(self):
        backend = PostgresBackend("queue", SimpleNamespace(schema="bullmq"))
        backend._run = AsyncMock(
            return_value=SimpleNamespace(first_map=lambda: {"id": 42})
        )

        event_id = await backend.publishEvent(
            {"event": "custom", "foo": "bar", "n": 7}, 1000
        )

        self.assertEqual(event_id, "42")
        backend._run.assert_awaited_once_with(
            "publish_event", ["queue", "custom", '{"foo":"bar","n":7}']
        )

    async def test_read_events_resolves_the_dollar_cursor_to_the_current_max(self):
        backend = PostgresBackend("queue", SimpleNamespace(schema="bullmq"))
        backend._run = AsyncMock(
            side_effect=[
                SimpleNamespace(first_map=lambda: {"max": 7}),
                SimpleNamespace(
                    maps=lambda: [
                        {"id": 8, "event": "completed", "data": {"jobId": "1"}}
                    ]
                ),
            ]
        )

        data = await backend.readEvents("$", 10000)

        self.assertEqual(data, [("events", [("8", {"event": "completed", "jobId": "1"})])])
        self.assertEqual(backend._run.await_args_list[1].args[1][1], 7)

    async def test_read_events_stringifies_non_string_payload_values(self):
        """The Redis stream stores every field as a string; the Postgres
        adapter must match so `QueueEvents` decodes identically on both."""
        backend = PostgresBackend("queue", SimpleNamespace(schema="bullmq"))
        backend._run = AsyncMock(
            return_value=SimpleNamespace(
                maps=lambda: [
                    {
                        "id": 3,
                        "event": "delayed",
                        "data": {"jobId": "1", "delay": 1700, "ok": True},
                    }
                ]
            )
        )

        data = await backend.readEvents("2", 10000)

        self.assertEqual(
            data[0][1][0][1],
            {"event": "delayed", "jobId": "1", "delay": "1700", "ok": "true"},
        )

    async def test_read_events_returns_none_when_the_block_timeout_elapses(self):
        backend = PostgresBackend("queue", _EventsFakeConnection())
        backend._fetch_events = AsyncMock(return_value=[])

        self.assertIsNone(await backend.readEvents("1", 10))

    async def test_read_events_reconnects_the_channel_after_a_psycopg_error(self):
        connection = _EventsFakeConnection(
            [_FailingNotifiesConnection(), _IdleNotifiesConnection()]
        )
        backend = PostgresBackend("queue", connection)
        backend._fetch_events = AsyncMock(
            side_effect=[[], [], [("9", {"event": "completed"})]]
        )

        data = await backend.readEvents("1", 2000)

        self.assertEqual(data, [("events", [("9", {"event": "completed"})])])
        connection.reset_events_channel.assert_awaited_once()
        self.assertEqual(connection.ensure_events_channel.await_count, 2)

    async def test_read_events_short_circuits_once_the_backend_is_closed(self):
        backend = PostgresBackend("queue", SimpleNamespace(schema="bullmq"))
        backend._run = AsyncMock()
        backend._closing = True

        self.assertIsNone(await backend.readEvents("$", 10000))
        backend._run.assert_not_awaited()


class TestPostgresBackendQueueMeta(unittest.IsolatedAsyncioTestCase):
    async def test_set_queue_meta_sends_parallel_field_and_value_arrays(self):
        backend = PostgresBackend("queue", SimpleNamespace(schema="bullmq"))
        backend._run = AsyncMock(return_value=SimpleNamespace(rowcount=2))

        written = await backend.setQueueMeta({"max": 100, "duration": 1000})

        self.assertEqual(written, 2)
        backend._run.assert_awaited_once_with(
            "set_queue_meta",
            ["queue", ["max", "duration"], ["100", "1000"]],
        )

    async def test_get_queue_meta_fields_preserves_order_and_fills_gaps(self):
        backend = PostgresBackend("queue", SimpleNamespace(schema="bullmq"))
        # Rows come back in arbitrary order and omit fields that are unset.
        backend._run = AsyncMock(
            return_value=SimpleNamespace(
                maps=lambda: [{"field": "duration", "value": "1000"}]
            )
        )

        values = await backend.getQueueMetaFields(["max", "duration"])

        self.assertEqual(values, [None, "1000"])

    async def test_empty_field_lists_short_circuit_without_a_query(self):
        backend = PostgresBackend("queue", SimpleNamespace(schema="bullmq"))
        backend._run = AsyncMock()

        self.assertEqual(await backend.setQueueMeta({}), 0)
        self.assertEqual(await backend.getQueueMetaFields([]), [])
        self.assertEqual(await backend.removeQueueMetaFields([]), 0)
        backend._run.assert_not_awaited()


class TestPostgresBackendAddFlow(unittest.IsolatedAsyncioTestCase):
    async def test_add_flow_returns_negative_sentinels_as_ints(self):
        """`add_flow` reports a not-inserted entry with a negative code in the
        id column (-5 = missing parent). It must stay an int so `FlowProducer`
        tells it apart from a (deduplicated) string job id, exactly as it does
        for the Redis backend's Lua return value."""
        backend = PostgresBackend("queue", SimpleNamespace(schema="bullmq"))
        backend._run = AsyncMock(
            return_value=SimpleNamespace(rows=[("-5",), ("7",), ("custom-id",)])
        )
        backend._batch_entry = lambda job, is_parent: {}
        entries = [
            {"job": SimpleNamespace(id=None)},
            {"job": SimpleNamespace(id=None)},
            {"job": SimpleNamespace(id=None)},
        ]

        ids = await backend.addFlow(entries)

        self.assertEqual(ids, [-5, "7", "custom-id"])
        self.assertIsInstance(ids[0], int)
        self.assertIsInstance(ids[1], str)


class TestPostgresBackendLockExtension(unittest.IsolatedAsyncioTestCase):
    async def test_extend_locks_batches_jobs_in_one_command(self):
        backend = PostgresBackend("queue", SimpleNamespace(schema="bullmq"))
        backend._run = AsyncMock(
            return_value=SimpleNamespace(maps=lambda: [{"id": "job-2"}])
        )

        with patch("bullmq.backends.postgres_backend._now_ms", return_value=123):
            failed = await backend.extendLocks(
                ["job-1", "job-2"],
                ["token-1", "token-2"],
                5000,
            )

        self.assertEqual(failed, ["job-2"])
        backend._run.assert_awaited_once_with(
            "extend_locks",
            ["queue", ["job-1", "job-2"], ["token-1", "token-2"], 5000, 123],
        )
