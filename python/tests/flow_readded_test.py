import asyncio
import os
import unittest
from uuid import uuid4

from bullmq import FlowProducer, Queue, Worker


class TestReaddedFlow(unittest.IsolatedAsyncioTestCase):
    async def check_readded_flow(self, completed_first, bulk):
        queue_name = f"readded-{uuid4().hex}"
        opts = {"connection": {
            "host": os.environ.get("REDIS_HOST", "localhost"),
            "port": int(os.environ.get("REDIS_PORT", 6379)),
        }}
        queue = Queue(queue_name, opts)
        flow = FlowProducer(opts)
        worker = Worker(queue_name, None, {**opts, "autorun": False})
        token = "flow-registration-test"
        cached = {
            "name": "cached", "queueName": queue_name,
            "opts": {"jobId": "cached"},
        }
        try:
            await flow.add({
                "name": "parent", "queueName": queue_name,
                "opts": {"jobId": "parent", "removeOnComplete": True},
                "children": [cached],
            })
            child = await asyncio.wait_for(worker.getNextJob(token), 3)
            self.assertEqual(child.id, "cached")
            await child.moveToCompleted("cached result", token)
            parent = await asyncio.wait_for(worker.getNextJob(token), 3)
            self.assertEqual(parent.id, "parent")
            await parent.moveToCompleted("first result", token)
            self.assertIsNone(await queue.getJob("parent"))

            fresh = {
                "name": "fresh", "queueName": queue_name,
                "opts": {"jobId": "fresh"},
            }
            node = {
                "name": "parent", "queueName": queue_name,
                "opts": {"jobId": "parent"},
                "children": [cached, fresh] if completed_first else [fresh, cached],
            }
            tree = (await flow.addBulk([node]))[0] if bulk else await flow.add(node)
            self.assertEqual(await tree["job"].getState(), "waiting-children")

            child = await asyncio.wait_for(worker.getNextJob(token), 3)
            self.assertEqual(child.id, "fresh")
            await child.moveToCompleted("fresh result", token)
            parent = await asyncio.wait_for(worker.getNextJob(token), 3)
            self.assertEqual(parent.id, "parent")
            self.assertEqual(
                sorted((await parent.getChildrenValues()).values()),
                ["cached result", "fresh result"],
            )
            await parent.moveToCompleted("second result", token)
            self.assertEqual(await tree["job"].getState(), "completed")
        finally:
            await worker.close()
            await flow.close()
            await queue.obliterate(force=True)
            await queue.close()

    async def test_completed_first_add(self):
        await self.check_readded_flow(True, False)

    async def test_completed_last_add(self):
        await self.check_readded_flow(False, False)

    async def test_completed_first_bulk(self):
        await self.check_readded_flow(True, True)

    async def test_completed_last_bulk(self):
        await self.check_readded_flow(False, True)
