
from typing import TypedDict, Any, Union
import redis.asyncio as redis
from bullmq.types.job_options import JobOptions


class QueueBaseOptions(TypedDict, total=False):
    """
    Options for the Queue class.
    """

    prefix: str
    """
    Prefix for all queue keys.
    """

    connection: Union[dict[str, Any], redis.Redis, str]
    """
    Options for connecting to a Redis instance.
    """

    defaultJobOptions: JobOptions
    """
    Default job options that will be applied to all jobs added to the queue.
    These can be overridden by individual job options.
    """

    skipVersionCheck: bool
    """
    Avoid version validation to be greater or equal than v5.0.0.

    @default False
    """

    skipWaitingForReady: bool
    """
    Skip waiting for connection ready.

    @deprecated This option has no effect and will be removed in a future release.
    @default False
    """
