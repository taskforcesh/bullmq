"""
Lock renewal manager for BullMQ workers.

Port of `src/classes/lock-manager.ts`. The manager keeps track of every job
currently being processed by the worker and periodically renews their locks
atomically via the `extendLocks` Lua script so that other workers do not
consider them stalled while they are still being processed.

Differences from the Node implementation:
- Uses an `asyncio.Task` for the renewal loop instead of `setTimeout`.
- Per-job cancellation is implemented via `AbortController`, matching the
  Node implementation: `track_job(..., should_create_controller=True)`
  returns an `AbortController` that the worker passes to the processor as
  an `AbortSignal`. `cancel_job` / `cancel_all_jobs` flip the signal so a
  cooperating processor can short-circuit. Forced worker shutdown still
  cancels the underlying `asyncio.Task` so non-cooperating processors
  cannot block close().
"""

from __future__ import annotations

import asyncio
import time
from typing import TYPE_CHECKING, Optional

from bullmq.abort_controller import AbortController

if TYPE_CHECKING:
    from bullmq.worker import Worker


class LockManager:
    def __init__(
        self,
        worker: "Worker",
        lock_renew_time: int,
        lock_duration: int,
        worker_id: str,
        worker_name: Optional[str] = None,
    ):
        """
        @param worker: The Worker that owns this manager. Used to access
                       `scripts.extendJobLocks` and to emit events.
        @param lock_renew_time: Total renewal window in milliseconds. The
                                renewal loop wakes every `lock_renew_time / 2`
                                ms; jobs whose stored timestamp is older than
                                `now - lock_renew_time / 2` are renewed.
        @param lock_duration: PX value passed to the Lua script (ms).
        @param worker_id: Unique id of the worker, used for diagnostics.
        @param worker_name: Optional human-readable worker name.
        """
        self.worker = worker
        self.lock_renew_time = lock_renew_time
        self.lock_duration = lock_duration
        self.worker_id = worker_id
        self.worker_name = worker_name
        self.tracked_jobs: dict[str, dict] = {}
        self.closed = False
        self._renewal_task: Optional[asyncio.Task] = None

    def start(self) -> None:
        """Start the background renewal loop. Idempotent."""
        if self.closed or self._renewal_task is not None:
            return
        if self.lock_renew_time > 0:
            self._renewal_task = asyncio.ensure_future(self._renewal_loop())

    def track_job(
        self,
        job_id: str,
        token: str,
        ts: int,
        should_create_controller: bool = False,
    ) -> Optional[AbortController]:
        """Register a job for lock renewal. `ts` is the timestamp (ms) at
        which the job became active; the manager uses it to decide when the
        first renewal is due.

        When `should_create_controller` is True, an `AbortController` is
        created and stored alongside the job so that `cancel_job` can flip
        its signal. The controller is returned to the caller (the worker)
        so it can pass the underlying `AbortSignal` into the processor.
        Returns None when no controller is needed or when the manager is
        closed.
        """
        # Only allocate the controller after confirming we are going to
        # track the job. If the manager is closed (or the job_id is
        # falsy) the caller would otherwise receive a signal that can
        # never be aborted via `cancel_job`, because nothing was added
        # to `tracked_jobs`.
        if self.closed or not job_id:
            return None
        controller = AbortController() if should_create_controller else None
        self.tracked_jobs[job_id] = {
            "token": token,
            "ts": ts,
            "abort_controller": controller,
        }
        return controller

    def untrack_job(self, job_id: str) -> None:
        """Stop renewing the lock for the given job. Called when the job
        completes, fails, or is moved away from the active state."""
        self.tracked_jobs.pop(job_id, None)

    def cancel_job(self, job_id: str, reason: Optional[str] = None) -> bool:
        """Abort the `AbortSignal` for the given job, if one was created.
        Returns True if a controller was found and aborted, False
        otherwise. Mirrors `LockManager.cancelJob` from the Node
        implementation."""
        tracked = self.tracked_jobs.get(job_id)
        if tracked is None:
            return False
        controller = tracked.get("abort_controller")
        if controller is None:
            return False
        controller.abort(reason)
        return True

    def cancel_all_jobs(self, reason: Optional[str] = None) -> None:
        """Abort the signals of every tracked job that has a controller.

        Called from `Worker.cancelAllJobs` and from `Worker.close(force=True)`
        — the forced close path aborts cooperating processors first so they
        can observe a structured `reason` before the underlying tasks are
        cancelled."""
        for tracked in self.tracked_jobs.values():
            controller = tracked.get("abort_controller")
            if controller is not None:
                controller.abort(reason)

    def get_active_job_count(self) -> int:
        return len(self.tracked_jobs)

    def get_tracked_job_ids(self) -> list:
        return list(self.tracked_jobs.keys())

    def is_running(self) -> bool:
        return (not self.closed) and self._renewal_task is not None

    async def close(self) -> None:
        """Cancel the renewal loop and forget all tracked jobs. Idempotent."""
        if self.closed:
            return
        self.closed = True
        task = self._renewal_task
        self._renewal_task = None
        if task is not None:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                # Expected: task.cancel() injects CancelledError into the
                # renewal loop. Swallow only this; anything else points
                # at a real bug we want to see.
                pass
            except Exception as err:
                # Surface unexpected failures via the worker's event
                # emitter instead of silently hiding them. Guard the
                # emit itself so a faulty listener does not break the
                # close path.
                try:
                    self.worker.emit("error", err)
                except Exception:
                    pass
        self.tracked_jobs.clear()

    async def _renewal_loop(self) -> None:
        """Wake every `lock_renew_time / 2` ms and renew locks for any
        tracked job whose stored timestamp is older than half the renewal
        window. Mirrors the recursive `setTimeout` pattern from Node."""
        interval = (self.lock_renew_time / 2) / 1000.0
        try:
            while not self.closed:
                await asyncio.sleep(interval)
                if self.closed:
                    break

                now = int(time.time() * 1000)
                threshold = self.lock_renew_time / 2
                jobs_to_extend: list = []

                # Snapshot the keys: track/untrack may run concurrently from
                # the worker loop.
                for job_id in list(self.tracked_jobs.keys()):
                    tracked = self.tracked_jobs.get(job_id)
                    if tracked is None:
                        continue
                    ts = tracked.get("ts")
                    if not ts:
                        tracked["ts"] = now
                        continue
                    if ts + threshold < now:
                        tracked["ts"] = now
                        jobs_to_extend.append(job_id)

                if jobs_to_extend:
                    await self._extend_locks(jobs_to_extend)
        except asyncio.CancelledError:
            raise

    async def _extend_locks(self, job_ids: list) -> None:
        try:
            tokens = [
                (self.tracked_jobs.get(jid) or {}).get("token", "")
                for jid in job_ids
            ]
            errored_job_ids = await self.worker.scripts.extendJobLocks(
                job_ids, tokens, self.lock_duration
            )

            # The Lua script returns a list (possibly empty) of failed ids.
            # Keep the original list for the emitted payload so listeners
            # see the script's ordering and any duplicates verbatim; build
            # a parallel set purely for O(1) membership when computing the
            # `succeeded` list, so renewals stay cheap under concurrency.
            errored_list = list(errored_job_ids or [])
            errored_set = set(errored_list)

            if errored_list:
                self.worker.emit("lockRenewalFailed", errored_list)
                for job_id in errored_list:
                    self.worker.emit(
                        "error",
                        Exception(f"could not renew lock for job {job_id}"),
                    )

            succeeded = [jid for jid in job_ids if jid not in errored_set]
            if succeeded:
                self.worker.emit(
                    "locksRenewed",
                    {"count": len(succeeded), "jobIds": succeeded},
                )
        except asyncio.CancelledError:
            # Re-raise cooperative cancellation before the broad handler
            # so close() stays silent and the renewal task exits
            # responsively. (CancelledError inherits from BaseException
            # on supported Python versions, but the explicit clause
            # makes the intent unambiguous to future maintainers.)
            raise
        except Exception as err:
            self.worker.emit("error", err)
