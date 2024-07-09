from bullmq.redis_connection import RedisConnection
from bullmq.types import QueueBaseOptions
from bullmq.scripts import Scripts
from bullmq.job import Job
from bullmq.queue_keys import QueueKeys
from uuid import uuid4


class MinimalQueue:
    """
    Instantiate a MinimalQueue object
    """

    def __init__(self, name: str, queue_keys, redisConnection, opts: QueueBaseOptions = {}):
        """
        Initialize a connection
        """
        self.name = name
        self.redisConnection = redisConnection
        self.client = self.redisConnection.conn
        self.opts = opts
        self.prefix = opts.get("prefix", "bull"),
        self.keys = queue_keys.getKeys(name)
        self.qualifiedName = queue_keys.getQueueQualifiedName(name)


class FlowProducer:
    """
    Instantiate a FlowProducer object
    """

    def __init__(self, redisOpts: dict | str = {}, opts: QueueBaseOptions = {}):
        """
        Initialize a connection
        """
        self.redisConnection = RedisConnection(redisOpts)
        self.client = self.redisConnection.conn
        self.opts: dict = opts
        self.prefix = opts.get("prefix", "bull")
        self.scripts = Scripts(
            self.prefix, "__default__", self.redisConnection)

    def queueFromNode(self, node:dict, queue_keys, prefix: str):
        return MinimalQueue(node.get("queueName"),queue_keys,self.redisConnection, {"prefix": prefix})

    async def addChildren(self, nodes, parent, queues_opts, pipe):
        children = []
        for node in nodes:
            job = await self.addNode(node, parent, queues_opts, pipe)
            children.append(job)
        return children

    async def addNodes(self, nodes: list[dict], pipe):
        trees = []
        for node in nodes:
            parent_opts = node.get("opts", {}).get("parent", None)
            jobs_tree = await self.addNode(node, {"parentOpts": parent_opts},None, pipe)
            trees.append(jobs_tree)

        return trees

    async def addNode(self, node: dict, parent: dict, queues_opts: dict, pipe):
        prefix = node.get("prefix", self.prefix)
        queue = self.queueFromNode(node, QueueKeys(prefix), prefix)
        queue_name = node.get("queueName")
        queue_opts = queues_opts and queues_opts.get(queue_name)

        jobs_opts = queue_opts.get('defaultJobOptions',{}) if queue_opts else {}
        jobs_opts.update(node.get("opts") or {})
        job_id = (node.get("opts") or {}).get("jobId") or uuid4().hex
        parent_opts = parent.get("parentOpts")
        
        jobs_opts.update({"parent": parent_opts})

        job = Job(
            queue=queue,
            name=node.get("name"),
            data=node.get("data"),
            opts=jobs_opts,
            job_id=job_id
            )

        node_children = node.get("children", [])

        self.scripts.resetQueueKeys(queue_name)
        if len(node_children) > 0:
            parent_id = job_id
            queue_keys_parent = QueueKeys(prefix or self.opts.get("prefix", "bull"))
            wait_children_key = queue_keys_parent.toKey(queue_name, "waiting-children")

            await self.scripts.addParentJob(
                job,
                wait_children_key,
                pipe
            )

            children = await self.addChildren(
                node_children,
                {  
                    "parentOpts": {
                        "id": parent_id,
                        "queue": queue.qualifiedName
                    } 
                },
                queues_opts,
                pipe
                )
            return {"job": job, "children": children}
        else:
            await self.scripts.addJob(
                job,
                pipe
            )

            return {"job": job}

    async def add(self, flow: dict, opts: dict = {}):
        parent_opts = flow.get("opts", {}).get("parent", None)

        result = None
        async with self.redisConnection.conn.pipeline(transaction=True) as pipe:
            jobs_tree = await self.addNode(flow, {"parentOpts": parent_opts},opts.get("queuesOptions"), pipe)
            await pipe.execute()
            result = jobs_tree

        return result

    async def addBulk(self, flows: list[dict]):
        result = None
        async with self.redisConnection.conn.pipeline(transaction=True) as pipe:
            job_trees = await self.addNodes(flows, pipe)
            await pipe.execute()
            result = job_trees

        return result

    def close(self):
        """
        Close the flow instance.
        """
        return self.redisConnection.close()
