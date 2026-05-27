from typing import TypedDict, Union


class BackoffOptions(TypedDict, total=False):
    type: Union[str, dict]
    """
    Name of the backoff strategy.
    """

    delay: int
    """
    Delay in milliseconds.
    """
