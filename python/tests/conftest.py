"""Shared pytest fixtures.

When ``BULLMQ_TEST_BACKEND=postgres`` is set, the existing test-suite is run
against the PostgreSQL backend instead of Redis:

* every ``Queue`` / ``Worker`` / ``FlowProducer`` is transparently built on the
  Postgres adapter (by patching the ``create_backend`` the classes import), and
* the schema is wiped before each test so job-id sequences restart at 1 (the
  Postgres analogue of the Redis suite's ``flushdb`` between tests).

Without the env var everything runs against Redis exactly as before.
"""

import os

import pytest

import bullmq.backends as _backends

PG_ENABLED = os.environ.get("BULLMQ_TEST_BACKEND") == "postgres"
PG_CONNINFO = os.environ.get(
    "BULLMQ_PG_URL", "host=localhost port=5432 dbname=bullmq_test"
)
PG_SCHEMA = os.environ.get("BULLMQ_PG_SCHEMA", "bullmq")

# Test modules that are inherently Redis-specific (raw client behaviour, cluster
# discovery, Redis connection-error handling) and do not apply to Postgres.
_REDIS_ONLY_FILES = [
    "redis_connection_test.py",
    "redis_connection_cluster_test.py",
    "queue_getters_cluster_test.py",
    "worker_disconnect_test.py",
]

collect_ignore = _REDIS_ONLY_FILES if PG_ENABLED else []

# Individual tests that assert against the raw Redis client (event-stream
# ``XLEN``, key enumeration) — the underlying operations are covered by other,
# backend-agnostic tests, so these are skipped on the Postgres backend.
_REDIS_ONLY_TESTS = {
    "test_trim_events_manually",
    "test_trim_events_manually_with_custom_prefix",
    "test_drain_count_added_unprocessed_jobs",
    "test_obliterate_with_force_true_should_succeed_with_active_jobs",
}


def pytest_collection_modifyitems(config, items):
    if not PG_ENABLED:
        return
    skip = pytest.mark.skip(
        reason="Redis-specific assertion (raw client / event stream); N/A for Postgres backend"
    )
    for item in items:
        if item.name.split("[")[0] in _REDIS_ONLY_TESTS:
            item.add_marker(skip)


_real_create_backend = _backends.create_backend


def _pg_create_backend(name, opts=None, blocking=False, with_blocking_connection=False):
    merged = dict(opts or {})
    merged["backend"] = "postgres"
    merged["connection"] = PG_CONNINFO
    merged["schema"] = PG_SCHEMA
    return _real_create_backend(
        name, merged, blocking=blocking, with_blocking_connection=with_blocking_connection
    )


def _wipe_schema():
    import psycopg
    from psycopg import sql

    with psycopg.connect(PG_CONNINFO, autocommit=True) as conn:
        conn.execute(
            sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(sql.Identifier(PG_SCHEMA))
        )


@pytest.fixture(autouse=True)
def _pg_backend(monkeypatch):
    if not PG_ENABLED:
        yield
        return
    _wipe_schema()
    monkeypatch.setattr("bullmq.queue.create_backend", _pg_create_backend)
    monkeypatch.setattr("bullmq.worker.create_backend", _pg_create_backend)
    monkeypatch.setattr("bullmq.flow_producer.create_backend", _pg_create_backend)
    yield
