from bullmq.backends.redis_backend import RedisBackend, create_redis_backend
from bullmq.backends.postgres_backend import PostgresBackend, create_postgres_backend

__all__ = [
    "RedisBackend",
    "create_redis_backend",
    "PostgresBackend",
    "create_postgres_backend",
    "create_backend",
]


def create_backend(
    name: str,
    opts: dict = {},
    blocking: bool = False,
    with_blocking_connection: bool = False,
):
    """Build the datastore backend selected by ``opts``.

    Selects the PostgreSQL adapter when ``opts["backend"] == "postgres"``,
    otherwise the default Redis adapter. The high-level classes call this so
    they depend only on the :class:`~bullmq.backend.Backend` abstraction.
    """
    if opts.get("backend") == "postgres":
        return create_postgres_backend(
            name, opts, blocking=blocking, with_blocking_connection=with_blocking_connection
        )
    return create_redis_backend(
        name, opts, blocking=blocking, with_blocking_connection=with_blocking_connection
    )
