
from typing import TypedDict


class PromoteJobsOptions(TypedDict, total=False):
    """
    Options for the promoteJobs method.
    """

    count: int
    """
    Maximum number of jobs to promote.
    """
