#!/bin/sh
# Aligns a non-root 'appuser' with the host's docker.sock group GID (varies
# per host) so the app process can invoke `docker` without running as root
# itself, then drops to that user for the actual server process.
set -e

if [ -S /var/run/docker.sock ]; then
  SOCK_GID="$(stat -c '%g' /var/run/docker.sock)"
  if ! getent group "$SOCK_GID" >/dev/null 2>&1; then
    groupadd -g "$SOCK_GID" dockersock
  fi
  DOCKER_GROUP="$(getent group "$SOCK_GID" | cut -d: -f1)"
  usermod -aG "$DOCKER_GROUP" appuser
fi

exec gosu appuser "$@"
