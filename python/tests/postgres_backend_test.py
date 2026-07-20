import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from bullmq.backends.postgres_backend import _row_to_job_map
from bullmq.backends.postgres_connection import PostgresConnection, run_migrations
from bullmq.job import Job


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
