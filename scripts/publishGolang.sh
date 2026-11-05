#!/usr/bin/env bash
#
# Publishes the Go port to its distribution repository (taskforcesh/bullmq-go).
#
# The golang directory of this repository is the source of truth. Every source
# tag `golang/vX.Y.Z` created by semantic-release is mirrored, with the
# generated Lua commands, to the target repository as tag `vX.Y.Z` plus a
# GitHub release.
#
# The script is resumable: pending versions are resolved from the source tags
# rather than from the output of the current semantic-release run, so a run
# that failed half way (or a rerun that has nothing new to release) completes
# whatever is missing. For each version it:
#   - skips it when the target tag and release both exist,
#   - only creates the release when the target tag already exists,
#   - reuses the target release commit when it was pushed but never tagged,
#   - otherwise builds the port from the source tag, commits, tags and releases.
#
# Environment:
#   TARGET_REPO         target repository, e.g. taskforcesh/bullmq-go (required)
#   GH_TOKEN            token with contents:write on the target repository
#   SOURCE_GH_TOKEN     token that can read releases of GITHUB_REPOSITORY
#   GITHUB_REPOSITORY   source repository, e.g. taskforcesh/bullmq
#   RUNNER_TEMP         scratch directory (defaults to a new temporary dir)
#   TARGET_REMOTE       override for the target clone URL (used by tests)
#   GENERATE_LUA_CMD    override for the Lua generation command (used by tests)
#   SKIP_PROXY_WARMUP   when set, do not contact the Go module proxy
#
# Run it from the root of the source repository, with all tags fetched.

set -euo pipefail

: "${TARGET_REPO:?TARGET_REPO is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"

ROOT=$(pwd)
WORK="${RUNNER_TEMP:-$(mktemp -d)}"
TARGET_REMOTE="${TARGET_REMOTE:-https://x-access-token:${GH_TOKEN:-}@github.com/${TARGET_REPO}.git}"
SOURCE_GH_TOKEN="${SOURCE_GH_TOKEN:-${GH_TOKEN:-}}"
GENERATE_LUA_CMD="${GENERATE_LUA_CMD:-yarn install --frozen-lockfile --non-interactive && yarn generate:raw:scripts && yarn copy:lua:golang}"
SEMVER='^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'

DEST="${WORK}/bullmq-go"
SRC_TREE=""

