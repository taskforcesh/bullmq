#!/usr/bin/env bash
#
# Runs the BullMQ .NET test suite the same way CI does.
#
# It makes the two easy-to-forget things automatic:
#   1. Ensures the generated (git-ignored) Lua/SQL script copies exist, running
#      `yarn copy:lua:dotnet` / `yarn copy:sql:dotnet` from the repo root if not.
#   2. Sets sensible defaults for the integration-test connection strings.
#
# Usage:
#   ./scripts/test.sh                     # run the whole suite
#   ./scripts/test.sh --filter Name~Flow  # pass any `dotnet test` args through
#
# Environment (all optional):
#   BULLMQ_TEST_REDIS      Redis connection      (default: localhost:6379)
#   BULLMQ_TEST_POSTGRES   Postgres connection   (default: Host=localhost;Database=bullmq_test;Username=$USER)
#   DOTNET_ROOT            Overrides .NET SDK location if `dotnet` isn't on PATH.
#
set -euo pipefail

# Resolve repo layout from this script's location so it works from any cwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTNET_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$DOTNET_DIR")"

# `dotnet` may be installed outside PATH (e.g. Homebrew's libexec). Fall back to
# the common Homebrew location so the script "just works" on a dev machine.
if ! command -v dotnet >/dev/null 2>&1; then
  if [ -x /opt/homebrew/opt/dotnet/libexec/dotnet ]; then
    export DOTNET_ROOT="${DOTNET_ROOT:-/opt/homebrew/opt/dotnet/libexec}"
    export PATH="/opt/homebrew/opt/dotnet/bin:$PATH"
  else
    echo "error: 'dotnet' SDK not found on PATH. Install it (e.g. 'brew install dotnet')." >&2
    exit 1
  fi
fi

export DOTNET_CLI_TELEMETRY_OPTOUT=1
export DOTNET_NOLOGO=1

# Ensure the generated, git-ignored shared scripts are present before building.
if [ -z "$(ls "$DOTNET_DIR"/src/BullMQ/Commands/*.lua 2>/dev/null)" ] \
  || [ -z "$(ls "$DOTNET_DIR"/src/BullMQ/Postgres/commands/*.sql 2>/dev/null)" ]; then
  echo "==> Copying shared Lua/SQL scripts (yarn copy:lua:dotnet / copy:sql:dotnet)"
  (cd "$REPO_ROOT" && yarn --silent copy:lua:dotnet && yarn --silent copy:sql:dotnet)
fi

# Default the integration-test connections unless the caller already set them.
export BULLMQ_TEST_REDIS="${BULLMQ_TEST_REDIS:-localhost:6379}"
export BULLMQ_TEST_POSTGRES="${BULLMQ_TEST_POSTGRES:-Host=localhost;Database=bullmq_test;Username=$(whoami)}"

echo "==> Redis:    $BULLMQ_TEST_REDIS"
echo "==> Postgres: $BULLMQ_TEST_POSTGRES"
echo "==> Running tests..."

cd "$DOTNET_DIR"
exec dotnet test "$@"
