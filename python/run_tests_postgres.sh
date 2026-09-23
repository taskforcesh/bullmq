#!/bin/bash
# Run the Python test-suite against the PostgreSQL backend.
#
# Requires a running PostgreSQL server. Configure it with:
#   BULLMQ_PG_URL     libpq connection string (default: host=localhost dbname=bullmq_test)
#   BULLMQ_PG_SCHEMA  schema/namespace to use  (default: bullmq)
#
# The schema is wiped before each test (like flushdb for the Redis suite), so
# use a dedicated database.
set -e

export BULLMQ_TEST_BACKEND=postgres
python3 -m pytest -v "$@"
