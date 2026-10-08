
from typing import TypedDict
from bullmq.types.connection_options import ConnectionOptions
from bullmq.types.job_options import JobOptions


class QueueBaseOptions(TypedDict, total=False):
    """
    Options for the Queue class.
    """

    prefix: str
    """
    Prefix for all queue keys.
    """

    connection: ConnectionOptions
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
