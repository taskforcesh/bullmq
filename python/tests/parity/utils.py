import json
import os
from typing import Any

from bullmq.types.queue_options import QueueBaseOptions


def getParityBackendOptions() -> QueueBaseOptions:
    backend = os.environ.get("PARITY_BACKEND")
    backendPort = os.environ.get("PARITY_BACKEND_PORT")
    if backend is None or backendPort is None:
        raise ValueError(
            "PARITY_BACKEND and PARITY_BACKEND_PORT environment variables required"
        )

    if backend == "redis":
        return {"backend": "redis", "connection": f"redis://localhost:{backendPort}"}

    if backend == "postgres":
        return {
            "backend": "postgres",
            "connection": {
                "host": "localhost",
                "port": int(backendPort),
                "dbname": "testdb",
                "user": "testuser",
                "password": "testpassword",
            },
        }

    raise ValueError(f"Invalid parity backend value '{backend}'")


def logEvent(event_type: str, data: dict[str, str | int] | None = None):
    run_id = os.environ.get("PARITY_RUN_ID")
    print(json.dumps({"type": event_type, "run_id": run_id, "data": data}), flush=True)


def readDefinitions() -> list[dict[str, Any]]:
    with open("../parity/definitions.json") as f:
        return json.load(f)
