from typing import TypedDict
from bullmq.types import BackoffOptions, KeepJobs


class JobOptions(TypedDict, total=False):
    backoff: int | BackoffOptions
    """
    Backoff setting for automatic retries if the job fails.
    """

    jobId: str
    """
    Override the job ID - by default, the job ID is a unique
    integer, but you can use this setting to override it.

    If you use this option, it is up to you to ensure the
    jobId is unique. If you attempt to add a job with an id that
    already exists, it will not be added.
    """

    timestamp: int
    """
    Timestamp when the job was created.

    @defaultValue round(time.time() * 1000)
    """

    delay: int
    """
    An amount of milliseconds to wait until this job can be processed.
    Note that for accurate delays, worker and producers
    should have their clocks synchronized.

    @defaultValue 0
    """

    attempts: int
    """
    The total number of attempts to try the job until it completes.

    @defaultValue 0
    """

    removeOnComplete: bool | int | KeepJobs
    """
    If true, removes the job when it successfully completes
    When given a number, it specifies the maximum amount of
    jobs to keep, or you can provide an object specifying max
    age and/or count to keep. It overrides whatever setting is used in the worker.
    Default behavior is to keep the job in the completed set.
    """

    removeOnFail: bool | int | KeepJobs
    """
    If true, removes the job when it fails after all attempts.
    When given a number, it specifies the maximum amount of
    jobs to keep, or you can provide an object specifying max
    age and/or count to keep. It overrides whatever setting is used in the worker.
    Default behavior is to keep the job in the failed set.
    """

    stackTraceLimit: int
    """
    Limits the amount of stack trace lines that will be recorded in the stacktrace.
    """
