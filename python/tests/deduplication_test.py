"""
Tests for deduplication functionality.

Tests simple mode, throttle mode, and debounce mode deduplication.
"""

from bullmq import Queue
from uuid import uuid4

import asyncio
import redis.asyncio as redis
import unittest
import os

queueName = ""
prefix = os.environ.get('BULLMQ_TEST_PREFIX') or "bull"

class TestDeduplication(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        print("Setting up test queue")
        queueName = f"__test_queue__{uuid4().hex}"

    async def asyncTearDown(self):
        connection = redis.Redis(host='localhost')
        await connection.flushdb()

    async def test_simple_mode_deduplication(self):
        """Test simple mode where deduplication lasts until job is completed"""
        queue = Queue(queueName, {"prefix": prefix})
        
        # Add first job with deduplication
        job1 = await queue.add("test-job", {"color": "white"}, {
            "deduplication": {"id": "customValue"}
        })
        
        # Try to add second job with same deduplication ID
        job2 = await queue.add("test-job", {"color": "black"}, {
            "deduplication": {"id": "customValue"}
        })
        
        # The second job should be deduplicated (return the first job's ID)
        self.assertEqual(job1.id, job2.id)
        
        # Verify only one job exists in the queue
        jobs = await queue.getJobs(["waiting"])
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0].id, job1.id)
        
        await queue.close()

    async def test_throttle_mode_deduplication(self):
        """Test throttle mode with TTL"""
        queue = Queue(queueName, {"prefix": prefix})
        
        # Add first job with deduplication and 1 second TTL
        job1 = await queue.add("test-job", {"color": "white"}, {
            "deduplication": {"id": "throttleTest", "ttl": 1000}
        })
        
        # Try to add second job immediately (should be deduplicated)
        job2 = await queue.add("test-job", {"color": "black"}, {
            "deduplication": {"id": "throttleTest", "ttl": 1000}
        })
        
        self.assertEqual(job1.id, job2.id)
        
        # Wait for TTL to expire (with small buffer)
        await asyncio.sleep(1.1)
        
        # Now we should be able to add a new job
        job3 = await queue.add("test-job", {"color": "red"}, {
            "deduplication": {"id": "throttleTest", "ttl": 1000}
        })
        
        self.assertNotEqual(job1.id, job3.id)
        
        await queue.close()

    async def test_debounce_mode_with_replace(self):
        """Test debounce mode where job data is replaced"""
        queue = Queue(queueName, {"prefix": prefix})
        
        # Add multiple jobs with replace option
        for i in range(1, 6):
            await queue.add(
                "test-job",
                {"color": f"white {i}"},
                {
                    "deduplication": {
                        "id": "debounceTest",
                        "ttl": 2000,
                        "extend": True,
                        "replace": True
                    },
                    "delay": 2000
                }
            )
        
        # Wait a bit to ensure all jobs are processed
        await asyncio.sleep(0.1)
        
        # Only one job should exist in delayed state
        delayed_jobs = await queue.getJobs(["delayed"])
        self.assertEqual(len(delayed_jobs), 1)
        
        # The job should have the latest data
        self.assertEqual(delayed_jobs[0].data["color"], "white 5")
        
        await queue.close()

    async def test_deduplication_with_extend(self):
        """Test deduplication with extend option"""
        queue = Queue(queueName, {"prefix": prefix})
        
        # Add first job with extend option
        job1 = await queue.add("test-job", {"value": 1}, {
            "deduplication": {"id": "extendTest", "ttl": 1000, "extend": True}
        })
        
        # Wait half the TTL
        await asyncio.sleep(0.6)
        
        # Add second job (should extend TTL)
        job2 = await queue.add("test-job", {"value": 2}, {
            "deduplication": {"id": "extendTest", "ttl": 1000, "extend": True}
        })
        
        # Should be deduplicated
        self.assertEqual(job1.id, job2.id)
        
        # Wait original TTL period (should still be deduplicated)
        await asyncio.sleep(0.6)
        
        # Try to add another job (should still be deduplicated due to extended TTL)
        job3 = await queue.add("test-job", {"value": 3}, {
            "deduplication": {"id": "extendTest", "ttl": 1000, "extend": True}
        })
        
        self.assertEqual(job1.id, job3.id)
        
        await queue.close()

    async def test_different_deduplication_ids(self):
        """Test that different deduplication IDs create different jobs"""
        queue = Queue(queueName, {"prefix": prefix})
        
        job1 = await queue.add("test-job", {"value": 1}, {
            "deduplication": {"id": "id1"}
        })
        
        job2 = await queue.add("test-job", {"value": 2}, {
            "deduplication": {"id": "id2"}
        })
        
        # Different IDs should create different jobs
        self.assertNotEqual(job1.id, job2.id)
        
        # Verify both jobs exist
        jobs = await queue.getJobs(["waiting"])
        self.assertEqual(len(jobs), 2)
        
        await queue.close()

    async def test_deduplication_without_ttl(self):
        """Test deduplication without TTL (lasts until job completion)"""
        queue = Queue(queueName, {"prefix": prefix})
        
        job1 = await queue.add("test-job", {"value": 1}, {
            "deduplication": {"id": "noTtlTest"}
        })
        
        # Wait a bit
        await asyncio.sleep(1)
        
        # Should still be deduplicated
        job2 = await queue.add("test-job", {"value": 2}, {
            "deduplication": {"id": "noTtlTest"}
        })
        
        self.assertEqual(job1.id, job2.id)
        
        await queue.close()

    async def test_returns_none_when_no_deduplicated_job(self):
        result = await self.queue.getDeduplicationJobId("missing-id")
        self.assertIsNone(result)

    async def test_returns_job_id_for_simple_mode(self):
        job = await self.queue.add(
            "test-job", {}, {"deduplication": {"id": "my-dedup-id"}}
        )

        result = await self.queue.getDeduplicationJobId("my-dedup-id")

        self.assertEqual(result, job.id)

    async def test_returns_job_id_for_throttle_mode_within_ttl(self):
        job = await self.queue.add(
            "test-job", {}, {"deduplication": {"id": "throttle-id", "ttl": 5000}}
        )

        result = await self.queue.getDeduplicationJobId("throttle-id")

        self.assertEqual(result, job.id)

    async def test_returns_none_after_job_completes_simple_mode(self):
        await self.queue.add(
            "test-job", {}, {"deduplication": {"id": "completing-id"}}
        )
        worker = Worker(queueName, None, {"prefix": prefix})
        token = 'my-token'

        job = await worker.getNextJob(token)

        await job.moveToCompleted("done", token="test-token", fetchNext=False)
        # or drive it through a real Worker if that's the repo's convention
        # for exercising completion in this test file

        result = await self.queue.getDeduplicationJobId("completing-id")

        self.assertIsNone(result)

    async def test_deprecated_get_debounce_job_id_delegates(self):
        job = await self.queue.add(
            "test-job", {}, {"deduplication": {"id": "alias-id"}}
        )

        result = await self.queue.getDebounceJobId("alias-id")

        self.assertEqual(result, job.id)

    async def test_ignores_deduplication_id_from_other_queue(self):
        other_queue_name = f"{self.queueName}-other"
        other_queue = Queue(other_queue_name, {"connection": redis_connection})
        try:
            await other_queue.add(
                "test-job", {}, {"deduplication": {"id": "shared-id"}}
            )
            result = await self.queue.getDeduplicationJobId("shared-id")
            self.assertIsNone(result)
        finally:
            await other_queue.close()

if __name__ == '__main__':
    unittest.main()
