"""PostgreSQL implementation of the :class:`~bullmq.backend.Backend` contract.

The heavy lifting lives in language-agnostic SQL: the schema and PL/pgSQL
operation functions are applied by :mod:`bullmq.backends.postgres_connection`
from the shared ``migrations/*.sql``, and every runtime operation runs a
parameterized statement from ``commands/*.sql`` (loaded by
:mod:`bullmq.postgres.sql_loader`). This adapter only builds the parameter
lists and maps result rows into the same shapes the high-level BullMQ classes
already consume from the Redis backend.

The connection-level ``schema`` is the namespace for all queues (the SQL-native
replacement for the Redis key ``prefix``), so the ``.sql`` files reference
unqualified names and stay portable.
"""

from __future__ import annotations

import json
import time
from typing import Any, Optional, TYPE_CHECKING

import psycopg

from bullmq.backend import Backend
from bullmq.backends.postgres_connection import PostgresConnection
from bullmq.custom_errors import UnrecoverableError
from bullmq.postgres import sql_loader

if TYPE_CHECKING:
    from bullmq.job import Job

minimum_block_timeout = 0.001

# Job states stored as the enum value in bullmq_job.state; the high-level
# classes sometimes use Redis list names ("wait", "paused") that map here.
_STATE_ALIASES = {"wait": "waiting", "paused": "waiting"}

# List-backed states in Redis (returned newest-first; reversed for ascending).
_LIST_STATES = frozenset({"wait", "waiting", "active", "paused"})

# Capabilities reported to the worker (Postgres can block for arbitrary ms).
_CAPABILITIES = {"canBlockFor1Ms": True, "canDoubleTimeout": True}

# SQLSTATE the PL/pgSQL operation functions raise on domain errors; the DETAIL
# carries the negative error code shared with the Redis backend.
_BULLMQ_SQLSTATE = "BM001"


def _bm_error(code: int, command: str, job_id=None, parent_key=None, state=None):
    """Build the exception matching the Redis backend's error for ``code``."""
    if code == -1:
        return TypeError(f"Missing key for job {job_id}. {command}")
    if code == -2:
        return TypeError(f"Missing lock for job {job_id}. {command}")
    if code == -3:
        return TypeError(f"Job {job_id} is not in the {state} state. {command}")
    if code == -4:
        return TypeError(f"Job {job_id} has pending dependencies. {command}")
    if code == -5:
        return TypeError(f"Missing key for parent job {parent_key}. {command}")
    if code == -6:
        return TypeError(f"Lock mismatch for job {job_id}. Cmd {command} from {state}")
    if code == -7:
        return TypeError(f"The parent job {job_id} cannot be replaced. {command}")
    if code == -9:
        return UnrecoverableError(
            f"Cannot complete job {job_id} because it has at least one failed child. {command}"
        )
    return TypeError(f"Unknown code {code} error for {job_id}. {command}")


def _now_ms() -> int:
    return int(time.time() * 1000)


def _jsonb(value: Any) -> str:
    """Serialize a value for a ``$n::jsonb`` parameter.

    Uses ``allow_nan=False`` so non-JSON-compliant floats raise ``ValueError``
    before hitting the database (matching the Redis backend).
    """
    return json.dumps(value, separators=(",", ":"), allow_nan=False)


def _json(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, str):
        return value
    return json.dumps(value, separators=(",", ":"), allow_nan=False)


def _opt_str(value: Any) -> Optional[str]:
    return None if value is None else str(value)


def _to_int(value: Any) -> int:
    if value is None:
        return 0
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    try:
        return int(str(value))
    except (TypeError, ValueError):
        return 0


