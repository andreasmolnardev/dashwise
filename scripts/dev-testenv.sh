#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_COMPOSE="$ROOT_DIR/docker-compose.test.yaml"
TEST_COMPOSE="$ROOT_DIR/docker-compose.test.testenv.yaml"
SESSION_NAME="dashwise-testenv"
DEFAULT_EMAIL="testenv@dashwise.local"
DEFAULT_PASSWORD="DashwiseTestenv123"

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

open_url() {
  local url="$1"

  if command_exists xdg-open; then
    xdg-open "$url" >/dev/null 2>&1 || true
  elif command_exists open; then
    open "$url" >/dev/null 2>&1 || true
  else
    printf 'Open this URL: %s\n' "$url"
  fi
}

compose() {
  docker compose -f "$TEST_COMPOSE" "$@"
}

cleanup() {
  set +e
  if [[ "${STARTED_TMUX:-0}" == "1" ]] && command_exists tmux && tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    tmux send-keys -t "$SESSION_NAME" C-c
    sleep 2
    tmux kill-session -t "$SESSION_NAME" 2>/dev/null
  fi
  if [[ -f "$TEST_COMPOSE" ]]; then
    compose down --remove-orphans
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
  "$BASE_COMPOSE" > "$TEST_COMPOSE"

printf 'Using Dashwise app port %s and PocketBase port %s\n' "$APP_PORT" "$PB_PORT"

if command_exists tmux; then
  if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    printf 'tmux session %s already exists; attach with: tmux attach -t %s\n' "$SESSION_NAME" "$SESSION_NAME"
  else
    tmux new-session -d -s "$SESSION_NAME" "cd '$ROOT_DIR' && docker compose -f '$TEST_COMPOSE' up --build"
    STARTED_TMUX=1
    printf 'Started docker compose in tmux session %s\n' "$SESSION_NAME"
  fi
else
  printf 'tmux not found; running docker compose in this shell\n'
  compose up --build &
  COMPOSE_PID=$!
fi

APP_URL="http://localhost:${APP_PORT}"

printf 'Waiting for Dashwise at %s\n' "$APP_URL"
until curl -fsS "$APP_URL/api/v1/appConfig" >/dev/null 2>&1; do
  sleep 2
done

signup_status="$(curl -sS -o /tmp/dashwise-testenv-signup.json -w '%{http_code}' \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${DEFAULT_EMAIL}\",\"password\":\"${DEFAULT_PASSWORD}\",\"passwordConfirm\":\"${DEFAULT_PASSWORD}\"}" \
  "$APP_URL/api/v1/auth/signup" || true)"

if [[ "$signup_status" != "200" && "$signup_status" != "201" && "$signup_status" != "400" ]]; then
  printf 'Signup returned HTTP %s\n' "$signup_status" >&2
fi

login_response="$(curl -fsS \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${DEFAULT_EMAIL}\",\"password\":\"${DEFAULT_PASSWORD}\"}" \
  "$APP_URL/api/v1/auth/login")"

login_token="$(printf '%s' "$login_response" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"

if [[ -z "$login_token" ]]; then
  printf 'Could not read login token from login response\n' >&2
  exit 1
fi

open_url "$APP_URL/auth?loginToken=$login_token"

printf 'Dashwise testenv is running. Credentials: %s / %s\n' "$DEFAULT_EMAIL" "$DEFAULT_PASSWORD"
printf 'Press Ctrl+C to stop the stack and clean up.\n'

if [[ -n "${COMPOSE_PID:-}" ]]; then
  wait "$COMPOSE_PID"
else
  while true; do
    sleep 3600
  done
fi
