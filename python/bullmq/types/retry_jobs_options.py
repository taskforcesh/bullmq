
from typing import TypedDict


class RetryJobsOptions(TypedDict, total=False):
    """
    Options for the retryJobs method.
    """

    state: str
    """
    The state of the jobs to retry, e.g. 'failed' or 'completed'.
    """

    count: int
    """
    Maximum number of jobs to retry per batch.
    """

    timestamp: int
    """
    Timestamp threshold; only jobs older than this will be retried.
    """