def _row_to_job_map(row: dict) -> dict:
    """Map a ``bullmq_job`` row into the Redis-hash-shaped dict ``Job.fromJSON``
    consumes (JSON-string values for the object fields, string values for the
    rest; ``None`` fields are dropped)."""
    parent_id = row.get("parent_id")
    parent = (
        _json({"id": parent_id, "queueKey": row.get("parent_queue") or ""})
        if parent_id is not None
        else None
    )
    mapped = {
        "name": row.get("name"),
        "data": _json(row.get("data") if row.get("data") is not None else {}),
        "opts": _json(row.get("opts") if row.get("opts") is not None else {}),
        "progress": _json(row.get("progress") if row.get("progress") is not None else 0),
        "attemptsMade": str(row.get("attempts_made") or 0),
        "ats": str(row.get("attempts_started") or 0),
        "stc": str(row.get("stalled_count") or 0),
        "timestamp": _opt_str(row.get("added_at_ms")),
        "delay": _opt_str(row.get("delay_ms")),
        "priority": str(row.get("priority") or 0),
        "processedOn": _opt_str(row.get("processed_at_ms")),
        "finishedOn": _opt_str(row.get("finished_at_ms")),
        "failedReason": row.get("failed_reason"),
        "stacktrace": _json(row.get("stacktrace") if row.get("stacktrace") is not None else []),
        "returnvalue": _json(row.get("return_value")),
        "parentKey": row.get("parent_key"),
        "parent": parent,
        "processedBy": row.get("processed_by"),
        "rjk": row.get("scheduler_id"),
        "deid": row.get("dedup_id"),
        "defa": row.get("deferred_failure"),
    }
    return {k: v for k, v in mapped.items() if v is not None}


def _normalize_keep(remove_on: Any) -> tuple[bool, Optional[int], Optional[int]]:
    """Normalize ``removeOnComplete``/``removeOnFail`` into
    ``(remove_all, keep_age, keep_count)``."""
    if remove_on is True:
        return (True, None, None)
    if remove_on is False or remove_on is None:
        return (False, None, None)
    if isinstance(remove_on, int):
        return (False, None, remove_on)
    if isinstance(remove_on, dict):
        return (False, remove_on.get("age"), remove_on.get("count"))
    return (False, None, None)


