#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Separate projects and Docker-assigned ports keep existing developer services intact.
COMPOSE_PROJECT_NAME="booking-check-$$-$(date +%s)"
export COMPOSE_PROJECT_NAME
export FRONTEND_PORT=0 BACKEND_PORT=0 BIND_HOST=127.0.0.1 TZ=UTC
export API_TARGET=http://calendar-api:8080

cleanup() {
  local status=$?
  trap - EXIT
  if (( status != 0 )); then
    docker compose ps --all || true
    docker compose logs --no-color --tail=100 || true
  fi
  docker compose down --volumes --remove-orphans --rmi local || status=1
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

docker compose up --build --wait --wait-timeout 120
DOCKER_BASE_URL="http://$(docker compose port frontend 80)"
DOCKER_BACKEND_URL="http://$(docker compose port backend 8080)"
export DOCKER_BASE_URL DOCKER_BACKEND_URL
echo "Container browser acceptance: $DOCKER_BASE_URL (API $DOCKER_BACKEND_URL)"
npm --prefix frontend run test:docker
