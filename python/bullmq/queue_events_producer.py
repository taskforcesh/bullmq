"""
QueueEventsProducer — publish custom events to a queue's event stream.

Port of `src/classes/queue-events-producer.ts`. Useful for surfacing
application-level lifecycle events on the same stream that
`QueueEvents` consumes, so dashboards and progress UIs see them
uniformly with the framework-emitted events.
"""

from __future__ import annotations

from typing import Optional, Union

import redis.asyncio as redis

from bullmq.queue_keys import QueueKeys
from bullmq.redis_connection import RedisConnection
from bullmq.types.queue_events_options import QueueEventsProducerOptions
from bullmq.utils import isRedisVersionLowerThan


class QueueEventsProducer:
    """
    Lightweight publisher for the queue's events stream. Unlike
    `QueueEvents`, no dedicated connection is required because XADD
    is non-blocking.
    """

    def __init__(
        self,
        name: str,
        opts: Optional[QueueEventsProducerOptions] = None,
    ):
        opts = dict(opts or {})
        self.name = name
        self.opts = opts
        self.prefix = opts.get("prefix", "bull")

        connection_opts: Union[dict, str, redis.Redis] = opts.get(
            "connection", {}
        )
        self.redisConnection = RedisConnection(
            connection_opts,
            skipVersionCheck=opts.get("skipVersionCheck", False),
        )
        self.client = self.redisConnection.conn

        queue_keys = QueueKeys(self.prefix)
        self.keys = queue_keys.getKeys(name)
        self.qualifiedName = queue_keys.getQueueQualifiedName(name)

        self.closing = False
        # Cached on first publishEvent() so we don't pay the INFO
        # round-trip per call. None means "not yet validated".
        self._version_validated = False

    async def _validate_redis_version(self) -> None:
        """Lazily ensure the connected Redis supports Streams (>= 5.0).
        Honours `skipVersionCheck` via the underlying RedisConnection."""
        if self._version_validated:
            return
        version = await self.redisConnection.getRedisVersion()
        if version and isRedisVersionLowerThan(
            version, RedisConnection.minimum_version
        ):
            raise RuntimeError(
                f"Redis version {version} is below the minimum required "
                f"({RedisConnection.minimum_version}) for QueueEventsProducer."
            )
        self._version_validated = True

    async def publishEvent(
        self,
        args: dict,
        maxEvents: int = 1000,
    ) -> None:
        """
        Publish a custom event to the queue's stream. `args` must
        include an `eventName` field that identifies the channel
        listeners subscribe to; everything else in `args` is stored
        verbatim as stream fields.

        @param args: Event payload. Must contain `eventName`.
        @param maxEvents: Approximate stream cap (XADD MAXLEN ~).
        """
        if "eventName" not in args:
            raise ValueError("publishEvent requires an 'eventName' key")

        await self._validate_redis_version()

        # Build the fields dict in script-friendly order: 'event'
        # first to match the consumer's `args.pop("event", ...)` in
        # QueueEvents._dispatch_entry, with the rest of the payload
        # appended in input order.
        fields = {"event": args["eventName"]}
        for k, v in args.items():
            if k == "eventName":
                continue
            fields[k] = v

        await self.client.xadd(
            self.keys["events"],
            fields,
            maxlen=maxEvents,
            approximate=True,
        )

    async def close(self) -> None:
        """Close the underlying Redis connection."""
        if self.closing:
            return
        self.closing = True
        await self.redisConnection.close()
