
from typing import TypedDict, Any, Union
import redis.asyncio as redis


class WorkerOptions(TypedDict, total=False):
    name: str
    """
    Optional worker name used to set the Redis client name.
    """
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

    skipStalledCheck: bool
    """
    Reserved/unsupported in the current Python client.

    In the JS SDK this skips the stalled-check timer for this worker.
    Currently, the Python Worker always runs the stalled-check timer regardless of this value.

    @default False
    """

    lockDuration: int
    """
    Duration of the lock for the job in milliseconds. The lock represents that
    a worker is processing the job. If the lock is lost, the job will be eventually
    be picked up by the stalled checker and move back to wait so that another worker
    can process it again.

    @default 30000
    """

    lockRenewTime: int
    """
    Reserved/unsupported in the current Python client.

    In the JS SDK this configures the lock renewal interval. Currently, the Python Worker
    renews locks on a fixed `lockDuration / 2` interval.
    """

    skipLockRenewal: bool
    """
    Reserved/unsupported in the current Python client.

    In the JS SDK this disables lock renewal. Currently, the Python Worker always calls
    extendLocks() while a job is active.

    @default False
    """

    drainDelay: float
    """
    Number of seconds to long poll for jobs when the queue is empty.

    @default 5
    """

    runRetryDelay: int
    """
    This is an internal option that should not be modified.

    @default 15000
    """

    prefix: str
    """
    Prefix for all queue keys.
    """

    connection: Union[dict[str, Any], redis.Redis, str]
    """
    Options for connecting to a Redis instance.
    """
