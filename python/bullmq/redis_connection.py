import redis.asyncio as redis
from typing import Any, Union
from redis.backoff import ExponentialBackoff
from redis.asyncio.retry import Retry
from redis.exceptions import (
   BusyLoadingError,
   ConnectionError,
   TimeoutError
)
import warnings
from bullmq.utils import isRedisVersionLowerThan, is_redis_cluster, get_cluster_nodes, get_node_client
from bullmq import __version__ as package_version

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

        # Add driver identification for redis-py
        self._add_driver_info()

    def _add_driver_info(self) -> None:
        """Add driver identification to Redis connection.

        Uses DriverInfo class if available, or falls back to
        lib_name/lib_version for older versions.
        """
        # Get connection pool from the redis client
        connection_pool: Any = getattr(self.conn, "connection_pool", None)
        if connection_pool is None:
            return

        # Try to use DriverInfo class
        try:
            from redis import DriverInfo

            driver_info = DriverInfo().add_upstream_driver("bullmq", package_version)
            connection_pool.connection_kwargs["driver_info"] = driver_info
        except (ImportError, AttributeError):
            # Fallback: use lib_name/lib_version
            bullmq_suffix = f"_v{package_version}" if package_version else ""
            connection_pool.connection_kwargs["lib_name"] = f"redis-py(bullmq{bullmq_suffix})"
            # lib_version should be the redis client version
            try:
                import redis as redis_sync

                redis_version = redis_sync.__version__
            except (ImportError, AttributeError):
                redis_version = None
            if redis_version:
                connection_pool.connection_kwargs["lib_version"] = redis_version

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
