"""
QueueEventsProducer — publish custom events to a queue's event stream.

Port of `src/classes/queue-events-producer.ts`. Useful for surfacing
application-level lifecycle events on the same stream that
`QueueEvents` consumes, so dashboards and progress UIs see them
uniformly with the framework-emitted events.

Like the other public classes, it routes every datastore operation through the
:class:`~bullmq.backend.Backend` abstraction, so `opts["backend"]` selects the
Redis or the PostgreSQL adapter.
"""

from __future__ import annotations

from typing import Optional

from bullmq.backends import RedisBackend, create_backend
from bullmq.redis_connection import RedisConnection
from bullmq.types.queue_events_options import QueueEventsProducerOptions
from bullmq.utils import isRedisVersionLowerThan


class QueueEventsProducer:
    """
    Lightweight publisher for the queue's events stream. Unlike
    `QueueEvents`, no dedicated connection is required because
    appending an event is non-blocking.
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

        self.backend = create_backend(name, opts)
        # Compatibility handles for tests / callers that read the raw client or
        # connection directly (Redis backend only).
        self.redisConnection = (
            self.backend.connection if isinstance(self.backend, RedisBackend) else None
        )
        self.client = getattr(self.backend, "conn", None)

        self.keys = self.backend.keys
        self.qualifiedName = self.backend.qualifiedName

        self.closing = False
        # Cached on first publishEvent() so we don't pay the INFO
        # round-trip per call.
        self._version_validated = False

    async def _validate_redis_version(self) -> None:
        """Lazily ensure the connected Redis supports Streams (>= 5.0).
        Honours `skipVersionCheck` via the underlying RedisConnection. Non-Redis
        backends enforce their own minimum version on connect."""
        if self._version_validated or self.redisConnection is None:
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
        verbatim as event fields.

        @param args: Event payload. Must contain `eventName`.
        @param maxEvents: Approximate stream cap.
        """
        if "eventName" not in args:
            raise ValueError("publishEvent requires an 'eventName' key")

        await self._validate_redis_version()

        # Build the fields dict in consumer-friendly order: 'event'
        # first to match `QueueEvents._dispatch_entry`'s
        # `args.pop("event", ...)`, with the rest of the payload
        # appended in input order.
        fields = {"event": args["eventName"]}
        for k, v in args.items():
            if k == "eventName":
                continue
            fields[k] = v

        await self.backend.publishEvent(fields, maxEvents)

    async def close(self) -> None:
        """Close the underlying connection."""
        if self.closing:
            return
        self.closing = True
        await self.backend.close()