class PostgresBackend(Backend):
    """PostgreSQL adapter implementing :class:`~bullmq.backend.Backend`."""

    def __init__(
        self,
        name: str,
        connection: PostgresConnection,
        owns_connection: bool = True,
    ):
        self.queue_name = name
        self.connection = connection
        self.owns_connection = owns_connection
        self.schema = connection.schema
        self._ready = False

    async def _run(self, command: str, params: list, *, op=None, job_id=None, parent_key=None, state=None):
        try:
            return await self.connection.run(sql_loader.load_command(command), params)
        except psycopg.Error as err:
            if op and getattr(err, "sqlstate", None) == _BULLMQ_SQLSTATE:
                detail = err.diag.message_detail if err.diag else None
                code = int(detail) if detail else 0
                raise _bm_error(code, op, job_id, parent_key, state) from None
            raise

    # ============================================================
    # Connection lifecycle
    # ============================================================

    async def waitUntilReady(self) -> Any:
        await self.connection.wait_until_ready()
        self._ready = True

    async def close(self, force: bool = False) -> None:
        if self.owns_connection:
            await self.connection.close()

    async def disconnect(self) -> None:
        await self.close(force=True)

    async def setName(self, name: str) -> None:
        await self.connection.set_application_name(name)

    def forQueue(self, queue_name: str, prefix: Optional[str] = None) -> "PostgresBackend":
        return PostgresBackend(queue_name, self.connection, owns_connection=False)

    @property
    def minimumBlockTimeout(self) -> float:
        return minimum_block_timeout

    @property
    def capabilities(self) -> dict:
        return _CAPABILITIES

    # ============================================================
    # Identity & keys (schema-based namespace: no prefix)
    # ============================================================

    @property
    def qualifiedName(self) -> str:
        return self.queue_name

    @property
    def keys(self) -> dict:
        return {}

    def toKey(self, type: str) -> str:
        return f"{self.queue_name}:{type}"

    def clientName(self, suffix: Optional[str] = None) -> str:
        return f"{self.queue_name}{suffix or ''}"

    # ============================================================
    # Adding jobs
    # ============================================================

    def _batch_entry(self, job: "Job", add_to_waiting_children: bool) -> dict:
        opts = job.opts or {}
        parent = getattr(job, "parent", None)
        parent_queue = None
        parent_id = None
        if parent:
            parent_queue = parent.get("queue") or parent.get("queueKey")
            parent_id = parent.get("id")
        # A flow spans multiple queues, so each entry's queue comes from the
        # job's own queue (not this backend's queue name). Use an explicit None
        # check so an empty queue name is preserved rather than falling back.
        job_queue_name = getattr(getattr(job, "queue", None), "name", None)
        queue = job_queue_name if job_queue_name is not None else self.queue_name
        return {
            "queue": queue,
            "id": job.id or "",
            "name": job.name,
            "data": job.data if job.data is not None else {},
            "opts": opts,
            "priority": opts.get("priority", 0),
            "delay": getattr(job, "delay", 0) or opts.get("delay", 0),
            "timestamp": getattr(job, "timestamp", None) or _now_ms(),
            "attempts": opts.get("attempts", 1),
            "parentQueue": parent_queue,
            "parentId": parent_id,
            "parentKey": getattr(job, "parentKey", None),
            "dedupId": getattr(job, "deduplication_id", None),
            "schedulerId": getattr(job, "repeatJobKey", None),
            "lifo": opts.get("lifo", False),
            "addToWaitingChildren": add_to_waiting_children,
        }

    async def addJob(self, job: "Job") -> str:
        opts = job.opts or {}
        parent = getattr(job, "parent", None)
        parent_queue = None
        parent_id = None
        if parent:
            parent_queue = parent.get("queue") or parent.get("queueKey")
            parent_id = parent.get("id")
        result = await self._run(
            "add_job",
            [
                self.queue_name,
                job.id or "",
                job.name,
                _jsonb(job.data if job.data is not None else {}),
                _jsonb(opts),
                opts.get("priority", 0),
                getattr(job, "delay", 0) or opts.get("delay", 0),
                getattr(job, "timestamp", None) or _now_ms(),
                getattr(job, "attempts", None) or opts.get("attempts", 1),
                parent_queue,
                parent_id,
                getattr(job, "parentKey", None),
                getattr(job, "deduplication_id", None),
                getattr(job, "repeatJobKey", None),
                opts.get("lifo", False),
            ],
            op="addJob",
            job_id=job.id,
            parent_key=getattr(job, "parentKey", None),
        )
        return str(result.first_map()["id"])

    async def addJobs(self, jobs: list["Job"]) -> list[str]:
        entries = [self._batch_entry(job, False) for job in jobs]
        independent = all(
            e["parentId"] is None and e["parentQueue"] is None and e["dedupId"] is None
            for e in entries
        )
        if independent:
            result = await self._run("add_jobs_bulk", [self.queue_name, _jsonb(entries)])
        else:
            result = await self._run("add_flow", [_jsonb(entries)], op="addJob")
        ids = [str(row[0]) for row in result.rows]
        for index, job_id in enumerate(ids):
            jobs[index].id = job_id
        return ids

    async def addFlow(self, entries: list[dict]) -> list[str]:
        batch = [self._batch_entry(e["job"], e.get("is_parent", False)) for e in entries]
        result = await self._run("add_flow", [_jsonb(batch)], op="addJob")
        ids = [str(row[0]) for row in result.rows]
        for index, job_id in enumerate(ids):
            entries[index]["job"].id = job_id
        return ids

    # ============================================================
    # Job state transitions
    # ============================================================

    def _limiter(self, opts: dict) -> tuple[Optional[int], Optional[int]]:
        limiter = opts.get("limiter") or {}
        return limiter.get("max"), limiter.get("duration")

    async def _next_job_result(self, rows_maps: list[dict], limiter_max, now: int) -> list:
        if rows_maps:
            row = rows_maps[0]
            return [_row_to_job_map(row), str(row["id"]), 0, 0]
        sig = (await self._run("next_signal", [self.queue_name, limiter_max, now])).first_map() or {}
        ttl = _to_int(sig.get("rate_limit_ttl"))
        if ttl > 0:
            return [None, "", ttl, 0]
        return [None, "", 0, _to_int(sig.get("next_delay"))]

    async def moveToActive(self, token: str, opts: dict) -> list:
        lock_duration = opts.get("lockDuration", 30000)
        name = opts.get("name")
        limiter_max, limiter_duration = self._limiter(opts)
        now = _now_ms()
        result = await self._run(
            "move_to_active",
            [self.queue_name, token, lock_duration, now, name, limiter_max, limiter_duration],
        )
        return await self._next_job_result(result.maps(), limiter_max, now)

    async def moveToCompleted(
        self, job: "Job", return_value: Any, remove_on_complete: Any, token: str, fetch_next: bool = True
    ) -> Any:
        remove_all, keep_age, keep_count = _normalize_keep(remove_on_complete)
        finished_on = _now_ms()
        opts = getattr(getattr(job, "queue", None), "opts", {}) or {}
        if fetch_next:
            lock_duration = opts.get("lockDuration", 30000)
            name = opts.get("name")
            limiter_max, limiter_duration = self._limiter(opts)
            now = _now_ms()
            result = await self._run(
                "move_to_completed_fetch",
                [
                    self.queue_name, job.id, token, _jsonb(_return_value(return_value)),
                    finished_on, remove_all, keep_age, keep_count,
                    lock_duration, now, name, limiter_max, limiter_duration,
                ],
                op="moveToFinished", job_id=job.id, state="active",
            )
            await self._collect_metrics("completed", finished_on, opts)
            nxt = await self._next_job_result(result.maps(), limiter_max, now)
            return {"result": nxt, "finishedOn": finished_on}
        await self._run(
            "move_to_completed",
            [self.queue_name, job.id, token, _jsonb(_return_value(return_value)),
             finished_on, remove_all, keep_age, keep_count],
            op="moveToFinished", job_id=job.id, state="active",
        )
        await self._collect_metrics("completed", finished_on, opts)
        return {"result": None, "finishedOn": finished_on}

    async def moveToFailed(
        self, job: "Job", failed_reason: str, remove_on_fail: Any, token: str,
        fetch_next: bool = True, fields_to_update: Optional[dict] = None,
    ) -> Any:
        remove_all, keep_age, keep_count = _normalize_keep(remove_on_fail)
        finished_on = _now_ms()
        stacktrace = (fields_to_update or {}).get("stacktrace")
        # The Redis backend stores the reason JSON-encoded (a quoted string).
        reason = json.dumps(str(failed_reason), separators=(",", ":"))
        opts = getattr(getattr(job, "queue", None), "opts", {}) or {}
        if fetch_next:
            lock_duration = opts.get("lockDuration", 30000)
            name = opts.get("name")
            limiter_max, limiter_duration = self._limiter(opts)
            now = _now_ms()
            result = await self._run(
                "move_to_failed_fetch",
                [
                    self.queue_name, job.id, token, reason,
                    stacktrace, finished_on, remove_all, keep_age, keep_count,
                    lock_duration, now, name, limiter_max, limiter_duration,
                ],
                op="moveToFinished", job_id=job.id, state="active",
            )
            await self._collect_metrics("failed", finished_on, opts)
            nxt = await self._next_job_result(result.maps(), limiter_max, now)
            return {"result": nxt, "finishedOn": finished_on}
        await self._run(
            "move_to_failed",
            [self.queue_name, job.id, token, reason, stacktrace,
             finished_on, remove_all, keep_age, keep_count],
            op="moveToFinished", job_id=job.id, state="active",
        )
        await self._collect_metrics("failed", finished_on, opts)
        return {"result": None, "finishedOn": finished_on}

    async def _collect_metrics(self, kind: str, timestamp: int, opts: dict) -> None:
        # Metrics are only tracked when configured (mirrors the Redis backend,
        # which skips collection when no ``metrics.maxDataPoints`` is set), so
        # the common path avoids an extra round-trip per finished job.
        metrics = (opts or {}).get("metrics")
        if not metrics:
            return
        max_data_points = metrics.get("maxDataPoints", 0) or 0
        try:
            await self._run(
                "collect_metrics", [self.queue_name, kind, max_data_points, timestamp]
            )
        except Exception:
            pass

    async def moveToDelayed(
        self, job_id: str, timestamp: int, delay: int, token: str = "0", opts: dict = {}
    ) -> Any:
        process_at = timestamp + delay
        opts = opts or {}
        fields = opts.get("fieldsToUpdate") or {}
        stacktrace = fields.get("stacktrace")
        await self._run(
            "move_to_delayed",
            [
                self.queue_name, job_id, token or "0", process_at, delay,
                opts.get("skipAttempt", False),
                fields.get("failedReason"),
                _jsonb(json.loads(stacktrace)) if isinstance(stacktrace, str) else None,
            ],
            op="moveToFinished", job_id=job_id, state="active",
        )
        if opts.get("fetchNext") and token and token != "0":
            worker_opts = opts.get("workerOpts") or {}
            nxt = await self.moveToActive(token, worker_opts)
            if nxt and nxt[0]:
                return nxt
            return None
        return None

    async def moveToWaitingChildren(self, job_id: str, token: str, opts: dict) -> bool:
        row = (await self._run("move_to_waiting_children", [self.queue_name, job_id, token])).first_map() or {}
        return row.get("code") == 1

    async def retryJob(self, job_id: str, lifo: bool, token: str = "0", opts: dict = {}) -> Any:
        fields = (opts or {}).get("fieldsToUpdate") or {}
        await self._run(
            "retry_job",
            [self.queue_name, job_id, token or "", lifo, fields.get("failedReason"), fields.get("stacktrace")],
            op="retryJob", job_id=job_id, state="active",
        )
        return None

    async def reprocessJob(self, job: "Job", state: str, opts: dict = {}) -> Any:
        row = (await self._run(
            "reprocess_job",
            [
                self.queue_name, job.id, str(state),
                (opts or {}).get("lifo", False),
                (opts or {}).get("resetAttemptsMade", False),
                (opts or {}).get("resetAttemptsStarted", False),
            ],
        )).first_map() or {}
        return row.get("code")

    async def promote(self, job_id: str) -> Any:
        row = (await self._run("promote", [self.queue_name, job_id], op="promote", job_id=job_id, state="delayed")).first_map() or {}
        return row.get("code")

    async def moveStalledJobsToWait(self, max_stalled_count: int, stalled_interval: int) -> list[str]:
        result = await self._run(
            "move_stalled_jobs_to_wait",
            [self.queue_name, max_stalled_count, _now_ms(), stalled_interval],
        )
        return [str(m["id"]) for m in result.maps()]

    # ============================================================
    # Bulk admin transitions
    # ============================================================

    async def retryJobs(self, state: str, count: int, timestamp: int) -> Any:
        row = (await self._run(
            "retry_jobs",
            [self.queue_name, state or "failed", count or 1000, timestamp or _now_ms()],
        )).first_map() or {}
        return _to_int(row.get("n"))

    async def promoteJobs(self, count: int) -> Any:
        row = (await self._run("promote_jobs", [self.queue_name, count or 1000])).first_map() or {}
        return _to_int(row.get("n"))

    async def pause(self, paused: bool = True) -> Any:
        await self._run("pause", [self.queue_name, paused])
        return None

    async def drain(self, delayed: bool = False) -> Any:
        await self._run("drain", [self.queue_name, delayed])
        return None

    async def cleanJobsInSet(self, set: str, grace: int = 0, limit: int = 0) -> list:
        timestamp = _now_ms() - grace
        result = await self._run("clean", [self.queue_name, set, timestamp, limit])
        return [str(m["id"]) for m in result.maps()]

    async def obliterate(self, count: int, force: bool = False) -> Any:
        row = (await self._run("obliterate", [self.queue_name, count, force])).first_map() or {}
        cursor = row.get("cursor")
        code = _to_int(cursor)
        if code == -1:
            raise Exception("Cannot obliterate non-paused queue")
        if code == -2:
            raise Exception("Cannot obliterate queue with active jobs")
        return cursor

    async def remove(self, job_id: str, remove_children: bool) -> Any:
        row = (await self._run("remove", [self.queue_name, job_id, remove_children])).first_map() or {}
        return _to_int(row.get("n"))

    # ============================================================
    # Locks
    # ============================================================

    async def extendLock(self, job_id: str, token: str, duration: int) -> Any:
        row = (await self._run("extend_lock", [self.queue_name, job_id, token, duration, _now_ms()])).first_map() or {}
        return _to_int(row.get("n"))

    async def extendLocks(self, job_ids: list[str], tokens: list[str], duration: int) -> list:
        now = _now_ms()
        failed = []
        for job_id, token in zip(job_ids, tokens):
            row = (await self._run("extend_lock", [self.queue_name, job_id, token, duration, now])).first_map() or {}
            if _to_int(row.get("n")) <= 0:
                failed.append(job_id)
        return failed

    # ============================================================
    # Job mutations
    # ============================================================

    async def updateData(self, job_id: str, data: Any) -> Any:
        result = await self._run("update_data", [self.queue_name, job_id, _jsonb(data)])
        if not result.rows:
            raise _bm_error(-1, "updateData", job_id=job_id)
        return None

    async def updateProgress(self, job_id: str, progress: Any) -> Any:
        await self._run("update_progress", [self.queue_name, job_id, _jsonb(progress)], op="updateProgress", job_id=job_id)
        return None

    async def changePriority(self, job_id: str, priority: int = 0, lifo: bool = False) -> Any:
        await self._run("change_priority", [self.queue_name, job_id, priority, lifo], op="changePriority", job_id=job_id)
        return None

    async def addLog(self, job_id: str, log_row: str, keep_logs: int = 0) -> int:
        row = (await self._run("add_log", [self.queue_name, job_id, log_row])).first_map() or {}
        count = _to_int(row.get("idx")) + 1
        if keep_logs and count > keep_logs:
            await self._run("trim_logs", [self.queue_name, job_id, count - keep_logs])
            return keep_logs
        return count

    # ============================================================
    # Queue / job queries
    # ============================================================

    async def getState(self, job_id: str) -> str:
        row = (await self._run("get_state", [self.queue_name, job_id])).first_map()
        if row is None:
            return "unknown"
        if row.get("state") == "waiting" and _to_int(row.get("priority")) > 0:
            return "prioritized"
        return row.get("state")

    async def isJobInState(self, state: str, job_id: str) -> bool:
        target = _STATE_ALIASES.get(state, state)
        row = (await self._run("is_job_in_state", [self.queue_name, job_id, target])).first_map() or {}
        return bool(row.get("present"))

    async def getJobData(self, job_id: str) -> Optional[dict]:
        row = (await self._run("get_job_data", [self.queue_name, job_id])).first_map()
        if row is None:
            return None
        return _row_to_job_map(row)

    async def getJobLogs(self, job_id: str, start: int = 0, end: int = -1, asc: bool = True) -> dict:
        count = _to_int((await self._run("get_job_logs_count", [self.queue_name, job_id])).first_map().get("count"))
        frm = max(count + start, 0) if start < 0 else start
        to = count + end if end < 0 else end
        limit = to - frm + 1
        if limit <= 0:
            return {"logs": [], "count": count}
        command = "get_job_logs_asc" if asc else "get_job_logs_desc"
        result = await self._run(command, [self.queue_name, job_id, frm, limit])
        return {"logs": [m["row"] for m in result.maps()], "count": count}

    async def getRateLimitTtl(self) -> int:
        row = (await self._run("get_rate_limit_ttl", [self.queue_name, 0, _now_ms()])).first_map() or {}
        return _to_int(row.get("ttl"))

    async def getCounts(self, types: list) -> list:
        lookup = await self._count_lookup()
        return [lookup.get("wait" if t == "waiting" else t, 0) for t in types]

    async def _count_lookup(self) -> dict:
        row = (await self._run("get_counts", [self.queue_name])).first_map() or {}
        waiting = _to_int(row.get("waiting"))
        is_paused = str(row.get("paused")) == "1"
        return {
            "active": _to_int(row.get("active")),
            "completed": _to_int(row.get("completed")),
            "failed": _to_int(row.get("failed")),
            "delayed": _to_int(row.get("delayed")),
            "wait": 0 if is_paused else waiting,
            "waiting": 0 if is_paused else waiting,
            "prioritized": _to_int(row.get("prioritized")),
            "waiting-children": _to_int(row.get("waiting-children")),
            "paused": waiting if is_paused else 0,
        }

    async def getCountsPerPriority(self, priorities: list) -> list:
        result = await self._run("get_counts_per_priority", [self.queue_name, list(priorities)])
        return [_to_int(m.get("cnt")) for m in result.maps()]

    async def getRanges(self, types: list, start: int = 0, end: int = 1, asc: bool = False) -> list:
        ids: list = []
        for t in types:
            result = await self._run("get_range", [self.queue_name, t, start, end, asc])
            page = [m["id"] for m in result.maps()]
            # List-backed states (wait/active/paused) are returned newest-first
            # by the SQL; reverse to FIFO when ascending order is requested
            # (the sorted-set states honour `asc` in SQL directly).
            if asc and t in _LIST_STATES:
                page.reverse()
            ids += page
        return ids

    async def getProcessedChildrenValues(self, job_id: str) -> dict:
        result = await self._run("get_processed_children_values", [self.queue_name, job_id])
        out = {}
        for m in result.maps():
            key = m.get("child_key") or m.get("k")
            value = m.get("value") if m.get("value") is not None else m.get("v")
            out[key] = _json(value)
        return out

    async def isPaused(self) -> bool:
        row = (await self._run("get_queue_meta_field", [self.queue_name, "paused"])).first_map()
        return bool(row) and str(row.get("value")) == "1"

    async def getClientList(self) -> list[str]:
        result = await self._run("get_client_list", [])
        lines = "\n".join(f"name={m['application_name']}" for m in result.maps())
        return [lines]

    # ============================================================
    # Queue metadata & maintenance keys
    # ============================================================

    async def trimEvents(self, max_length: int) -> Any:
        return None

    async def removeDeprecatedPriorityKey(self) -> Any:
        return None

    # ============================================================
    # Worker blocking primitive
    # ============================================================

    async def _has_waiting_job(self) -> bool:
        row = (await self._run("has_waiting_job", [self.queue_name])).first_map() or {}
        return bool(row.get("present"))

    async def _next_delay_ms(self) -> Optional[int]:
        row = (await self._run("next_delay", [self.queue_name])).first_map() or {}
        nxt = row.get("next_delay")
        return None if nxt is None else _to_int(nxt) - _now_ms()

    async def waitForJob(self, block_timeout: float) -> Any:
        listen_conn = await self.connection.listen_connection()
        await listen_conn.execute("LISTEN bullmq_jobs")

        marker = ["bullmq_jobs", self.queue_name, 0]
        if await self._has_waiting_job():
            return marker

        base_ms = max(round(block_timeout * 1000), 1)
        due_in = await self._next_delay_ms()
        if due_in is not None:
            if due_in <= 0:
                return marker
            base_ms = min(due_in, base_ms)

        deadline = time.monotonic() + base_ms / 1000
        # A NOTIFY on the shared channel wakes us instantly; a short poll of the
        # claimable-job probe is a robust fallback (delivery of a NOTIFY that
        # fires between waits is not guaranteed to reach a blocked reader).
        poll = 0.25
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return None
            wait = min(poll, remaining)
            try:
                async for notify in listen_conn.notifies(timeout=wait, stop_after=1):
                    if notify.payload == self.queue_name:
                        return marker
            except Exception:
                pass
            if await self._has_waiting_job():
                return marker


def create_postgres_backend(
    name: str,
    opts: dict = {},
    blocking: bool = False,
    with_blocking_connection: bool = False,
) -> PostgresBackend:
    """Backend factory: build a :class:`PostgresBackend` for ``name``."""
    connection = PostgresConnection(opts)
    return PostgresBackend(name, connection)


def _return_value(value: Any) -> Any:
    """Normalize a completed job's return value for jsonb storage.

    :class:`~bullmq.job.Job` pre-serializes it to a JSON string; the worker path
    passes the raw object. Decode a JSON string back so it is stored as real
    jsonb rather than a quoted string literal.
    """
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return value
    return value
