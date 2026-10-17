#!/bin/sh
set -e
cd /app/apps/api

# Idempotent schema sync for fresh production Postgres (no destructive reset).
if [ "${RUN_DB_PUSH:-true}" = "true" ]; then
  echo "[entrypoint] Applying Prisma schema (db push)..."
  npx prisma db push --skip-generate
fi

exec "$@"
