#!/usr/bin/env bash
# Deploy the checked-out upstream branch to this host.
set -Eeuo pipefail
IFS=$'\n\t'

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd -P)"
readonly LOCK_FILE="${DEPLOY_LOCK_FILE:-/tmp/notebook-deploy.lock}"
readonly HEALTH_RETRIES="${DEPLOY_HEALTH_RETRIES:-15}"
readonly HEALTH_RETRY_DELAY="${DEPLOY_HEALTH_RETRY_DELAY:-2}"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*"
}

die() {
  log "ERROR: $*"
  exit 1
}

on_error() {
  local exit_code=$?
  log "ERROR: deployment failed at line $1 (exit ${exit_code})."
  exit "${exit_code}"
}

trap 'on_error $LINENO' ERR

acquire_lock() {
  # flock is released by the kernel when this process exits, including a crash.
  exec 9>"${LOCK_FILE}"
  flock -n 9 || die "another deployment is already running (${LOCK_FILE})"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

env_value() {
  local key=$1
  awk -F= -v key="${key}" '$1 == key { value = substr($0, length(key) + 2) } END { print value }' .env
}

validate_environment() {
  [[ -f .env ]] || die "missing .env; create it from .env.example before deploying"

  local jwt_secret configured_uid configured_gid
  jwt_secret="$(env_value JWT_SECRET)"
  configured_uid="$(env_value UID)"
  configured_gid="$(env_value GID)"

  [[ ${#jwt_secret} -ge 32 ]] || die "JWT_SECRET in .env must be at least 32 characters"
  [[ "${jwt_secret}" != "replace-me-with-at-least-32-random-characters" ]] \
    || die "replace the example JWT_SECRET in .env with a random value"
  [[ "${configured_uid}" =~ ^[0-9]+$ ]] || die "UID in .env must be a numeric user id"
  [[ "${configured_gid}" =~ ^[0-9]+$ ]] || die "GID in .env must be a numeric group id"
  [[ "${configured_uid}" == "$(id -u)" ]] || die "UID in .env must match the deploying user ($(id -u))"
  [[ "${configured_gid}" == "$(id -g)" ]] || die "GID in .env must match the deploying user's primary group ($(id -g))"

  mkdir -p data dist
  [[ -w data && -w dist ]] || die "data and dist must be writable by the deploying user"
}

update_source() {
  local branch upstream before after
  branch="$(git branch --show-current)"
  [[ -n "${branch}" ]] || die "repository is in detached HEAD state; check out a tracked branch first"
  upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null)" \
    || die "branch '${branch}' has no upstream remote"

  [[ -z "$(git status --porcelain --untracked-files=all)" ]] \
    || die "working tree is not clean; commit, stash, or remove local changes first"

  before="$(git rev-parse --short HEAD)"
  log "Updating ${branch} from ${upstream} (current commit ${before})"
  git pull --ff-only --tags
  after="$(git rev-parse --short HEAD)"

  if [[ "${before}" == "${after}" ]]; then
    log "Source is already current at ${after}"
  else
    log "Updated source: ${before} -> ${after}"
  fi
}

wait_for_healthcheck() {
  local backend_port attempt
  backend_port="$(env_value BACKEND_PORT)"
  backend_port="${backend_port:-3000}"
  [[ "${backend_port}" =~ ^[0-9]+$ ]] || die "BACKEND_PORT in .env must be numeric"

  for ((attempt = 1; attempt <= HEALTH_RETRIES; attempt++)); do
    if curl --fail --silent --show-error --max-time 5 \
      "http://127.0.0.1:${backend_port}/health" >/dev/null; then
      log "Health check passed"
      return 0
    fi
    sleep "${HEALTH_RETRY_DELAY}"
  done

  die "server did not become healthy; inspect it with: docker compose logs --tail=100 server"
}

main() {
  [[ $# -eq 0 ]] || die "this script takes no arguments; deploy the currently checked-out tracked branch"
  [[ "${HEALTH_RETRIES}" =~ ^[1-9][0-9]*$ ]] || die "DEPLOY_HEALTH_RETRIES must be a positive integer"
  [[ "${HEALTH_RETRY_DELAY}" =~ ^[0-9]+([.][0-9]+)?$ ]] \
    || die "DEPLOY_HEALTH_RETRY_DELAY must be a non-negative number"

  require_command git
  require_command docker
  require_command curl
  require_command awk
  require_command id
  require_command flock

  cd -- "${REPO_ROOT}"
  acquire_lock

  git rev-parse --is-inside-work-tree >/dev/null || die "${REPO_ROOT} is not a Git work tree"
  git remote get-url origin >/dev/null || die "Git remote 'origin' is not configured"
  validate_environment
  docker compose config -q
  update_source

  log "Building frontend assets"
  docker compose run --rm --build frontend-build

  log "Building and starting server"
  docker compose up -d --build server
  wait_for_healthcheck

  log "Deployment completed successfully at $(git rev-parse --short HEAD)"
}

main "$@"
