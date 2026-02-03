import redis.asyncio as redis
from typing import Union
from redis.backoff import ExponentialBackoff
from redis.asyncio.retry import Retry
from redis.exceptions import (
   BusyLoadingError,
   ConnectionError,
   TimeoutError
)
import warnings
import os
from bullmq.utils import isRedisVersionLowerThan, is_redis_cluster, get_cluster_nodes, get_node_client

basePath = os.path.dirname(os.path.realpath(__file__))

# Script definitions mapping script names to their file names
SCRIPT_DEFINITIONS = {
    "addStandardJob": "addStandardJob-9.lua",
    "addDelayedJob": "addDelayedJob-6.lua",
    "addParentJob": "addParentJob-6.lua",
    "addPrioritizedJob": "addPrioritizedJob-9.lua",
    "changePriority": "changePriority-7.lua",
    "cleanJobsInSet": "cleanJobsInSet-3.lua",
    "drain": "drain-5.lua",
    "extendLock": "extendLock-2.lua",
    "getCounts": "getCounts-1.lua",
    "getCountsPerPriority": "getCountsPerPriority-4.lua",
    "getRanges": "getRanges-1.lua",
    "getState": "getState-8.lua",
    "getStateV2": "getStateV2-8.lua",
    "isJobInList": "isJobInList-1.lua",
    "moveStalledJobsToWait": "moveStalledJobsToWait-8.lua",
    "moveToActive": "moveToActive-11.lua",
    "moveToDelayed": "moveToDelayed-8.lua",
    "moveToFinished": "moveToFinished-14.lua",
    "moveToWaitingChildren": "moveToWaitingChildren-7.lua",
    "obliterate": "obliterate-2.lua",
    "pause": "pause-7.lua",
    "promote": "promote-9.lua",
    "removeJob": "removeJob-2.lua",
    "reprocessJob": "reprocessJob-8.lua",
    "retryJob": "retryJob-11.lua",
    "moveJobsToWait": "moveJobsToWait-8.lua",
    "saveStacktrace": "saveStacktrace-1.lua",
    "updateData": "updateData-1.lua",
    "updateProgress": "updateProgress-3.lua",
}


def loadScript(name: str) -> str:
    """
    Load a Lua script by name from the commands directory.
    """
    with open(f"{basePath}/commands/{name}", "r") as file:
        return file.read()


class RedisConnection:
    """
    RedisConnection class
    """

    minimum_version = '5.0.0'
    recommended_minimum_version = '6.2.0'

    capabilities = {
        "canBlockFor1Ms": True,
        "canDoubleTimeout": False
    }

    def __init__(self, redisOpts: Union[dict, str, redis.Redis] = {}):
        self.version = None
        retry = Retry(ExponentialBackoff(cap=20, base=1), 20)
        retry_errors = [BusyLoadingError, ConnectionError, TimeoutError]

        if isinstance(redisOpts, redis.Redis):
            self.conn = redisOpts
        elif isinstance(redisOpts, dict):
            defaultOpts = {
                "host": "localhost",
                "port": 6379,
                "db": 0,
                "password": None,
                "username": None,
            }
            finalOpts = {**defaultOpts, **redisOpts}

            self.conn = redis.Redis(decode_responses=True, retry=retry, retry_on_error=retry_errors, **finalOpts)
        else:
            self.conn = redis.from_url(redisOpts, decode_responses=True, retry=retry,
                retry_on_error=retry_errors)

        self.commands = {}
        self.loadCommands()

    def loadCommands(self):
        """
        Load and register all Lua scripts on the Redis client.
        This is called once during initialization to avoid re-registering
        scripts on every Scripts instance creation.
        """
        for name, filename in SCRIPT_DEFINITIONS.items():
            if name not in self.commands:
                self.commands[name] = self.conn.register_script(loadScript(filename))

    def disconnect(self):
        """
        Disconnect from Redis
        """
        return self.conn.disconnect()

    async def close(self):
        """
        Close the connection
        """
        return await self.conn.aclose()

    async def getRedisVersion(self):
        if self.version is not None:
            return self.version

        doc = await self.conn.info()
        if doc.get("maxmemory_policy") != "noeviction":
            warnings.warn(f'IMPORTANT! Eviction policy is {doc.get("maxmemory_policy")}. It should be "noeviction"')

        self.version = doc.get("redis_version")

        self.capabilities = {
            "canBlockFor1Ms": not isRedisVersionLowerThan(self.version, '7.0.8'),
            "canDoubleTimeout": not isRedisVersionLowerThan(self.version, '6.0.0')
        }
        return self.version

    async def set_client_name(self, name: str):
        if not name:
            return

        self.client_name = name

        if is_redis_cluster(self.conn):
            nodes = get_cluster_nodes(self.conn)
            for node in nodes:
                node_client = get_node_client(node)
                self._set_client_name_on_pool(node_client, name)
                await self._set_client_name_on_client(node_client, name)
        else:
            self._set_client_name_on_pool(self.conn, name)
            await self._set_client_name_on_client(self.conn, name)

    async def _set_client_name_on_client(self, client, name: str):
        if hasattr(client, "client_setname"):
            await client.client_setname(name)
        else:
            await client.execute_command("CLIENT", "SETNAME", name)

    def _set_client_name_on_pool(self, client, name: str):
        pool = getattr(client, "connection_pool", None)
        if pool is None:
            return

        connection_kwargs = getattr(pool, "connection_kwargs", None)
        if isinstance(connection_kwargs, dict):
            connection_kwargs["client_name"] = name
