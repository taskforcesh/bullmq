from bullmq.types import QueueBaseOptions
from bullmq.backends import create_backend
from bullmq.job import Job
from uuid import uuid4


class MinimalQueue:
    """
    A lightweight queue view used by :class:`FlowProducer` for each node in a
    flow. It carries the node's queue identity and a backend scoped to that
    queue (sharing the flow producer's connection), which is what :class:`Job`
    needs to be constructed and, if necessary, operated on.
    """

    def __init__(self, name: str, backend, opts: QueueBaseOptions = {}):
        self.name = name
        self.opts = opts
        self.prefix = opts.get("prefix", "bull")
        self.backend = backend
        self.qualifiedName = backend.qualifiedName


class FlowProducer:
    """
    Instantiate a FlowProducer object
    """

    def __init__(self, opts: QueueBaseOptions = {}):
        """
        Initialize a connection
        """
        self.opts: dict = opts
        self.prefix = opts.get("prefix", "bull")
        self.backend = create_backend("__default__", opts)

    def queueFromNode(self, node: dict, prefix: str):
        queue_name = node.get("queueName")
        node_backend = self.backend.forQueue(queue_name, prefix)
        return MinimalQueue(queue_name, node_backend, {"prefix": prefix})

    async def addChildren(self, nodes, parent, queues_opts, entries):
        children = []
        for node in nodes:
            job = await self.addNode(node, parent, queues_opts, entries)
            children.append(job)
        return children

    async def addNodes(self, nodes: list[dict], entries):
        trees = []
        for node in nodes:
            parent_opts = node.get("opts", {}).get("parent", None)
            jobs_tree = await self.addNode(node, {"parentOpts": parent_opts}, None, entries)
            trees.append(jobs_tree)

        return trees

    async def addNode(self, node: dict, parent: dict, queues_opts: dict, entries: list):
        """
        Build the job for ``node`` (and, recursively, its children) and append
        it to the flat, pre-ordered ``entries`` list that is later inserted
        atomically via ``backend.addFlow``. A node with children is added as a
        parent job (before its children, which reference it).
        """
        prefix = node.get("prefix", self.prefix)
        queue = self.queueFromNode(node, prefix)
        queue_name = node.get("queueName")
        queue_opts = queues_opts and queues_opts.get(queue_name)

        default_job_options = queue_opts.get("defaultJobOptions") if queue_opts else {}
        jobs_opts = dict(default_job_options or {})
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

        if len(node_children) > 0:
            parent_id = job_id

            entries.append({"job": job, "is_parent": True})

            children = await self.addChildren(
                node_children,
                {
                    "parentOpts": {
                        "id": parent_id,
                        "queue": queue.qualifiedName
                    }
                },
                queues_opts,
                entries
                )
            return {"job": job, "children": children}
        else:
            entries.append({"job": job, "is_parent": False})

            return {"job": job}

    async def add(self, flow: dict, opts: dict = {}):
        parent_opts = flow.get("opts", {}).get("parent", None)

        entries: list = []
        jobs_tree = await self.addNode(flow, {"parentOpts": parent_opts}, opts.get("queuesOptions"), entries)
        await self.backend.addFlow(entries)

        return jobs_tree

    async def addBulk(self, flows: list[dict]):
        entries: list = []
        job_trees = await self.addNodes(flows, entries)
        await self.backend.addFlow(entries)

        return job_trees

    async def close(self):
        """
        Close the flow instance.
        """
        return await self.backend.close()
