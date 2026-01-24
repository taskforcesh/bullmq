import json
import traceback
from typing import Any

import semver


def isRedisVersionLowerThan(current_version, minimum_version):
    return semver.Version.parse(current_version).compare(minimum_version) == -1


def extract_result(job_task, emit_callback):
    try:
        return job_task.result()
    except Exception as e:
        if not str(e).startswith('Connection closed by server'):
            # lets use a simple-but-effective error handling:
            # ignore the job
            traceback.print_exc()
            emit_callback("error", e)

def get_parent_key(opts: dict[str, str]):
    if opts:
        return f"{opts.get('queue')}:{opts.get('id')}"

def parse_json_string_values(input_dict: dict[str, str]) -> dict[str, dict]:
    return {key: json.loads(value) for key, value in input_dict.items()}

def object_to_flat_array(obj: dict[str, Any]) -> list[Any]:
    """
    Converts a dictionary into a flat array where each key is followed by its value.

    Args:
        obj (dict[str, Any]): The input dictionary to flatten.

    Returns:
        list[Any]: A flat list containing keys and values from the dictionary in order.
    """
    arr = []
    for key, value in obj.items():
        arr.append(key)
        arr.append(value)
    return arr


def is_redis_cluster(client: Any) -> bool:
    try:
        from redis.asyncio.cluster import RedisCluster
    except Exception:
        RedisCluster = None

    if RedisCluster is not None and isinstance(client, RedisCluster):
        return True

    return bool(
        getattr(client, "is_cluster", False)
        or getattr(client, "isCluster", False)
        or getattr(client, "nodes_manager", None)
    )


def get_cluster_nodes(client: Any) -> list[Any]:
    if hasattr(client, "get_nodes") and callable(getattr(client, "get_nodes")):
        try:
            return list(client.get_nodes())
        except Exception:
            return []

    nodes_manager = getattr(client, "nodes_manager", None)
    if nodes_manager is not None and hasattr(nodes_manager, "nodes_cache"):
        try:
            return list(nodes_manager.nodes_cache.values())
        except Exception:
            return []

    if hasattr(client, "nodes") and callable(getattr(client, "nodes")):
        try:
            return list(client.nodes())
        except Exception:
            return []

    return []


def get_node_client(node: Any) -> Any:
    for attr in ("client", "redis", "connection", "redis_connection"):
        if hasattr(node, attr):
            return getattr(node, attr)
    return node
