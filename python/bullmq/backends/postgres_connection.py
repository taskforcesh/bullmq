"""PostgreSQL connection resources for the Postgres backend.

Owns:

* an async connection used for regular queries (serialized behind a lock), and
* a dedicated, long-lived ``LISTEN`` connection used by the blocking
  "wait for job" primitive (lazily established).

The connection-level ``schema`` is the namespace for all queues (the SQL-native
replacement for the Redis key ``prefix``). It is pinned on every connection's
``search_path`` so the ``.sql`` command files reference unqualified, portable
names.
"""

from __future__ import annotations

import asyncio
import re
from typing import Any, Optional

import psycopg
from psycopg.conninfo import make_conninfo

from bullmq.postgres import sql_loader

DEFAULT_SCHEMA = "bullmq"

# Transaction-scoped advisory lock that serializes migrations across processes.
# The integer spells `BULL` (0x42554c4c); every runtime uses the exact same key.
MIGRATION_ADVISORY_LOCK_KEY = 0x42554C4C  # 1112493644

# Highest schema version this build understands (0001_schema, 0002_functions).
LATEST_SCHEMA_VERSION = 2

# Lowest supported PostgreSQL major version.
MINIMUM_POSTGRES_VERSION = 13

# The shared ``.sql`` command files use native ``$1`` numbered placeholders;
# psycopg binds ``%s``. This rewrites ``$N`` to ``%s`` (preserving occurrence
# order and repeats) and escapes any literal ``%``.
_PLACEHOLDER_RE = re.compile(r"\$(\d+)")

# ``--`` line comments (the command files describe their ``$N`` params in a
# header comment, which must not be mistaken for real placeholders).
_LINE_COMMENT_RE = re.compile(r"--[^\n]*")


def _to_pyformat(sql: str, params: list) -> tuple[str, list]:
    sql = _LINE_COMMENT_RE.sub("", sql)
    out: list[str] = []
    new_params: list = []
    last = 0
    for match in _PLACEHOLDER_RE.finditer(sql):
        out.append(sql[last:match.start()].replace("%", "%%"))
        out.append("%s")
        new_params.append(params[int(match.group(1)) - 1])
        last = match.end()
    out.append(sql[last:].replace("%", "%%"))
    return "".join(out), new_params


class UnsupportedPostgresVersionError(Exception):
    pass


class PgResult:
    """A lightweight query result: column names, rows, and affected-row count."""

    __slots__ = ("columns", "rows", "rowcount")

    def __init__(self, columns: list[str], rows: list[tuple], rowcount: int):
        self.columns = columns
        self.rows = rows
        self.rowcount = rowcount

    def first_map(self) -> Optional[dict]:
        """The first row as a ``column -> value`` dict, or ``None``."""
        if not self.rows:
            return None
        return dict(zip(self.columns, self.rows[0]))

    def maps(self) -> list[dict]:
        """All rows as ``column -> value`` dicts."""
        return [dict(zip(self.columns, row)) for row in self.rows]


def quote_schema_name(schema: str) -> str:
    """Validate a schema name and return it double-quoted for safe DDL."""
    if not re.match(r"^[A-Za-z_][A-Za-z0-9_$]*$", schema) or len(schema) > 63:
        raise ValueError(
            f"BullMQ: invalid PostgreSQL schema name {schema!r}. "
            "Use a simple identifier (letters, digits, underscores; max 63 chars)."
        )
    return f'"{schema}"'


async def run_migrations(
    conn: "psycopg.AsyncConnection", schema: str = DEFAULT_SCHEMA, skip_version_check: bool = False
) -> int:
    """Bring the database schema up to :data:`LATEST_SCHEMA_VERSION`.

    Runs inside a single transaction guarded by a per-schema advisory lock so
    concurrent starters migrate exactly once. ``conn`` must not be autocommit.
    """
    quoted = quote_schema_name(schema)
    async with conn.cursor() as cur:
        if not skip_version_check:
            await cur.execute("SELECT current_setting('server_version_num')")
            server_num = int((await cur.fetchone())[0])
            major = server_num // 10000
            if major < MINIMUM_POSTGRES_VERSION:
                raise UnsupportedPostgresVersionError(
                    f"BullMQ: the PostgreSQL backend requires server version "
                    f"{MINIMUM_POSTGRES_VERSION} or newer (server reports major {major})."
                )

        await cur.execute(
            "SELECT pg_advisory_xact_lock(%s, hashtext(%s))",
            (MIGRATION_ADVISORY_LOCK_KEY, schema),
        )
        await cur.execute(f"CREATE SCHEMA IF NOT EXISTS {quoted}")
        await cur.execute(f"SET LOCAL search_path TO {quoted}")
        await cur.execute(
            "CREATE TABLE IF NOT EXISTS bullmq_migration ("
            "version integer PRIMARY KEY, name text NOT NULL, "
            "applied_at timestamptz NOT NULL DEFAULT now())"
        )
        await cur.execute("SELECT COALESCE(MAX(version), 0)::int FROM bullmq_migration")
        current = (await cur.fetchone())[0]

        for filename in sql_loader.migration_files():
            version = int(filename.split("_", 1)[0])
            if version > current:
                await cur.execute(sql_loader.load_migration(filename))
                await cur.execute(
                    "INSERT INTO bullmq_migration (version, name) VALUES (%s, %s)",
                    (version, filename),
                )
                current = version

    await conn.commit()
    return current


