"""
Tests for global rate limit and global concurrency on Queue.
"""

import os
import unittest
from uuid import uuid4

import redis.asyncio as redis

from bullmq import Queue


prefix = os.environ.get("BULLMQ_TEST_PREFIX") or "bull"


class TestGlobalConcurrency(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        self.queueName = f"__test_queue__{uuid4().hex}"

    async def asyncTearDown(self):
        connection = redis.Redis(host="localhost")
        await connection.flushdb()
        await connection.aclose()

    async def test_set_get_and_remove_global_concurrency(self):
        queue = Queue(self.queueName, {"prefix": prefix})
        try:
            self.assertIsNone(await queue.getGlobalConcurrency())

            await queue.setGlobalConcurrency(5)
            self.assertEqual(await queue.getGlobalConcurrency(), 5)

            await queue.setGlobalConcurrency(1)
            self.assertEqual(await queue.getGlobalConcurrency(), 1)

            removed = await queue.removeGlobalConcurrency()
            self.assertEqual(removed, 1)
            self.assertIsNone(await queue.getGlobalConcurrency())
        finally:
            await queue.close()


class TestGlobalRateLimit(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        self.queueName = f"__test_queue__{uuid4().hex}"

    async def asyncTearDown(self):
        connection = redis.Redis(host="localhost")
        await connection.flushdb()
        await connection.aclose()

    async def test_set_and_get_global_rate_limit(self):
        queue = Queue(self.queueName, {"prefix": prefix})
        try:
            self.assertIsNone(await queue.getGlobalRateLimit())

            await queue.setGlobalRateLimit(100, 1000)
            rate = await queue.getGlobalRateLimit()
            self.assertEqual(rate, {"max": 100, "duration": 1000})
        finally:
            await queue.close()

    async def test_remove_global_rate_limit(self):
        queue = Queue(self.queueName, {"prefix": prefix})
        try:
            await queue.setGlobalRateLimit(100, 1000)
            self.assertEqual(
                await queue.getGlobalRateLimit(),
                {"max": 100, "duration": 1000},
            )

            removed = await queue.removeGlobalRateLimit()
            # `max` and `duration` were both present.
            self.assertEqual(removed, 2)
            self.assertIsNone(await queue.getGlobalRateLimit())

            # Idempotent: removing again is a no-op.
            removed_again = await queue.removeGlobalRateLimit()
            self.assertEqual(removed_again, 0)
        finally:
            await queue.close()

    async def test_rate_limit_writes_limiter_key_with_ttl(self):
        queue = Queue(self.queueName, {"prefix": prefix})
        try:
            await queue.rateLimit(5000)
            ttl = await queue.getRateLimitTtl()
            # PTTL returns -2 when missing, -1 when no expire, >=0 when set.
            self.assertGreater(ttl, 0)
            self.assertLessEqual(ttl, 5000)
        finally:
            await queue.close()

    async def test_remove_rate_limit_key(self):
        queue = Queue(self.queueName, {"prefix": prefix})
        try:
            await queue.rateLimit(5000)
            removed = await queue.removeRateLimitKey()
            self.assertEqual(removed, 1)

            ttl = await queue.getRateLimitTtl()
            # Key is gone -> -2.
            self.assertEqual(ttl, -2)

            # Idempotent: removing again is a no-op.
            removed_again = await queue.removeRateLimitKey()
            self.assertEqual(removed_again, 0)
        finally:
            await queue.close()


if __name__ == "__main__":
    unittest.main()
