#!/bin/sh
set -e

valkey-server --daemonize yes --save "" --appendonly no
exec "$@"
