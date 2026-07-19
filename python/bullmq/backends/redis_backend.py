"""Redis implementation of the :class:`~bullmq.backend.Backend` contract.

This adapter carries the queue identity (name / prefix) and a reference to the
connection(s) it uses:

* ``connection`` -- the main :class:`~bullmq.redis_connection.RedisConnection`
  used for every non-blocking command (directly or via Lua scripts).
* ``blocking_connection`` -- an optional dedicated blocking connection used for
  the worker's ``BZPOPMIN`` marker wait, which must not stall pooled commands.

The adapter delegates the high-level operations to the
:class:`~bullmq.scripts.Scripts` (Lua) helper and performs the remaining
direct-Redis operations (client list, rate-limit ttl, job logs, event trim,
blocking wait, ...) itself.
"""

from __future__ import annotations

from typing import Any, Optional, TYPE_CHECKING

from bullmq.backend import Backend
from bullmq.redis_connection import RedisConnection
from bullmq.scripts import Scripts
from bullmq.utils import (
    is_redis_cluster,
    get_cluster_nodes,
    get_node_client,
)

if TYPE_CHECKING:
    from bullmq.job import Job

# Smallest meaningful block timeout (seconds) when the server supports 1ms blocks.
minimum_block_timeout = 0.001

# States stored in a Redis sorted set (looked up by score) vs. a list.
_ZSET_STATES = frozenset(
    {"completed", "failed", "delayed", "waiting-children", "prioritized"}
)


