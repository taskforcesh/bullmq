
from typing import TypedDict, Any
import redis.asyncio as redis


class WorkerOptions(TypedDict, total=False):
    autorun: bool
    """
    Condition to start processor at instance creation

    @default true
    """

    concurrency: int
    """
    Amount of jobs that a single worker is allowed to work on
    in parallel.

    @default 1
    @see https://docs.bullmq.io/guide/workers/concurrency
    """

    maxStalledCount: int
    """
    Amount of times a job can be recovered from a stalled state
    to the `wait` state. If this is exceeded, the job is moved
    to `failed`.

    @default 1
    """

    stalledInterval: int
    """
    Number of milliseconds between stallness checks.

    @default 30000
    """

    lockDuration: int
    """
    Duration of the lock for the job in milliseconds. The lock represents that
    a worker is processing the job. If the lock is lost, the job will be eventually
    be picked up by the stalled checker and move back to wait so that another worker
    can process it again.

    @default 30000
    """

    prefix: str
    """
    Prefix for all queue keys.
    """

    connection: dict[str, Any] | redis.Redis
    """
    Options for connecting to a Redis instance.
    """