cleanup() {
  if [ -n "$SRC_TREE" ] && [ -d "$SRC_TREE" ]; then
    git -C "$ROOT" worktree remove --force "$SRC_TREE" > /dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# True when $1 is strictly lower than $2 in version order.
version_lt() {
  [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -n1)" = "$1" ]
}

target_has_release() {
  gh release view "$1" --repo "$TARGET_REPO" > /dev/null 2>&1
}

source_release_notes() {
  local tag="$1" out="$2"
  if ! GH_TOKEN="$SOURCE_GH_TOKEN" gh release view "$tag" \
    --repo "$GITHUB_REPOSITORY" --json body -q .body > "$out" 2> /dev/null; then
    : > "$out"
  fi
}

create_release() {
  local version="$1" tag="v$1" notes="$WORK/bullmq-go-notes-$1.md"
  source_release_notes "golang/${tag}" "$notes"
  if [ ! -s "$notes" ]; then
    echo "See [CHANGELOG.md](./CHANGELOG.md) for details." > "$notes"
  fi
  local flags=(--verify-tag)
  if [[ "$version" == *-* ]]; then
    flags+=(--prerelease)
  fi
  gh release create "$tag" \
    --repo "$TARGET_REPO" \
    --title "$tag" \
    --notes-file "$notes" \
    "${flags[@]}"
}

# Builds the port of $1 from its source tag into $DEST (the target checkout).
stage_version() {
  local version="$1" tag="v$1" source_tag="golang/v$1"

  SRC_TREE="${WORK}/bullmq-src-${version}"
  rm -rf "$SRC_TREE"
  git -C "$ROOT" worktree prune
  git -C "$ROOT" worktree add --detach "$SRC_TREE" "refs/tags/${source_tag}" > /dev/null

  # Go modules v2+ must carry the major version suffix in their path, so
  # golang/go.mod has to be bumped (module and imports) by hand before
  # releasing a new major.
  local major="${version%%.*}"
  local target_module="github.com/${TARGET_REPO}"
  if [ "$major" -ge 2 ]; then
    target_module="${target_module}/v${major}"
  fi
  local source_module
  source_module=$(cd "$SRC_TREE/golang" && go list -m)
  if [ "$source_module" != "$target_module" ]; then
    echo "::error::golang/go.mod at ${source_tag} declares '${source_module}' but ${tag} requires '${target_module}'"
    return 1
  fi

  (cd "$SRC_TREE" && bash -c "$GENERATE_LUA_CMD")
  if ! ls "$SRC_TREE"/golang/commands/*.lua > /dev/null 2>&1; then
    echo "::error::Generated Lua commands are missing for ${source_tag}"
    return 1
  fi

  # Mirror the port; node tooling and the source .gitignore (which ignores the
  # generated Lua commands) are not published.
  rsync -a --delete \
    --exclude='.git/' \
    --exclude='node_modules/' \
    --exclude='package.json' \
    --exclude='yarn.lock' \
    --exclude='.gitignore' \
    "$SRC_TREE/golang/" "$DEST/"
  cp "$SRC_TREE/LICENSE" "$DEST/LICENSE"

  # The changelog is updated by semantic-release in the working tree of the
  # release run and only reaches the tags through a later PR, so use the
  # current one and add this version's notes when it is not in there yet.
  local changelog="$ROOT/docs/gitbook/golang/changelog.md"
  if [ -f "$changelog" ]; then
    cp "$changelog" "$DEST/CHANGELOG.md"
  else
    : > "$DEST/CHANGELOG.md"
  fi
  if ! grep -qF "$version" "$DEST/CHANGELOG.md"; then
    local notes="$WORK/changelog-notes-${version}.md"
    source_release_notes "$source_tag" "$notes"
    if [ -s "$notes" ]; then
      {
        printf '## %s\n\n' "$version"
        cat "$notes"
        printf '\n\n'
        cat "$DEST/CHANGELOG.md"
      } > "$DEST/CHANGELOG.md.new"
      mv "$DEST/CHANGELOG.md.new" "$DEST/CHANGELOG.md"
    fi
  fi

  cat > "$DEST/.gitignore" << 'EOF'
# Go build output
/bin/
*.test
*.out
coverage.txt
EOF

  # Make sure the published module builds with the embedded commands.
  (cd "$DEST" && go build ./... && go vet ./...)

  git -C "$ROOT" worktree remove --force "$SRC_TREE" > /dev/null 2>&1 || true
  SRC_TREE=""
}

# Commits the staged port, tags it and pushes both. Safe to repeat: a release
# commit that was already pushed is reused instead of committing again.
commit_and_tag() {
  local version="$1" tag="v$1" source_tag="golang/v$1"
  local pattern="^chore(release): ${tag//./\\.}\$"
  local commit

  commit=$(git -C "$DEST" log --grep="$pattern" --format=%H -n1)
  if [ -n "$commit" ]; then
    echo "Release commit ${commit} for ${tag} already exists in ${TARGET_REPO}"
  else
    git -C "$DEST" add -A
    if [ -n "$(git -C "$DEST" diff --cached --name-only)" ]; then
      git -C "$DEST" commit -q -m "chore(release): ${tag}" \
        -m "Generated from ${GITHUB_REPOSITORY}@$(git -C "$ROOT" rev-list -n1 "refs/tags/${source_tag}") (${source_tag})."
    else
      echo "No file changes for ${tag}; tagging the current ${TARGET_BRANCH}"
    fi
    git -C "$DEST" push -q origin "HEAD:${TARGET_BRANCH}"
    commit=$(git -C "$DEST" rev-parse HEAD)
  fi

  git -C "$DEST" tag -a "$tag" -m "$tag" "$commit"
  git -C "$DEST" push -q origin "refs/tags/${tag}"
}

warm_proxy() {
  local version="$1" tag="v$1"
  if [ -n "${SKIP_PROXY_WARMUP:-}" ]; then
    return 0
  fi
  local major="${version%%.*}"
  local module="github.com/${TARGET_REPO}"
  if [ "$major" -ge 2 ]; then
    module="${module}/v${major}"
  fi
  (cd "$WORK" && GOPROXY=https://proxy.golang.org GO111MODULE=on go list -m "${module}@${tag}") || true
}

# --- Resolve what is pending -------------------------------------------------

SOURCE_VERSIONS=()
while IFS= read -r line; do
  if [ -n "$line" ]; then SOURCE_VERSIONS+=("$line"); fi
done < <(git tag --list 'golang/v*' | sed 's#^golang/v##' | grep -E "$SEMVER" | sort -V || true)
if [ "${#SOURCE_VERSIONS[@]}" -eq 0 ]; then
  echo "No golang/v* source tags found; nothing to publish."
  exit 0
fi

TARGET_VERSIONS=()
while IFS= read -r line; do
  if [ -n "$line" ]; then TARGET_VERSIONS+=("$line"); fi
done < <(
  git ls-remote --tags --refs "$TARGET_REMOTE" 'refs/tags/v*' \
    | sed 's#.*refs/tags/v##' | grep -E "$SEMVER" | sort -V || true
)
LATEST_TARGET=""
if [ "${#TARGET_VERSIONS[@]}" -gt 0 ]; then
  LATEST_TARGET="${TARGET_VERSIONS[${#TARGET_VERSIONS[@]} - 1]}"
fi

has_target_tag() {
  local v
  for v in "${TARGET_VERSIONS[@]+"${TARGET_VERSIONS[@]}"}"; do
    [ "$v" = "$1" ] && return 0
  done
  return 1
}

NEED_TAG=()
NEED_RELEASE=()
for version in "${SOURCE_VERSIONS[@]}"; do
  if has_target_tag "$version"; then
    if ! target_has_release "v${version}"; then
      NEED_RELEASE+=("$version")
    fi
  elif [ -n "$LATEST_TARGET" ] && version_lt "$version" "$LATEST_TARGET"; then
    # The target branch is linear, so an older version cannot be inserted
    # behind a newer one that is already published.
    echo "::warning::Skipping ${version}: ${TARGET_REPO} already has the newer v${LATEST_TARGET}"
  else
    NEED_TAG+=("$version")
  fi
done

if [ "${#NEED_TAG[@]}" -eq 0 ] && [ "${#NEED_RELEASE[@]}" -eq 0 ]; then
  echo "${TARGET_REPO} is up to date with the golang/v* source tags."
  exit 0
fi

# --- Tag and publish missing versions (oldest first) -------------------------

if [ "${#NEED_TAG[@]}" -gt 0 ]; then
  rm -rf "$DEST"
  git clone -q "$TARGET_REMOTE" "$DEST"
  TARGET_BRANCH=$(git -C "$DEST" symbolic-ref --short HEAD)
  git -C "$DEST" config --local user.email "action@github.com"
  git -C "$DEST" config --local user.name "GitHub Action"

  for version in "${NEED_TAG[@]}"; do
    echo "Publishing Go module v${version} to ${TARGET_REPO}"
    stage_version "$version"
    commit_and_tag "$version"
    create_release "$version"
    warm_proxy "$version"
  done
fi

# --- Only the release is missing ---------------------------------------------

for version in "${NEED_RELEASE[@]+"${NEED_RELEASE[@]}"}"; do
  echo "Tag v${version} exists in ${TARGET_REPO} but has no release; creating it"
  create_release "$version"
  warm_proxy "$version"
done
