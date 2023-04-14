from typing import TypedDict


class KeepJobs(TypedDict, total=False):
    """
    Specify which jobs to keep after finishing. If both age and count are
    specified, then the jobs kept will be the ones that satisfies both
    properties.
    """

    age: int
    """
    Maximum age in seconds for job to be kept.
    """

    count: int
    """
    Maximum count of jobs to be kept.
    """
