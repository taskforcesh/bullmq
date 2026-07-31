"""
QueueEvents — consume the global event stream of a BullMQ queue.

Port of `src/classes/queue-events.ts`. The queue's Lua scripts and the
worker XADD-publish lifecycle events (added/active/completed/failed/...)
to a Redis stream at `{prefix}:{queueName}:events`. `QueueEvents`
subscribes to that stream with a blocking XREAD and re-emits each
entry through a Python `EventEmitter` so callers can wire listeners
in a way that mirrors the Node API.

Key design points:
- The consumer must own a dedicated Redis connection. A blocking
  `XREAD BLOCK` ties up the underlying socket, so reusing it for
  other commands would deadlock.
- Two emissions per event, mirroring Node: a generic channel
  (`'completed'`) and a per-job channel (`'completed:<jobId>'`).
  Callers can subscribe to either; the per-job channel is what makes
  the `Queue#waitUntilFinished` pattern work in Node.
- `progress.data` and `completed.returnvalue` are JSON-encoded by the
  scripts (so arbitrary payloads survive the stream) and decoded here
  to match Node's listener contract.
"""

from __future__ import annotations

import asyncio
import json
from typing import Optional, Union

import redis.asyncio as redis

from bullmq.event_emitter import EventEmitter
from bullmq.queue_keys import QueueKeys
from bullmq.redis_connection import RedisConnection
from bullmq.types.queue_events_options import QueueEventsOptions
from bullmq.utils import isRedisVersionLowerThan


# Events whose payload is JSON-encoded by the Lua scripts and must be
# decoded before being handed to listeners.
_JSON_DECODE_FIELDS = {
    "progress": "data",
    "completed": "returnvalue",
}


