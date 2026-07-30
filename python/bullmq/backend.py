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
    async def addFlow(self, entries: list[dict]) -> list[str]:
        """Atomically insert a flow (tree) of jobs that may span multiple queues.

        ``entries`` is a flat, topologically ordered list of
        ``{"job": Job, "is_parent": bool}`` descriptors: each ``Job`` is
        self-describing (it carries its own queue and ``parent`` options), and
        ``is_parent`` marks nodes that have children (added as parent jobs).
        The whole insert is atomic (a Redis ``MULTI`` / a single SQL
        transaction). Returns the created job ids, in the same order as
        ``entries``.
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
    async def trimEvents(self, max_length: int) -> Any:
        """Trim the event stream to an approximate maximum length."""

    @abstractmethod
    async def removeDeprecatedPriorityKey(self) -> Any:
        """Remove the deprecated priority helper key."""

    # ============================================================
    # Worker blocking primitive
    # ============================================================

    @abstractmethod
    async def waitForJob(self, block_timeout: float) -> Any:
        """Block (up to ``block_timeout`` seconds) until a new job may be available.

        Returns the raw marker entry on success, or a falsy value on timeout.
        """


BackendFactory = Callable[..., Backend]
"""Factory that builds a :class:`Backend` for a given queue.

Injected into the queue classes so they depend only on the abstraction, never
on a concrete datastore/connection. The default factory is the Redis one
(``create_redis_backend``).
"""
