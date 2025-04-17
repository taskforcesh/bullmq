import redis.asyncio as redis
from redis.backoff import ExponentialBackoff
from redis.asyncio.retry import Retry
from redis.exceptions import (
   BusyLoadingError,
   ConnectionError,
   TimeoutError
)
import warnings
from bullmq.utils import isRedisVersionLowerThan

class RedisConnection:
    """
    RedisConnection class
    """

    minimum_version = '5.0.0'
    recommended_minimum_version = '6.2.0'

    capabilities = {
        "canBlockFor1Ms": True,
        "canDoubleTimeout": False
    }

    def __init__(self, redisOpts: dict | str | redis.Redis = {}):
        self.version = None
        retry = Retry(ExponentialBackoff(cap=20, base=1), 20)
        retry_errors = [BusyLoadingError, ConnectionError, TimeoutError]

        if isinstance(redisOpts, redis.Redis):
            self.conn = redisOpts
        elif isinstance(redisOpts, dict):
            defaultOpts = {
                "host": "localhost",
                "port": 6379,
                "db": 0,
                "password": None,
                "username": None,
            }
            finalOpts = {**defaultOpts, **redisOpts}

            self.conn = redis.Redis(decode_responses=True, retry=retry, retry_on_error=retry_errors, **finalOpts)
        else:
            self.conn = redis.from_url(redisOpts, decode_responses=True, retry=retry,
                retry_on_error=retry_errors)

    def disconnect(self):
        """
        Disconnect from Redis
        """
        return self.conn.disconnect()

    def close(self):
        """
        Close the connection
        """
        return self.conn.close()

    async def getRedisVersion(self):
        if self.version is not None:
            return self.version

        doc = await self.conn.info()
        if doc.get("maxmemory_policy") != "noeviction":
            warnings.warn(f'IMPORTANT! Eviction policy is {doc.get("maxmemory_policy")}. It should be "noeviction"')

        self.version = doc.get("redis_version")

        self.capabilities = {
            "canBlockFor1Ms": not isRedisVersionLowerThan(self.version, '7.0.8'),
            "canDoubleTimeout": not isRedisVersionLowerThan(self.version, '6.0.0')
        }
        return self.version
