import redis.asyncio as redis
from bullmq.scripts import Scripts

class Queue:
    """
    Instantiate a Queue object
    """
    def __init__(self, name: str, redisOpts={}, opts={}):
        """ "Initialize a connection" """

        host = redisOpts.get("host") or "localhost"
        port = redisOpts.get("port") or 6379
        db = redisOpts.get("db") or 0
        password = redisOpts.get("password") or None
        print("Connecting to Redis at " + host + ":" + str(port) + " db " + str(db))

        self.conn = redis.Redis(host=host, port=port, db=db, password=password)
        self.scripts = Scripts(opts.get("prefix") or "bull", name, self.conn)

    """
      Add an item to the queue.

        @param name: The name of the queue
        @param data: The data to add to the queue (must be JSON serializable)
    """
    def add(self, name: str, data, opts):
        """ "Add an item to the queue" """
        return self.scripts.addJob(name, data, opts or {})

    def pause(self):
        return self.scripts.pause(True)

    def resume(self):
        return self.scripts.pause(False)

    """
        Remove everything from the queue.
    """
    async def obliterate(self, force: bool = False):
        """ "Obliterate the queue" """
        await self.pause()
        while True:
            cursor = await self.scripts.obliterate(1000, force)
            if cursor == 0 or cursor == None or cursor == "0":
                break

    """
        Closes the queue and the underlying connection to Redis.
    """
    def close(self):
        """ "Close the connection" """
        return self.conn.close()
