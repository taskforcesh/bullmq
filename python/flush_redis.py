import asyncio

from bullmq.redis_connection import RedisConnection


async def flush():
    await RedisConnection().conn.flushall()


if __name__ == '__main__':
    asyncio.run(flush())