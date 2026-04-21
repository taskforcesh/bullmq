
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
    Skip stalled check for this worker. Note that other workers could still
    perform stalled checks and move jobs back to wait for jobs being processed
    by this worker.

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
    The time in milliseconds before the lock is automatically renewed.

    It is not recommended to modify this value, which by default is set to
    half of lockDuration, optimal for most use cases.
    """

    skipLockRenewal: bool
    """
    Skip lock renewal for this worker. If set to true, the lock will expire
    after lockDuration and moved back to the wait queue (if the stalled check is
    not disabled).

    @default False
    """

    drainDelay: int
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
