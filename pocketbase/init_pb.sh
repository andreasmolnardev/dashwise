#!/bin/sh
set -e

PB_BINARY="/app/pocketbase"
PB_PORT="0.0.0.0:8090"

PB_DATA_DIR="/app/pb_data"
PB_MIGRATIONS_DIR="/app/pb_migrations"

ADMIN_EMAIL="${PB_ADMIN_EMAIL:-default@dashwise.local}"
ADMIN_PASSWORD="${PB_ADMIN_PASSWORD:-dashwiseIsAwesome}"

# Ensure data and migrations directories exist
mkdir -p "$PB_DATA_DIR" "$PB_MIGRATIONS_DIR"

# run migrations
$PB_BINARY migrate \
  --dir "$PB_DATA_DIR" \
  --migrationsDir "$PB_MIGRATIONS_DIR" &

# Start PocketBase as background service
$PB_BINARY serve \
  --http "$PB_PORT" \
  --dir "$PB_DATA_DIR" \
  --migrationsDir "$PB_MIGRATIONS_DIR" &
PB_PID=$!

sleep 5

if $PB_BINARY superuser upsert "$ADMIN_EMAIL" "$ADMIN_PASSWORD" --dir "$PB_DATA_DIR"; then
    echo "✅ PocketBase superuser successfully created: ${ADMIN_EMAIL}"
else
    echo "❌ Error: Failed to create PocketBase superuser account"
    kill $PB_PID
    exit 1
fi

wait $PB_PID