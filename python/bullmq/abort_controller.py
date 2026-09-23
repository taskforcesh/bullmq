"""
AbortController / AbortSignal for BullMQ Python workers.

Port of the cancellation primitive used by the Node.js implementation
(`src/classes/abort-controller.ts`). Node leverages the standard
`AbortController` / `AbortSignal` pair; Python's stdlib has no direct
equivalent in `asyncio`, so this module provides a minimal, async-aware
implementation that is sufficient for the worker -> processor cancellation
path.

Usage from a processor:

    async def process(job, token, signal):
        # Cooperative check
        if signal.aborted:
            raise AbortError(signal.reason)

        # Or race the abort against the real work
        work = asyncio.create_task(do_work())
        wait = asyncio.create_task(signal.wait())
        done, pending = await asyncio.wait(
            {work, wait}, return_when=asyncio.FIRST_COMPLETED
        )
        for p in pending:
            p.cancel()
        if signal.aborted:
            raise AbortError(signal.reason)
        return work.result()

External cancellation is triggered by `Worker.cancelJob(job_id, reason)`,
which delegates to `LockManager.cancel_job` to flip the matching signal.
"""

from __future__ import annotations

import asyncio
from typing import Optional


class AbortError(Exception):
    """Raised by `AbortSignal.throw_if_aborted()` (and conventionally by
    processors that want to surface external cancellation as a failure)."""

    def __init__(self, reason: Optional[str] = None):
        super().__init__(reason or "The operation was aborted")
        self.reason = reason


class AbortSignal:
    """Read-only view of an `AbortController`. Mirrors the subset of the
    JavaScript `AbortSignal` interface that BullMQ workers rely on:
    `aborted`, `reason`, and an awaitable equivalent to attaching an
    `abort` event listener."""

    def __init__(self) -> None:
        self._event = asyncio.Event()
        self._reason: Optional[str] = None

    @property
    def aborted(self) -> bool:
        return self._event.is_set()

    @property
    def reason(self) -> Optional[str]:
        return self._reason

    async def wait(self) -> None:
        """Resolve as soon as the signal is aborted. Use with
        `asyncio.wait(..., return_when=FIRST_COMPLETED)` to race
        cancellation against the actual work."""
        await self._event.wait()

    def throw_if_aborted(self) -> None:
        if self._event.is_set():
            raise AbortError(self._reason)


class AbortController:
    """Owner of an `AbortSignal`. `abort(reason)` is idempotent so callers
    do not need to guard against double-cancellation when several code
    paths (e.g. force close + explicit cancelJob) target the same job."""

    def __init__(self) -> None:
        self.signal = AbortSignal()

    def abort(self, reason: Optional[str] = None) -> None:
        if self.signal._event.is_set():
            return
        self.signal._reason = reason
        self.signal._event.set()
