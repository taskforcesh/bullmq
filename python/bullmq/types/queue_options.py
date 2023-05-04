
from typing import TypedDict


class QueueOptions(TypedDict, total=False):
    """
    Options for the Queue class.
    """

    prefix: str
    """
    Prefix for all queue keys.
    """