class RedisBackend(Backend):
    """Redis adapter implementing :class:`~bullmq.backend.Backend`."""

    def __init__(
        self,
        name: str,
        connection: RedisConnection,
        blocking_connection: Optional[RedisConnection] = None,
        prefix: str = "bull",
        owns_connection: bool = True,
    ):
        self.name = name
        self.prefix = prefix
        self.connection = connection
        self.blocking_connection = blocking_connection
        self.owns_connection = owns_connection
        self.scripts = Scripts(prefix, name, connection)

    # -- Convenience accessors (Redis-specific; used internally / by tests) --
    @property
    def conn(self):
        """The raw main Redis client."""
        return self.connection.conn

    @property
    def bclient(self):
        """The raw dedicated blocking Redis client (falls back to the main one)."""
        return (self.blocking_connection or self.connection).conn

    # ============================================================
    # Connection lifecycle
    # ============================================================

    async def waitUntilReady(self) -> Any:
        return await self.connection.conn.ping()

    async def close(self, force: bool = False) -> None:
        if self.blocking_connection is not None:
            try:
                await self.blocking_connection.close()
            except Exception:
                if not force:
                    raise
        if self.owns_connection:
            await self.connection.close()

    async def disconnect(self) -> None:
        await self.close(force=True)

    async def setName(self, name: str) -> None:
        await self.connection.set_client_name(name)
        if self.blocking_connection is not None:
            await self.blocking_connection.set_client_name(name)

    def forQueue(self, queue_name: str, prefix: Optional[str] = None) -> "RedisBackend":
        return RedisBackend(
            queue_name,
            self.connection,
            blocking_connection=None,
            prefix=prefix or self.prefix,
            owns_connection=False,
        )

    @property
    def minimumBlockTimeout(self) -> float:
        return (
            minimum_block_timeout
            if self.capabilities.get("canBlockFor1Ms", True)
            else 0.002
        )

    @property
    def capabilities(self) -> dict:
        # The worker bounds its blocking wait using the blocking connection's
        # capabilities; fall back to the main connection otherwise.
        return (self.blocking_connection or self.connection).capabilities

    # ============================================================
    # Identity & keys
    # ============================================================

    @property
    def qualifiedName(self) -> str:
        return self.scripts.queue_keys.getQueueQualifiedName(self.name)

    @property
    def keys(self) -> dict:
        return self.scripts.keys

    def toKey(self, type: str) -> str:
        return self.scripts.toKey(type)

    def clientName(self, suffix: Optional[str] = None) -> str:
        return f"{self.qualifiedName}{suffix or ''}"

    # ============================================================
    # Adding jobs
    # ============================================================

    async def addJob(self, job: "Job") -> str:
        return await self.scripts.addJob(job)

    async def addJobs(self, jobs: list["Job"]) -> list[str]:
        async with self.connection.conn.pipeline(transaction=True) as pipe:
            for job in jobs:
                await self.scripts.addJob(job, pipe)
            job_ids = await pipe.execute()
        for index, job_id in enumerate(job_ids):
            jobs[index].id = job_id
        return job_ids

    async def addFlow(self, entries: list[dict]) -> list[str]:
        async with self.connection.conn.pipeline(transaction=True) as pipe:
            for entry in entries:
                job = entry["job"]
                # A single Scripts instance is reused across the flow's queues,
                # so re-scope its keys to each node's queue before adding.
                self.scripts.resetQueueKeys(job.queue.name)
                if entry.get("is_parent"):
                    await self.scripts.addParentJob(job, pipe)
                else:
                    await self.scripts.addJob(job, pipe)
            results = await pipe.execute()
        for index, job_id in enumerate(results):
            entries[index]["job"].id = job_id
        return results

    # ============================================================
    # Job state transitions
    # ============================================================

    async def moveToActive(self, token: str, opts: dict) -> list:
        return await self.scripts.moveToActive(token, opts)

    async def moveToCompleted(
        self,
        job: "Job",
        return_value: Any,
        remove_on_complete: Any,
        token: str,
        fetch_next: bool = True,
    ) -> Any:
        keys, args = self.scripts.moveToCompletedArgs(
            job, return_value, remove_on_complete, token, fetch_next
        )
        result = await self.scripts.moveToFinished(job.id, keys, args)
        # ``args[1]`` is the finished-on timestamp computed while building args.
        return {"result": result, "finishedOn": args[1]}

    async def moveToFailed(
        self,
        job: "Job",
        failed_reason: str,
        remove_on_fail: Any,
        token: str,
        fetch_next: bool = True,
        fields_to_update: Optional[dict] = None,
    ) -> Any:
        keys, args = self.scripts.moveToFailedArgs(
            job, failed_reason, remove_on_fail, token, fetch_next, fields_to_update
        )
        result = await self.scripts.moveToFinished(job.id, keys, args)
        return {"result": result, "finishedOn": args[1]}

    async def moveToDelayed(
        self,
        job_id: str,
        timestamp: int,
        delay: int,
        token: str = "0",
        opts: dict = {},
    ) -> Any:
        return await self.scripts.moveToDelayed(job_id, timestamp, delay, token, opts)

    async def moveToWaitingChildren(self, job_id: str, token: str, opts: dict) -> bool:
        return await self.scripts.moveToWaitingChildren(job_id, token, opts)

    async def retryJob(
        self, job_id: str, lifo: bool, token: str = "0", opts: dict = {}
    ) -> Any:
        return await self.scripts.retryJob(job_id, lifo, token, opts)

    async def reprocessJob(self, job: "Job", state: str, opts: dict = {}) -> Any:
        return await self.scripts.reprocessJob(job, state, opts)

    async def promote(self, job_id: str) -> Any:
        return await self.scripts.promote(job_id)

    async def moveStalledJobsToWait(
        self, max_stalled_count: int, stalled_interval: int
    ) -> list[str]:
        return await self.scripts.moveStalledJobsToWait(
            max_stalled_count, stalled_interval
        )

    # ============================================================
    # Bulk admin transitions
    # ============================================================

    async def retryJobs(self, state: str, count: int, timestamp: int) -> Any:
        return await self.scripts.retryJobs(state, count, timestamp)

    async def promoteJobs(self, count: int) -> Any:
        return await self.scripts.promoteJobs(count)

    async def pause(self, paused: bool = True) -> Any:
        return await self.scripts.pause(paused)

    async def drain(self, delayed: bool = False) -> Any:
        return await self.scripts.drain(delayed)

    async def cleanJobsInSet(self, set: str, grace: int = 0, limit: int = 0) -> list:
        return await self.scripts.cleanJobsInSet(set, grace, limit)

    async def obliterate(self, count: int, force: bool = False) -> Any:
        return await self.scripts.obliterate(count, force)

    async def remove(self, job_id: str, remove_children: bool) -> Any:
        return await self.scripts.remove(job_id, remove_children)

    # ============================================================
    # Locks
    # ============================================================

    async def extendLock(self, job_id: str, token: str, duration: int) -> Any:
        return await self.scripts.extendLock(job_id, token, duration)

    async def extendLocks(
        self, job_ids: list[str], tokens: list[str], duration: int
    ) -> list:
        multi = self.connection.conn.pipeline()
        for job_id, token in zip(job_ids, tokens):
            # The registered script is async; awaiting it buffers the command
            # onto the pipeline (it does not execute until multi.execute()).
            await self.scripts.extendLock(job_id, token, duration, multi)
        return await multi.execute()

    # ============================================================
    # Job mutations
    # ============================================================

    async def updateData(self, job_id: str, data: Any) -> Any:
        return await self.scripts.updateData(job_id, data)

    async def updateProgress(self, job_id: str, progress: Any) -> Any:
        return await self.scripts.updateProgress(job_id, progress)

    async def changePriority(
        self, job_id: str, priority: int = 0, lifo: bool = False
    ) -> Any:
        return await self.scripts.changePriority(job_id, priority, lifo)

    async def addLog(self, job_id: str, log_row: str, keep_logs: int = 0) -> int:
        logs_key = self.toKey(f"{job_id}:logs")
        multi = self.connection.conn.pipeline()
        multi.rpush(logs_key, log_row)
        if keep_logs:
            multi.ltrim(logs_key, -keep_logs, -1)
        result = await multi.execute()
        return min(keep_logs, result[0]) if keep_logs else result[0]

    # ============================================================
    # Queue / job queries
    # ============================================================

    async def getState(self, job_id: str) -> str:
        return await self.scripts.getState(job_id)

    async def isJobInState(self, state: str, job_id: str) -> bool:
        if state in _ZSET_STATES:
            score = await self.connection.conn.zscore(self.toKey(state), job_id)
            return score is not None
        return await self.scripts.isJobInList(self.toKey(state), job_id)

    async def getJobData(self, job_id: str) -> Optional[dict]:
        raw = await self.connection.conn.hgetall(self.toKey(job_id))
        return raw if raw else None

    async def getJobLogs(
        self, job_id: str, start: int = 0, end: int = -1, asc: bool = True
    ) -> dict:
        logs_key = self.toKey(f"{job_id}:logs")
        pipe = self.connection.conn.pipeline(transaction=True)
        if asc:
            pipe.lrange(logs_key, start, end)
        else:
            pipe.lrange(logs_key, -(end + 1), -(start + 1))
        pipe.llen(logs_key)
        result = await pipe.execute()
        if not asc:
            result[0].reverse()
        return {"logs": result[0], "count": result[1]}

    async def getRateLimitTtl(self) -> int:
        return await self.connection.conn.pttl(self.keys["limiter"])

    async def getCounts(self, types: list) -> list:
        return await self.scripts.getCounts(types)

    async def getCountsPerPriority(self, priorities: list) -> list:
        return await self.scripts.getCountsPerPriority(priorities)

    async def getRanges(
        self, types: list, start: int = 0, end: int = 1, asc: bool = False
    ) -> list:
        return await self.scripts.getRanges(types, start, end, asc)

    async def getProcessedChildrenValues(self, job_id: str) -> dict:
        return await self.connection.conn.hgetall(self.toKey(f"{job_id}:processed"))

    async def isPaused(self) -> bool:
        paused_key_exists = await self.connection.conn.hexists(
            self.keys["meta"], "paused"
        )
        return paused_key_exists == 1

    async def getClientList(self) -> list[str]:
        client = self.connection.conn
        if is_redis_cluster(client):
            nodes = get_cluster_nodes(client)
            return [
                await self._client_list(get_node_client(node)) for node in nodes
            ]
        return [await self._client_list(client)]

    async def _client_list(self, client) -> str:
        if hasattr(client, "client_list"):
            return await client.client_list()
        return await client.execute_command("CLIENT", "LIST")

    # ============================================================
    # Queue metadata & maintenance keys
    # ============================================================

    async def trimEvents(self, max_length: int) -> Any:
        return await self.connection.conn.xtrim(
            self.keys["events"], maxlen=max_length, approximate="~"
        )

    async def removeDeprecatedPriorityKey(self) -> Any:
        return await self.connection.conn.delete(self.toKey("priority"))

    # ============================================================
    # Worker blocking primitive
    # ============================================================

    async def waitForJob(self, block_timeout: float) -> Any:
        return await self.bclient.bzpopmin(self.keys["marker"], block_timeout)


def create_redis_backend(
    name: str,
    opts: dict = {},
    blocking: bool = False,
    with_blocking_connection: bool = False,
) -> RedisBackend:
    """Default backend factory: build a :class:`RedisBackend` for ``name``.

    The queue classes call this so they depend only on the
    :class:`~bullmq.backend.Backend` abstraction.

    :param with_blocking_connection: provision a dedicated blocking connection
        (workers) used for the marker ``BZPOPMIN`` wait.
    """
    redis_opts = opts.get("connection", {})
    skip_version_check = opts.get("skipVersionCheck", False)
    prefix = opts.get("prefix", "bull")

    connection = RedisConnection(redis_opts, skipVersionCheck=skip_version_check)
    blocking_connection = (
        RedisConnection(redis_opts, skipVersionCheck=skip_version_check)
        if with_blocking_connection
        else None
    )
    return RedisBackend(name, connection, blocking_connection, prefix)
