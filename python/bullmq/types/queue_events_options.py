from typing import TypedDict, Any, Union
import redis.asyncio as redis


class QueueEventsOptions(TypedDict, total=False):
    """
    Options for the QueueEvents class.
    """

    prefix: str
    """
    Prefix for all queue keys.
    """

    backend: str
    """
    Datastore backend to use: 'redis' (default) or 'postgres'. Must match the
    backend the queue itself was created with.

    @default 'redis'
    """

    connection: Union[dict[str, Any], redis.Redis, str]
    """
    Options for connecting to the datastore (a libpq connection string or
    parameter dict when `backend` is 'postgres'). QueueEvents requires a
    dedicated connection because the blocking stream read ties up the
    connection for the duration of the call; passing a shared connection
    would starve other operations.
    """

    schema: str
    """
    PostgreSQL schema used to namespace queues (the SQL-native replacement for
    `prefix`). Only used when `backend` is 'postgres'.

    @default 'bullmq'
    """

    autorun: bool
    """
    Whether to immediately start consuming events on construction.

    @default True
    """

    blockingTimeout: int
    """
    Block timeout in milliseconds for the underlying XREAD BLOCK call.
    A larger value reduces wakeups but increases shutdown latency
    because the consumer loop only checks the closing flag between
    blocks.

    @default 10000
    """

    lastEventId: str
    """
    Stream id to resume from. Use a concrete id (e.g. the last id
    seen by a previous consumer) to replay events, or '$' to only
    receive events published after the consumer attached.

    @default '$'
    """

    skipVersionCheck: bool
    """
    Avoid version validation to be greater or equal than v5.0.0.

    @default False
    """


class QueueEventsProducerOptions(TypedDict, total=False):
    """
    Options for the QueueEventsProducer class. Producers do not need
    a dedicated connection because XADD is non-blocking.
    """

    prefix: str
    backend: str
    connection: Union[dict[str, Any], redis.Redis, str]
    schema: str
    skipVersionCheck: bool
