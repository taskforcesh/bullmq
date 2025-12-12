
from typing import TypedDict, Any, Union
import redis.asyncio as redis


class QueueBaseOptions(TypedDict, total=False):
    """
    Options for the Queue class.
    """

    prefix: str
    """
    Prefix for all queue keys.
    """

    connection: Union[dict[str, Any], redis.Redis, str]
    """
    Options for connecting to a Redis instance.
    """
