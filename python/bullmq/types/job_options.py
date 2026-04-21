from typing import TypedDict, Union
from bullmq.types.backoff_options import BackoffOptions
from bullmq.types.keep_jobs import KeepJobs
from bullmq.types.deduplication_options import DeduplicationOptions


class JobOptions(TypedDict, total=False):
    backoff: Union[int, BackoffOptions]
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

    priority: int
    """
    Ranges from 0 (highest priority) to 2 097 152 (lowest priority). Note that
    using priorities has a slight impact on performance, so do not use it if not required.

    @default 0
    """

    lifo: bool
    """
    If true, adds the job to the right of the queue instead of the left (default false).

    @see https://docs.bullmq.io/guide/jobs/lifo
    """

    attempts: int
    """
    The total number of attempts to try the job until it completes.

    @defaultValue 0
    """

    removeOnComplete: Union[bool, int, KeepJobs]
    """
    If true, removes the job when it successfully completes
    When given a number, it specifies the maximum amount of
    jobs to keep, or you can provide an object specifying max
    age and/or count to keep. It overrides whatever setting is used in the worker.
    Default behavior is to keep the job in the completed set.
    """

    removeOnFail: Union[bool, int, KeepJobs]
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

    keepLogs: int
    """
    Limits the number of log entries that will be preserved for the job.
    If not specified, all logs are kept.
    """

    sizeLimit: int
    """
    Limits the size in bytes of the job's data. If the job data
    exceeds this limit, the job will be rejected.
    """

    deduplication: DeduplicationOptions
    """
    Deduplication options to prevent duplicate jobs from being added to the queue.
    
    This can be used to implement throttling, debouncing, or simple deduplication
    where jobs with the same deduplication ID are ignored.
    """

    failParentOnFailure: bool
    """
    If true, moves parent to failed when this child job fails after all attempts.
    """

    continueParentOnFailure: bool
    """
    If true, starts processing parent job as soon as this child job fails.
    """

    ignoreDependencyOnFailure: bool
    """
    If true, moves the jobId from its parent dependencies to failed dependencies when it fails after all attempts.
    """

    removeDependencyOnFailure: bool
    """
    If true, removes the job from its parent dependencies when it fails after all attempts.
    """
