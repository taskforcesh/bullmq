
from typing import TypedDict, Any
import redis.asyncio as redis


class QueueBaseOptions(TypedDict, total=False):
    """
    Options for the Queue class.
    """

    prefix: str
    connection: dict[str, Any] | redis.Redis
    """
    Prefix for all queue keys.
    """
