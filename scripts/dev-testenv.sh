#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_COMPOSE="$ROOT_DIR/docker-compose.test.yaml"
TEST_COMPOSE="$ROOT_DIR/docker-compose.test.testenv.yaml"
PROJECT_NAME="dashwise-testenv-$$"
DEFAULT_EMAIL="guest@dashwise.local"
DEFAULT_PASSWORD="DashwiseGuest123"

cd "$ROOT_DIR"

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

port_is_free() {
  local port="$1"

  if command_exists lsof; then
    ! lsof -iTCP:"$port" -sTCP:LISTEN -Pn >/dev/null 2>&1
    return
  fi

  if command_exists ss; then
    ! ss -ltn "sport = :$port" | grep -q ":$port"
    return
  fi

  ! (exec 3<>"/dev/tcp/127.0.0.1/$port") >/dev/null 2>&1
}

next_free_port() {
  local port="$1"

  while ! port_is_free "$port"; do
    port=$((port + 1))
  done

  printf '%s\n' "$port"
}

compose() {
  docker compose --project-name "$PROJECT_NAME" -f "$TEST_COMPOSE" "$@"
}

cleanup() {
  set +e
  if [[ -f "$TEST_COMPOSE" ]]; then
    compose down --remove-orphans --volumes
    rm -f "$TEST_COMPOSE"
  fi
}

trap cleanup EXIT INT TERM

if [[ ! -f "$BASE_COMPOSE" ]]; then
  printf 'Missing %s\n' "$BASE_COMPOSE" >&2
  exit 1
fi

APP_PORT="$(next_free_port 3000)"
PB_PORT="$(next_free_port 8090)"

sed \
  -e "s/\"[0-9][0-9]*:3000\"/\"${APP_PORT}:3000\"/g" \
  -e "s/\"[0-9][0-9]*:8090\"/\"${PB_PORT}:8090\"/g" \
  -e "s|NEXT_PUBLIC_APP_URL: .*|NEXT_PUBLIC_APP_URL: http://localhost:${APP_PORT}|g" \
  -e 's|\./pocketbase/pb_data_old:/app/pocketbase/pb_data|testenv-data:/app/pocketbase/pb_data|g' \
  "$BASE_COMPOSE" > "$TEST_COMPOSE"
printf '\nvolumes:\n  testenv-data:\n' >> "$TEST_COMPOSE"

printf 'Using Dashwise app port %s and PocketBase port %s\n' "$APP_PORT" "$PB_PORT"
compose up --build --detach

APP_URL="http://localhost:${APP_PORT}"
printf 'Waiting for Dashwise at %s\n' "$APP_URL"
startup_deadline=$((SECONDS + 180))
until curl -fsS "$APP_URL/api/v1/appConfig" >/dev/null 2>&1; do
  if (( SECONDS >= startup_deadline )); then
    printf 'Dashwise did not become ready at %s within 180 seconds\n' "$APP_URL" >&2
    compose logs --tail=100 >&2
    exit 1
  fi
  sleep 2
done

signup_response_file="$(mktemp)"
signup_status="$(curl -sS -o "$signup_response_file" -w '%{http_code}' \
  -H 'Content-Type: application/json' \
  -d "{\"_name\":\"Guest\",\"email\":\"${DEFAULT_EMAIL}\",\"password\":\"${DEFAULT_PASSWORD}\",\"passwordConfirm\":\"${DEFAULT_PASSWORD}\"}" \
  "$APP_URL/api/v1/auth/signup" || true)"

if [[ "$signup_status" != "200" && "$signup_status" != "201" ]]; then
  printf 'Guest account creation returned HTTP %s: ' "$signup_status" >&2
  cat "$signup_response_file" >&2
  rm -f "$signup_response_file"
  exit 1
fi
rm -f "$signup_response_file"

login_response="$(curl -fsS \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${DEFAULT_EMAIL}\",\"password\":\"${DEFAULT_PASSWORD}\"}" \
  "$APP_URL/api/v1/auth/login")"

login_token="$(printf '%s' "$login_response" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"

if [[ -z "$login_token" ]]; then
  printf 'Could not read login token from login response\n' >&2
  exit 1
fi

printf '\nDashwise test environment is ready.\n'
printf 'Guest login link: %s/auth?loginToken=%s\n' "$APP_URL" "$login_token"
printf 'Open that URL to log in as Guest. The token is valid as a login credential.\n'
printf 'Press Ctrl+C to stop the stack and remove its isolated database.\n\n'

compose logs --follow
