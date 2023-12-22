
from typing import TypedDict, Any


class QueueBaseOptions(TypedDict, total=False):
    """
    Options for the Queue class.
    """

    prefix: str
    connection: dict[str, Any]
    """
    Prefix for all queue keys.
    """