class QueueEvents(EventEmitter):
    """
    Listen to the global event stream of a queue. Construct one
    instance per queue you want to observe and add listeners via
    `on(event, fn)`. The instance starts consuming immediately unless
    `autorun=False`, in which case the caller must invoke `run()`.
    """

    def __init__(
        self,
        name: str,
        opts: Optional[QueueEventsOptions] = None,
    ):
        super().__init__()
        opts = dict(opts or {})
        # Defaults mirror Node. blockingTimeout is in ms to keep parity
        # with the JS surface; we convert at the call site.
        opts.setdefault("blockingTimeout", 10000)
        opts.setdefault("lastEventId", "$")
        opts.setdefault("autorun", True)

        self.name = name
        self.opts = opts
        self.prefix = opts.get("prefix", "bull")

        connection_opts: Union[dict, str, redis.Redis] = opts.get(
            "connection", {}
        )
        # `RedisConnection` calls `register_script` for every BullMQ
        # Lua script on construction. We don't use any of them here,
        # but `register_script` in redis-py only computes/caches the
        # SHA client-side -- there's no `SCRIPT LOAD` round-trip until
        # someone actually calls `EVALSHA`. The extra work is therefore
        # local, bounded, and dominated by the connection setup itself.
        self.redisConnection = RedisConnection(
            connection_opts,
            skipVersionCheck=opts.get("skipVersionCheck", False),
        )
        self.client = self.redisConnection.conn

        queue_keys = QueueKeys(self.prefix)
        self.keys = queue_keys.getKeys(name)
        self.qualifiedName = queue_keys.getQueueQualifiedName(name)

        self.running = False
        self.closing = False
        self.closed = False
        self._consumer_task: Optional[asyncio.Task] = None

        if opts.get("autorun"):
            # Schedule, don't await: the consumer task lives for the
            # lifetime of this instance. Surface startup failures via
            # the 'error' event so callers see them.
            self._consumer_task = asyncio.ensure_future(self._autorun())

    async def _autorun(self) -> None:
        try:
            await self.run()
        except asyncio.CancelledError:
            raise
        except Exception as err:
            self.emit("error", err)

    async def run(self) -> None:
        """
        Start consuming events. Idempotent only in the sense that a
        second call while the loop is running raises; this mirrors
        Node's behavior so callers don't accidentally spawn two
        consumers on the same instance.
        """
        if self.running:
            raise Exception("QueueEvents is already running.")

        # Register the current task so `close()` can interrupt the
        # blocking XREAD even when the caller spawned the consumer
        # themselves (`autorun=False` + `asyncio.create_task(events.run())`).
        if self._consumer_task is None:
            self._consumer_task = asyncio.current_task()

        # Validate Redis supports Streams (>= 5.0). `skipVersionCheck=True`
        # bypasses the INFO round-trip for cases where the caller knows
        # the server is compatible.
        version = await self.redisConnection.getRedisVersion()
        if version and isRedisVersionLowerThan(
            version, RedisConnection.minimum_version
        ):
            raise RuntimeError(
                f"Redis version {version} is below the minimum required "
                f"({RedisConnection.minimum_version}) for QueueEvents."
            )

        self.running = True
        try:
            await self._consume_events()
        finally:
            self.running = False

    async def _consume_events(self) -> None:
        """Block on the events stream and re-emit each entry."""
        key = self.keys["events"]
        last_id = self.opts.get("lastEventId") or "$"
        # redis-py's xread takes block in ms with decode_responses on,
        # matching ioredis' BLOCK argument.
        block_ms = int(self.opts.get("blockingTimeout", 10000))

        while not self.closing:
            try:
                data = await self.client.xread(
                    {key: last_id}, block=block_ms
                )
            except asyncio.CancelledError:
                raise
            except Exception as err:
                # Surface the error and exit the loop; the connection
                # is likely no longer usable. Mirrors Node's
                # checkConnectionError path which lets the caller see
                # connection issues via the 'error' event.
                if self.closing:
                    return
                self.emit("error", err)
                return

            if not data:
                # Blocking timeout elapsed with no events; loop and
                # re-check the closing flag so close() stays responsive.
                continue

            # redis-py returns: [(stream_name, [(id, {field: value, ...}), ...])]
            _, entries = data[0]
            for entry_id, fields in entries:
                last_id = entry_id
                self._dispatch_entry(entry_id, dict(fields))

    def _dispatch_entry(self, entry_id: str, args: dict) -> None:
        """Translate one stream entry into one (or two) emit calls."""
        event = args.pop("event", None)
        if not event:
            return

        # JSON-decode the fields the scripts encoded so listeners see
        # the same Python objects the producer side passed in.
        json_field = _JSON_DECODE_FIELDS.get(event)
        if json_field and json_field in args:
            try:
                args[json_field] = json.loads(args[json_field])
            except (TypeError, ValueError):
                # Leave the raw string in place: a malformed payload
                # is a script-side bug we don't want to swallow into a
                # KeyError downstream, but we also don't want to break
                # the entire consumer for one bad entry.
                pass

        if event == "drained":
            # Matches Node: no args, just the id. The drained event
            # carries no job-scoped payload.
            self.emit(event, entry_id)
            return

        self.emit(event, args, entry_id)
        job_id = args.get("jobId")
        if job_id:
            # Per-job channel — lets callers wait on a specific job's
            # lifecycle event without filtering inside their listener.
            self.emit(f"{event}:{job_id}", args, entry_id)

    async def close(self) -> None:
        """
        Stop consuming events and release the Redis connection.
        Idempotent: subsequent calls are no-ops. Works for both
        `autorun=True` (we own the task) and `autorun=False` (the
        caller spawned `events.run()` themselves — `run` auto-registers
        the task so we can still cancel it here).
        """
        if self.closing or self.closed:
            return
        self.closing = True

        task = self._consumer_task
        self._consumer_task = None
        # Don't cancel a task that is `current_task()` (i.e. close()
        # was called from inside the consumer loop itself); just let
        # the closing flag short-circuit the next iteration.
        if (
            task is not None
            and not task.done()
            and task is not asyncio.current_task()
        ):
            # XREAD BLOCK is parked on the socket; cancel forces it to
            # unwind. We swallow CancelledError because that's exactly
            # what we asked for.
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            except Exception:
                # The consumer already emitted any genuine error; we
                # don't want close() to raise on shutdown noise.
                pass

        try:
            await self.redisConnection.close()
        finally:
            self.closed = True
