#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/package.json" ]; then
  APP_DIR="$SCRIPT_DIR"
elif [ -f "$SCRIPT_DIR/../../package.json" ]; then
  APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
else
  echo "Unable to locate package.json from $SCRIPT_DIR." >&2
  exit 1
fi
cd "$APP_DIR"

if [ -f .env.production ]; then
  ENV_PORT="${PORT:-}"
  ENV_DEPLOY_RUN_PORT="${DEPLOY_RUN_PORT:-}"
  set -a
  # shellcheck disable=SC1091
  source .env.production
  set +a
  if [ -n "$ENV_PORT" ]; then PORT="$ENV_PORT"; fi
  if [ -n "$ENV_DEPLOY_RUN_PORT" ]; then DEPLOY_RUN_PORT="$ENV_DEPLOY_RUN_PORT"; fi
fi

export APP_RUNTIME_ENV="${APP_RUNTIME_ENV:-production}"
export PORT="${PORT:-5000}"
export DEPLOY_RUN_PORT="${DEPLOY_RUN_PORT:-$PORT}"
export FILE_STORAGE_ADAPTER="${FILE_STORAGE_ADAPTER:-local}"
export ZVEC_STORE_PATH="${ZVEC_STORE_PATH:-$APP_DIR/.data/zvec}"
export SOURCE_STORE_PATH="${SOURCE_STORE_PATH:-$APP_DIR/.data/sources/sources.json}"
export STUDIO_JOB_STORE_PATH="${STUDIO_JOB_STORE_PATH:-$APP_DIR/.data/studio-jobs/jobs.json}"
export SOURCE_STORE_ADAPTER="${SOURCE_STORE_ADAPTER:-local-json}"

mkdir -p "$(dirname "$SOURCE_STORE_PATH")" "$(dirname "$STUDIO_JOB_STORE_PATH")" "$ZVEC_STORE_PATH" logs

exec node scripts/start.mjs
