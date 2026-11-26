from typing import TypedDict


class RateLimiterOptions(TypedDict):
    max: int
    """
    Max number of jobs to process in the time period
    specified in `duration`.
    """

    duration: int
    """
    Time in milliseconds. During this time, a maximum
    of `max` jobs will be processed.
    """
