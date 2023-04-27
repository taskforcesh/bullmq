from typing import TypedDict


class BackoffOptions(TypedDict, total=False):
    type: str | dict
    """
    Name of the backoff strategy.
    """

    delay: int
    """
    Delay in milliseconds.
    """
