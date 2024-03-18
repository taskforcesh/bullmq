import redis.asyncio as redis
from redis.backoff import ExponentialBackoff
from redis.retry import Retry
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
        "canDoubleTimeout": False
    }

    def __init__(self, redisOpts: dict | str = {}):
        self.version = None
        retry = Retry(ExponentialBackoff(), 3)
        retry_errors = [BusyLoadingError, ConnectionError, TimeoutError]

        if isinstance(redisOpts, dict):
            host = redisOpts.get("host") or "localhost"
            port = redisOpts.get("port") or 6379
            db = redisOpts.get("db") or 0
            password = redisOpts.get("password") or None
            username = redisOpts.get("username") or None

            self.conn = redis.Redis(
                host=host, port=port, db=db, password=password, decode_responses=True,
                retry=retry, retry_on_error=retry_errors, username=username)
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
            "canDoubleTimeout": not isRedisVersionLowerThan(self.version, '6.0.0')
        }
        return self.version
