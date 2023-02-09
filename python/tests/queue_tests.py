"""
Tests for the queue module.

https://bbc.github.io/cloudfit-public-docs/asyncio/testing.html
"""

import asyncio
import unittest

from bullmq.queue import Queue;

queueName = "__bullmq_test_queue__"

# async def my_func():
#     await asyncio.sleep(0.1)
#     return True

class TestQueue(unittest.IsolatedAsyncioTestCase):
    
    async def asyncSetUp(self):
        print("Setting up test queue")
        # Delete test queue
        queue = Queue(queueName)
        await queue.pause()
        await queue.obliterate()
        await queue.close()
        
    async def test_add_job(self):
        queue = Queue(queueName)
        job = await queue.add("test-job", {"foo": "bar"}, {})
            
        self.assertEqual(job["jobId"], b"1")
        await queue.close()

if __name__ == '__main__':
    unittest.main()
