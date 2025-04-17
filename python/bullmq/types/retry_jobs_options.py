
from typing import TypedDict


class RetryJobsOptions(TypedDict, total=False):
    state: str
    count: int
    timestamp: int
