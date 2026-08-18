#!/usr/bin/env bash
# Restore from a local contingency copy (no R2 download).
# Usage: bash scripts/backup/local-restore.sh <BACKUP_ID> <LOCAL_DIR>
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

BACKUP_LOG_PREFIX="backup-local-restore"

usage() {
  cat <<'EOF'
Usage:
  CONFIRM_RESTORE=RESTORE \
  RESTORE_ISOLATED=yes \
  RESTORE_TARGET_DB_URL=postgres://... \
  bash scripts/backup/local-restore.sh <BACKUP_ID> <LOCAL_DIR>

Optional:
  RESTORE_STORAGE=1
  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  (target project)
  SKIP_ROLES=1
  RESTORE_DRY_RUN=1  (decrypt + validate only; no psql/Storage PUT)

Age identity: BACKUP_AGE_IDENTITY_FILE, BACKUP_AGE_VERIFY_IDENTITY,
or BACKUP_AGE_SECRET_KEY. Does not download from R2.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

BACKUP_ID="${1:-}"
LOCAL_DIR="${2:-}"
if [[ -z "$BACKUP_ID" || -z "$LOCAL_DIR" ]]; then
  usage
  die "missing BACKUP_ID or LOCAL_DIR"
fi

restore_require_guards
require_cmd tar gzip age jq

DIR="$(local_daily_dir "$LOCAL_DIR" "$BACKUP_ID")"
[[ -d "$DIR" ]] || die "local backup not found: ${DIR}"
assert_local_backup_artifacts "$DIR"
verify_sha256_sidecar "${DIR}/database.tar.gz.age"
verify_sha256_sidecar "${DIR}/storage.tar.gz.age"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/nomadas-local-restore.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

age_decrypt "${DIR}/database.tar.gz.age" "${WORK}/database.tar.gz"
mkdir -p "${WORK}/db"
tar -xzf "${WORK}/database.tar.gz" -C "${WORK}/db"
restore_apply_database "${WORK}/db"

if [[ "${RESTORE_STORAGE:-0}" == "1" ]]; then
  age_decrypt "${DIR}/storage.tar.gz.age" "${WORK}/storage.tar.gz"
  mkdir -p "${WORK}/st"
  tar -xzf "${WORK}/storage.tar.gz" -C "${WORK}/st"
  restore_apply_storage "${WORK}/st"
fi

restore_log_finished
