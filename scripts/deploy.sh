#!/usr/bin/env bash
set -euo pipefail

IMAGE_URI="${1:?Error: IMAGE_URI argument is required}"
CONTAINER_NAME="${2:-snipsik-bot}"
GAR_LOCATION="${3:-us-central1}"
ENV_FILE="${4:-$HOME/snipsik/.env}"
ENV_FILE="${ENV_FILE/#\~/$HOME}"
BACKUP_CONTAINER="${CONTAINER_NAME}-backup"

DOCKER="docker"
HAS_OLD=0
PREVIOUS_IMAGE_ID=""

# -----------------------------------------------------------------------------
# Helper Functions
# -----------------------------------------------------------------------------
dcmd() {
  $DOCKER "$@"
}

container_exists() {
  dcmd container inspect "$1" >/dev/null 2>&1
}

is_container_running() {
  [ "$(dcmd inspect -f '{{.State.Running}}' "$1" 2>/dev/null || echo 'false')" = "true" ]
}

rollback_container() {
  if [ "$HAS_OLD" -eq 1 ]; then
    echo "Rolling back to previous container..." >&2
    dcmd rm -f "$CONTAINER_NAME" 2>/dev/null || true

    if ! dcmd start "$BACKUP_CONTAINER"; then
      echo "Fatal: Failed to start backup container '$BACKUP_CONTAINER' during rollback!" >&2
      return 1
    fi

    if ! dcmd rename "$BACKUP_CONTAINER" "$CONTAINER_NAME"; then
      echo "Fatal: Failed to rename backup container '$BACKUP_CONTAINER' to '$CONTAINER_NAME' during rollback!" >&2
      return 1
    fi

    echo "Rollback complete." >&2
  fi
}

# -----------------------------------------------------------------------------
# Deployment Steps
# -----------------------------------------------------------------------------
validate_prerequisites() {
  echo "==> 1. Checking prerequisites..."
  if [ ! -f "$ENV_FILE" ]; then
    echo "Error: Environment file not found at ${ENV_FILE}!" >&2
    exit 1
  fi
  chmod 600 "$ENV_FILE" 2>/dev/null || true
  echo "Environment file verified: $ENV_FILE"
}

detect_docker_permission() {
  echo "==> 2. Detecting Docker permissions..."
  if ! docker info >/dev/null 2>&1; then
    if sudo -n docker info >/dev/null 2>&1; then
      echo "Notice: Non-root user lacks docker group permission. Using 'sudo docker'."
      DOCKER="sudo docker"
      sudo usermod -aG docker "$USER" 2>/dev/null || true
    else
      echo "Error: Cannot access Docker daemon (neither as $USER nor via passwordless sudo)." >&2
      exit 1
    fi
  fi
}

configure_gar_auth() {
  echo "==> 3. Configuring Artifact Registry auth on VM..."
  gcloud auth configure-docker "${GAR_LOCATION}-docker.pkg.dev" --quiet
  if [ "$DOCKER" = "sudo docker" ]; then
    sudo gcloud auth configure-docker "${GAR_LOCATION}-docker.pkg.dev" --quiet 2>/dev/null || true
  fi
}

pull_target_image() {
  echo "==> 4. Pulling target image (${IMAGE_URI})..."
  dcmd pull "$IMAGE_URI"
}

prepare_container_backup() {
  echo "==> 5. Preparing container switch..."
  local has_primary=0
  local has_backup=0

  container_exists "$CONTAINER_NAME" && has_primary=1
  container_exists "$BACKUP_CONTAINER" && has_backup=1

  if [ "$has_primary" -eq 1 ]; then
    PREVIOUS_IMAGE_ID="$(dcmd inspect -f '{{.Image}}' "$CONTAINER_NAME" 2>/dev/null || true)"
    # Remove previous leftover backup only when primary container is available to be backed up
    dcmd rm -f "$BACKUP_CONTAINER" 2>/dev/null || true
    echo "Backing up existing container to ${BACKUP_CONTAINER}..."
    dcmd rename "$CONTAINER_NAME" "$BACKUP_CONTAINER"
    dcmd stop "$BACKUP_CONTAINER" || true
    HAS_OLD=1
  elif [ "$has_backup" -eq 1 ]; then
    PREVIOUS_IMAGE_ID="$(dcmd inspect -f '{{.Image}}' "$BACKUP_CONTAINER" 2>/dev/null || true)"
    # Preserve leftover backup as rollback target if primary container is missing
    echo "Warning: No primary container found, but found existing backup container. Preserving as rollback target."
    dcmd stop "$BACKUP_CONTAINER" || true
    HAS_OLD=1
  fi
}

start_new_container() {
  echo "==> 6. Starting new container..."
  if ! dcmd run -d \
    --name "$CONTAINER_NAME" \
    --restart unless-stopped \
    --env-file "$ENV_FILE" \
    "$IMAGE_URI"; then
    echo "Error: docker run failed! Rolling back..." >&2
    rollback_container
    exit 1
  fi
}

verify_health() {
  echo "==> 7. Verifying container health..."
  sleep 5
  if ! is_container_running "$CONTAINER_NAME"; then
    echo "Error: Container exited unexpectedly! Logs:" >&2
    dcmd logs --tail 30 "$CONTAINER_NAME" >&2 || true
    rollback_container
    exit 1
  fi

  # Clean up backup container after successful verification
  if [ "$HAS_OLD" -eq 1 ]; then
    dcmd rm -f "$BACKUP_CONTAINER" 2>/dev/null || true
  fi

  # Clean up superseded image on VM if a new image was deployed
  if [ -n "$PREVIOUS_IMAGE_ID" ]; then
    local current_image_id
    current_image_id="$(dcmd inspect -f '{{.Image}}' "$CONTAINER_NAME" 2>/dev/null || true)"
    if [ -n "$current_image_id" ] && [ "$PREVIOUS_IMAGE_ID" != "$current_image_id" ]; then
      echo "Cleaning up superseded container image (${PREVIOUS_IMAGE_ID})..."
      dcmd rmi "$PREVIOUS_IMAGE_ID" 2>/dev/null || true
    fi
  fi
}

cleanup_and_finish() {
  echo "==> 8. Cleaning up dangling images..."
  dcmd image prune -f

  echo "==> 9. Deployment succeeded! Container status:"
  dcmd ps --filter "name=${CONTAINER_NAME}"
}

# -----------------------------------------------------------------------------
# Main Execution Flow
# -----------------------------------------------------------------------------
echo "=========================================="
echo "Starting deployment for ${CONTAINER_NAME}"
echo "Image: ${IMAGE_URI}"
echo "Env file: ${ENV_FILE}"
echo "=========================================="

validate_prerequisites
detect_docker_permission
configure_gar_auth
pull_target_image
prepare_container_backup
start_new_container
verify_health
cleanup_and_finish
