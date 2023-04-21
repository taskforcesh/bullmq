import redis.asyncio as redis


class RedisConnection:
    """
    RedisConnection class
    """

    def __init__(self, redisOpts: dict | str = {}):
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
