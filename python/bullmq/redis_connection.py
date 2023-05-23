import redis.asyncio as redis
import warnings

class RedisConnection:
    """
    RedisConnection class
    """

    minimum_version = '5.0.0'
    recommended_minimum_version = '6.2.0'

    def __init__(self, redisOpts: dict | str = {}):
        self.version = None
        if isinstance(redisOpts, dict):
            host = redisOpts.get("host") or "localhost"
            port = redisOpts.get("port") or 6379
            db = redisOpts.get("db") or 0
            password = redisOpts.get("password") or None

            self.conn = redis.Redis(
                host=host, port=port, db=db, password=password, decode_responses=True)
        else:
            self.conn = redis.from_url(redisOpts, decode_responses=True)

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
        return doc.get("redis_version")
