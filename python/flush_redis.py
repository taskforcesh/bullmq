import asyncio

from bullmq.redis_connection import RedisConnection


async def flush():
    connection = RedisConnection()
    try:
        await connection.conn.flushall()
    finally:
        await connection.close()


if __name__ == '__main__':
    asyncio.run(flush())