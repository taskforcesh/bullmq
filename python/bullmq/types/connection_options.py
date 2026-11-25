from typing import Any, Union

import redis.asyncio as redis
from redis.asyncio.cluster import RedisCluster

ConnectionOptions = Union[dict[str, Any], str, redis.Redis, RedisCluster]
"""
A Redis URL, connection keyword arguments, or a ready redis-py client
(standalone or cluster).
"""
