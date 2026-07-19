"""Loads the shared PostgreSQL SQL (the single, portable source of truth).

The ``.sql`` files live in exactly one place — ``src/postgres`` at the repo root
— and are shared verbatim by every runtime. Each command file is a single
parameterized statement (a ``SELECT fn(...)`` for the PL/pgSQL operations, or a
direct query) and contains **no** schema/namespace references — the connection's
``search_path`` selects the schema — so they stay portable and injection-safe.

Resolution: when running from the repository (dev / editable install) the SQL is
read straight from ``src/postgres`` so there is never a duplicate to keep in
sync. In a published wheel that source tree is absent, so the files bundled next
to this module (copied at build time by ``copy_scripts.sh``, git-ignored like
the Redis ``.lua`` scripts) are used instead.
"""

from __future__ import annotations

import os

_MODULE_DIR = os.path.dirname(os.path.realpath(__file__))


def _resolve_sql_root() -> str:
    # Prefer the single source of truth in the repo (walk up to <repo>/src/postgres).
    directory = _MODULE_DIR
    for _ in range(8):
        candidate = os.path.join(directory, "src", "postgres")
        if os.path.isdir(os.path.join(candidate, "commands")):
            return candidate
        parent = os.path.dirname(directory)
        if parent == directory:
            break
        directory = parent
    # Installed package: SQL was bundled next to this module at build time.
    return _MODULE_DIR


_SQL_ROOT = _resolve_sql_root()
_COMMANDS_DIR = os.path.join(_SQL_ROOT, "commands")
_MIGRATIONS_DIR = os.path.join(_SQL_ROOT, "migrations")

_command_cache: dict[str, str] = {}
_migration_cache: dict[str, str] = {}


def load_command(name: str) -> str:
    """Load a runtime command's SQL by name (without the ``.sql`` extension)."""
    sql = _command_cache.get(name)
    if sql is None:
        with open(os.path.join(_COMMANDS_DIR, f"{name}.sql"), "r") as file:
            sql = file.read()
        _command_cache[name] = sql
    return sql


def load_migration(file: str) -> str:
    """Load a migration's SQL from its ``.sql`` file."""
    sql = _migration_cache.get(file)
    if sql is None:
        with open(os.path.join(_MIGRATIONS_DIR, file), "r") as handle:
            sql = handle.read()
        _migration_cache[file] = sql
    return sql


def migration_files() -> list[str]:
    """Return the ordered list of migration ``.sql`` filenames."""
    return sorted(
        f for f in os.listdir(_MIGRATIONS_DIR) if f.endswith(".sql")
    )
