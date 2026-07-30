#!/bin/bash
cp -r ../rawScripts/. ./bullmq/commands/ || echo "Raw scripts are not available. Create them by running 'yarn install' and/or 'yarn generate:raw:scripts'"

# Keep the bundled PostgreSQL SQL (the portable, cross-language source of truth)
# in sync with src/postgres so the Python backend ships the same schema and
# commands as the other ports.
if [ -d ../src/postgres/commands ]; then
  mkdir -p ./bullmq/postgres/commands ./bullmq/postgres/migrations
  rm -f ./bullmq/postgres/commands/*.sql ./bullmq/postgres/migrations/*.sql
  cp ../src/postgres/commands/*.sql ./bullmq/postgres/commands/
  cp ../src/postgres/migrations/*.sql ./bullmq/postgres/migrations/
fi