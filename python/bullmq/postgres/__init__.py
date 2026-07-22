"""PostgreSQL SQL loader package.

The ``commands/`` and ``migrations/`` SQL live in a single source of truth at
``src/postgres`` and are copied here at build time by ``copy_scripts.sh`` (the
copies are git-ignored, mirroring how the Redis ``.lua`` scripts are handled).
"""