class PostgresConnection:
    """Owns a Postgres connection + a lazily-established dedicated LISTEN connection."""

    def __init__(self, opts: dict = {}):
        connection = opts.get("connection", {})
        self.schema = opts.get("schema", DEFAULT_SCHEMA)
        self.skip_version_check = opts.get("skipVersionCheck", False)
        quoted = quote_schema_name(self.schema)

        if isinstance(connection, str):
            self.conninfo = connection
        else:
            params: dict[str, Any] = {}
            if connection.get("host") is not None:
                params["host"] = connection["host"]
            if connection.get("port") is not None:
                params["port"] = connection["port"]
            dbname = connection.get("dbname") or connection.get("database")
            if dbname is not None:
                params["dbname"] = dbname
            if connection.get("user") is not None:
                params["user"] = connection["user"]
            if connection.get("password") is not None:
                params["password"] = connection["password"]
            self.conninfo = make_conninfo(**params)

        # Pin search_path so the .sql files use unqualified, portable names.
        self._options = f"-c search_path={quoted}"
        self._conn: Optional[psycopg.AsyncConnection] = None
        self._conn_lock = asyncio.Lock()
        self._ready = False
        self._ready_lock = asyncio.Lock()
        self._listen_conn: Optional[psycopg.AsyncConnection] = None

    async def wait_until_ready(self) -> None:
        if self._ready:
            return
        async with self._ready_lock:
            if self._ready:
                return
            # Migrations need a single dedicated (non-autocommit) session so the
            # advisory lock and the DDL share one transaction.
            migration_conn = await psycopg.AsyncConnection.connect(
                self.conninfo, autocommit=False
            )
            try:
                await run_migrations(migration_conn, self.schema, self.skip_version_check)
            finally:
                await migration_conn.close()
            self._ready = True

    async def _get_conn(self) -> "psycopg.AsyncConnection":
        if self._conn is None or self._conn.closed:
            self._conn = await psycopg.AsyncConnection.connect(
                self.conninfo, autocommit=True, options=self._options
            )
        return self._conn

    async def run(self, sql: str, params: list) -> PgResult:
        if not self._ready:
            await self.wait_until_ready()
        query, query_params = _to_pyformat(sql, params)
        # A single connection per backend, serialized by a lock. Concurrency
        # across queues/workers comes from their separate connections; the
        # blocking wait uses its own dedicated connection (see below), so it
        # never holds this lock.
        async with self._conn_lock:
            conn = await self._get_conn()
            async with conn.cursor() as cur:
                await cur.execute(query, query_params)
                if cur.description:
                    columns = [d.name for d in cur.description]
                    rows = await cur.fetchall()
                    return PgResult(columns, rows, cur.rowcount)
                return PgResult([], [], cur.rowcount)

    async def listen_connection(self) -> "psycopg.AsyncConnection":
        """The dedicated autocommit connection used for LISTEN/NOTIFY waits."""
        if self._listen_conn is None or self._listen_conn.closed:
            self._listen_conn = await psycopg.AsyncConnection.connect(
                self.conninfo, autocommit=True, options=self._options
            )
        return self._listen_conn

    async def set_application_name(self, name: str) -> None:
        if not name:
            return
        if not self._ready:
            await self.wait_until_ready()
        async with self._conn_lock:
            conn = await self._get_conn()
            async with conn.cursor() as cur:
                await cur.execute("SELECT set_config('application_name', %s, false)", (name,))

    async def close(self) -> None:
        if self._listen_conn is not None:
            try:
                await self._listen_conn.close()
            except Exception:
                pass
            self._listen_conn = None
        if self._conn is not None:
            try:
                await self._conn.close()
            except Exception:
                pass
            self._conn = None
