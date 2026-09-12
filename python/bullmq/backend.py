"""
Database-agnostic queue backend contract.

This contract expresses the queue semantics ("move job to active", "extend
lock", "promote job", ...) **independently of the underlying datastore**. The
high-level classes (:class:`~bullmq.queue.Queue`, :class:`~bullmq.worker.Worker`,
:class:`~bullmq.job.Job` and :class:`~bullmq.flow_producer.FlowProducer`) drive
every datastore operation through this abstraction and never talk to a datastore
client directly, so a non-Redis adapter (e.g. PostgreSQL) can fulfil the same
operations without any change to those classes.

The built-in implementation is the Redis adapter
(:class:`~bullmq.backends.redis_backend.RedisBackend`); a PostgreSQL adapter
(:class:`~bullmq.backends.postgres_backend.PostgresBackend`) fulfils the same
contract over a different datastore.

Design notes
------------
* The interface intentionally exposes **no connection or transaction type**: a
  concrete adapter owns its connection(s). Callers never thread a connection or
  transaction through an operation.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Callable, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from bullmq.job import Job


def require_event_field(fields: dict) -> str:
    """Validate a :meth:`Backend.publishEvent` payload; return its event name.

    Every adapter enforces this at the contract boundary because both failure
    modes are silent: ``QueueEvents._dispatch_entry`` drops an entry that
    carries no ``event``, so a caller that omits it would publish an event that
    simply never arrives.
    """
    event = fields.get("event") if fields else None
    if event is None or str(event) == "":
        raise ValueError(
            "publishEvent requires a non-empty 'event' field naming the event"
        )
    return str(event)


class Backend(ABC):
    """Abstract queue backend.

    Concrete adapters (Redis, PostgreSQL, ...) implement every abstract method
    below. Each high-level class holds a single :class:`Backend` instance and
    routes all datastore operations through it.
    """

    # ============================================================
    # Connection lifecycle
    # ============================================================

    @abstractmethod
    async def waitUntilReady(self) -> Any:
        """Resolve once the backend's connection(s) are ready to accept operations."""

    @abstractmethod
    async def close(self, force: bool = False) -> None:
        """Close the backend and its owned connection(s).

        When ``force`` is ``True`` the connection(s) are torn down without
        waiting for in-flight (e.g. blocking) commands to finish.
        """

    @abstractmethod
    async def disconnect(self) -> None:
        """Forcibly disconnect the backend's underlying connection(s)."""

    @abstractmethod
    async def setName(self, name: str) -> None:
        """Set a human-readable name on the underlying connection (observability)."""

    @abstractmethod
    def forQueue(self, queue_name: str, prefix: Optional[str] = None) -> "Backend":
        """Return a sibling backend bound to a different queue that shares this
        backend's underlying connection(s). Used by :class:`FlowProducer`.
        """

    @property
    @abstractmethod
    def minimumBlockTimeout(self) -> float:
        """Smallest meaningful blocking timeout (in seconds) for the blocking primitive."""

    @property
    def maximumBlockTimeout(self) -> float:
        """Largest meaningful blocking timeout (in seconds) for the blocking primitive.

        Defaults to the Redis-derived ceiling (10s). Backends whose blocking
        primitive keeps the connection open and re-arms to the next due job
        (e.g. PostgreSQL ``LISTEN``/``NOTIFY``) can override this with a much
        larger value so an idle worker stops re-polling.
        """
        return 10

    @property
    @abstractmethod
    def capabilities(self) -> dict:
        """Datastore capability flags (e.g. ``canBlockFor1Ms``, ``canDoubleTimeout``)."""

    # ============================================================
    # Queue identity & key building
    # ============================================================

    @property
    @abstractmethod
    def qualifiedName(self) -> str:
        """The queue's fully-qualified name (cross-backend logical identifier)."""

    @property
    @abstractmethod
    def keys(self) -> dict:
        """The map of named sub-keys/identifiers for the queue."""

    @abstractmethod
    def toKey(self, type: str) -> str:
        """Build a namespaced sub-key/identifier of the given ``type`` for this queue."""

    @abstractmethod
    def clientName(self, suffix: Optional[str] = None) -> str:
        """Build the connection client name (used for ``setName`` and discovery)."""

    # ============================================================
    # Adding jobs
    # ============================================================

    @abstractmethod
    async def addJob(self, job: "Job") -> str:
        """Add a single job, routing it to the correct initial state.

        Returns the job id.
        """

    @abstractmethod
    async def addJobs(self, jobs: list["Job"]) -> list[str]:
        """Add many jobs in a single efficient operation. Returns the ids, in order."""

    @abstractmethod
    async def addFlow(self, entries: list[dict]) -> list:
        """Atomically insert a flow (tree) of jobs that may span multiple queues.

        ``entries`` is a flat, topologically ordered list of
        ``{"job": Job, "is_parent": bool}`` descriptors: each ``Job`` is
        self-describing (it carries its own queue and ``parent`` options), and
        ``is_parent`` marks nodes that have children (added as parent jobs).
        The whole insert is atomic (a Redis ``MULTI`` / a single SQL
        transaction). Returns one entry per input, in order: the created job id
        (a string), or a **negative integer** error/skip code for an entry that
        was not inserted (e.g. ``-5`` when its parent does not exist).
        """

    # ============================================================
    # Job state transitions
    # ============================================================

    @abstractmethod
    async def moveToActive(self, token: str, opts: dict) -> list:
        """Atomically move the next eligible job from wait/prioritized to active."""

    @abstractmethod
    async def moveToCompleted(
        self,
        job: "Job",
        return_value: Any,
        remove_on_complete: Any,
        token: str,
        fetch_next: bool = True,
    ) -> Any:
        """Move an active job to completed and optionally fetch the next job.

        Returns ``{"result": next_job_data_or_None, "finishedOn": timestamp}``.
        """

    @abstractmethod
    async def moveToFailed(
        self,
        job: "Job",
        failed_reason: str,
        remove_on_fail: Any,
        token: str,
        fetch_next: bool = True,
        fields_to_update: Optional[dict] = None,
    ) -> Any:
        """Move an active job to failed and optionally fetch the next job.

        Returns ``{"result": next_job_data_or_None, "finishedOn": timestamp}``.
        """

    @abstractmethod
    async def moveToDelayed(
        self,
        job_id: str,
        timestamp: int,
        delay: int,
        token: str = "0",
        opts: dict = {},
    ) -> Any:
        """Move a job to the delayed state, scheduling it after ``delay`` ms."""

    @abstractmethod
    async def moveToWaitingChildren(self, job_id: str, token: str, opts: dict) -> bool:
        """Move a parent job to the waiting-children state."""

    @abstractmethod
    async def retryJob(
        self, job_id: str, lifo: bool, token: str = "0", opts: dict = {}
    ) -> Any:
        """Retry a failed/active job immediately by pushing it back to wait."""

    @abstractmethod
    async def reprocessJob(self, job: "Job", state: str, opts: dict = {}) -> Any:
        """Reprocess a finished (failed/completed) job, moving it back to wait."""

    @abstractmethod
    async def promote(self, job_id: str) -> Any:
        """Promote a single delayed job so it can be processed as soon as possible."""

    @abstractmethod
    async def moveStalledJobsToWait(
        self, max_stalled_count: int, stalled_interval: int
    ) -> list[str]:
        """Recover stalled jobs (active jobs whose lock expired) back to wait."""

    # ============================================================
    # Bulk admin transitions
    # ============================================================

    @abstractmethod
    async def retryJobs(
        self, state: str, count: int, timestamp: int
    ) -> Any:
        """Move up to ``count`` finished jobs of the given ``state`` back to wait.

        Returns a cursor; ``0`` when there are no more jobs to move.
        """

    @abstractmethod
    async def promoteJobs(self, count: int) -> Any:
        """Promote up to ``count`` delayed jobs back to wait. Returns a cursor."""

    @abstractmethod
    async def pause(self, paused: bool = True) -> Any:
        """Pause or resume the whole queue."""

    @abstractmethod
    async def drain(self, delayed: bool = False) -> Any:
        """Remove waiting (and optionally delayed) jobs from the queue."""

    @abstractmethod
    async def cleanJobsInSet(self, set: str, grace: int = 0, limit: int = 0) -> list:
        """Remove jobs in a given state that are older than ``grace`` ms."""

    @abstractmethod
    async def obliterate(self, count: int, force: bool = False) -> Any:
        """Irreversibly destroy the queue and all of its contents. Returns a cursor."""

    @abstractmethod
    async def remove(self, job_id: str, remove_children: bool) -> Any:
        """Remove a job and (optionally) its children."""

    # ============================================================
    # Locks
    # ============================================================

    @abstractmethod
    async def extendLock(self, job_id: str, token: str, duration: int) -> Any:
        """Extend the lock of a single active job."""

    @abstractmethod
    async def extendLocks(
        self, job_ids: list[str], tokens: list[str], duration: int
    ) -> list:
        """Extend the lock of several active jobs at once."""

    # ============================================================
    # Job mutations
    # ============================================================

    @abstractmethod
    async def updateData(self, job_id: str, data: Any) -> Any:
        """Replace a job's data payload."""

    @abstractmethod
    async def updateProgress(self, job_id: str, progress: Any) -> Any:
        """Update a job's progress and emit the corresponding event."""

    @abstractmethod
    async def changePriority(
        self, job_id: str, priority: int = 0, lifo: bool = False
    ) -> Any:
        """Change the priority (and optionally lifo) of a waiting job."""

    @abstractmethod
    async def addLog(self, job_id: str, log_row: str, keep_logs: int = 0) -> int:
        """Append a row to a job's log, optionally trimming old entries."""

    # ============================================================
    # Queue / job queries
    # ============================================================

    @abstractmethod
    async def getState(self, job_id: str) -> str:
        """Return the current state of a job."""

    @abstractmethod
    async def isJobInState(self, state: str, job_id: str) -> bool:
        """Return whether a job id is present in the given state."""

    @abstractmethod
    async def getJobData(self, job_id: str) -> Optional[dict]:
        """Return the stored data for a job, or ``None`` if it is missing."""

    @abstractmethod
    async def getJobLogs(
        self, job_id: str, start: int = 0, end: int = -1, asc: bool = True
    ) -> dict:
        """Return a page of a job's logs together with the total log count."""

    @abstractmethod
    async def getRateLimitTtl(self) -> int:
        """Return the ttl (ms) of the current rate-limit window."""

    @abstractmethod
    async def getCounts(self, types: list) -> list:
        """Return the job counts across the given states/types, in order."""

    @abstractmethod
    async def getCountsPerPriority(self, priorities: list) -> list:
        """Return the number of jobs per priority, in order."""

    @abstractmethod
    async def getRanges(
        self, types: list, start: int = 0, end: int = 1, asc: bool = False
    ) -> list:
        """Return a page of job ids for the given states/types."""

    @abstractmethod
    async def getProcessedChildrenValues(self, job_id: str) -> dict:
        """Return the raw processed-children map (child key -> serialized value)."""

    @abstractmethod
    async def isPaused(self) -> bool:
        """Return whether the queue is currently paused."""

    @abstractmethod
    async def getClientList(self) -> list[str]:
        """Return the raw worker/client list(s) for the queue's datastore."""

    # ============================================================
    # Queue metadata & maintenance keys
    # ============================================================

    @abstractmethod
    async def setQueueMeta(self, values: dict) -> int:
        """Upsert queue metadata fields (``concurrency``, ``max``, ``duration``, ...).

        Returns the number of fields written.
        """

    @abstractmethod
    async def getQueueMetaField(self, field: str) -> Optional[str]:
        """Return a single queue metadata field's raw value, or ``None``."""

    @abstractmethod
    async def getQueueMetaFields(self, fields: list) -> list:
        """Return several queue metadata values, in the order requested.
        Missing fields come back as ``None``."""

    @abstractmethod
    async def removeQueueMetaFields(self, fields: list) -> int:
        """Remove queue metadata fields. Returns how many were actually removed."""

    @abstractmethod
    async def setRateLimit(self, expire_time_ms: int) -> None:
        """Force the rate-limit window open for ``expire_time_ms`` milliseconds."""

    @abstractmethod
    async def removeRateLimitKey(self) -> int:
        """Clear the rate-limit window. Returns the number of entries removed (0 or 1)."""

    @abstractmethod
    async def trimEvents(self, max_length: int) -> Any:
        """Trim the event stream to an approximate maximum length."""

    @abstractmethod
    async def removeDeprecatedPriorityKey(self) -> Any:
        """Remove the deprecated priority helper key."""

    # ============================================================
    # Event stream
    # ============================================================

    @abstractmethod
    async def publishEvent(self, fields: dict, max_events: int) -> str:
        """Append a custom event to the queue's event stream.

        ``fields`` is the flat payload; its ``event`` entry names the channel
        listeners subscribe to and is required (see :func:`require_event_field`).
        Returns the id of the appended entry.
        """

    @abstractmethod
    async def readEvents(self, id: str, block_timeout: int) -> Any:
        """Block (up to ``block_timeout`` ms) reading the queue's event stream
        for entries newer than ``id``.

        ``id`` is a cursor, or ``'$'`` for "only events published from now on".
        Returns the raw stream entries in the Redis ``XREAD`` shape --
        ``[(stream_key, [(entry_id, {field: value, ...}), ...])]`` -- or a falsy
        value when the block timeout elapses with no new events.
        """

    # ============================================================
    # Worker blocking primitive
    # ============================================================

    @abstractmethod
    async def waitForJob(self, block_timeout: float) -> Any:
        """Block (up to ``block_timeout`` seconds) until a new job may be available.

        Returns the raw marker entry on success, or a falsy value on timeout.
        """

    # ============================================================
    # Job schedulers (repeatable job factories)
    # ============================================================

    @abstractmethod
    async def addJobScheduler(
        self,
        job_scheduler_id: str,
        next_millis: Optional[int],
        template_data: str,
        template_opts: dict,
        scheduler_opts: dict,
        delayed_job_opts: dict,
        producer_id: Optional[str] = None,
    ):
        """Register/override a scheduler and enqueue its next iteration.

        Returns a ``(job_id, delay)`` pair for the newly-scheduled iteration,
        or a falsy value when no iteration was produced.
        """

    @abstractmethod
    async def updateJobSchedulerNextMillis(
        self,
        job_scheduler_id: str,
        next_millis: Optional[int],
        template_data: str,
        delayed_job_opts: dict,
        producer_id: Optional[str] = None,
    ):
        """Advance an existing scheduler to its next iteration without
        touching its template. Returns the new delayed job id, or a falsy
        value if no iteration was produced (e.g. the scheduler is gone)."""

    @abstractmethod
    async def removeJobScheduler(self, job_scheduler_id: str) -> int:
        """Remove a scheduler and its pending next-iteration job.

        Returns 0 if the scheduler was removed, 1 if it did not exist.
        """

    @abstractmethod
    async def isJobScheduler(self, job_scheduler_id: str) -> bool:
        """Return whether ``job_scheduler_id`` is a registered scheduler."""

    @abstractmethod
    async def getJobScheduler(self, job_scheduler_id: str):
        """Return a ``(fields, next_millis)`` pair for a single scheduler.

        ``fields`` is the metadata mapping (``name``, ``ic``, ``every``,
        ``pattern``, ``data``, ``opts`` ...) in the Redis-hash shape that
        :func:`bullmq.job_scheduler._transform_scheduler_data` consumes, or a
        falsy value when the scheduler is missing. ``next_millis`` is the
        next-run timestamp, or ``None``.
        """

    @abstractmethod
    async def getJobSchedulers(
        self, start: int = 0, end: int = -1, asc: bool = False
    ) -> list:
        """Return a page of registered schedulers as a list of
        ``(key, fields, next_millis)`` tuples (see :meth:`getJobScheduler`
        for the ``fields`` shape)."""

    @abstractmethod
    async def getJobSchedulersCount(self) -> int:
        """Return the total number of registered schedulers."""


BackendFactory = Callable[..., Backend]
"""Factory that builds a :class:`Backend` for a given queue.

Injected into the queue classes so they depend only on the abstraction, never
on a concrete datastore/connection. The default factory is the Redis one
(``create_redis_backend``).
"""
