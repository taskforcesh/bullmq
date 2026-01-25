
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
