#!/usr/bin/env bash
# Verify a local contingency copy without R2.
# Usage: bash scripts/backup/local-verify.sh <BACKUP_ID> <LOCAL_DIR>
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

BACKUP_LOG_PREFIX="backup-local-verify"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/backup/local-verify.sh <BACKUP_ID> <LOCAL_DIR>

Offline: does not contact R2, GitHub, or Supabase.
Requires an age identity (BACKUP_AGE_IDENTITY_FILE, BACKUP_AGE_VERIFY_IDENTITY,
or BACKUP_AGE_SECRET_KEY).
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

require_cmd tar gzip age jq
DIR="$(local_daily_dir "$LOCAL_DIR" "$BACKUP_ID")"
[[ -d "$DIR" ]] || die "local backup not found: ${DIR}"

assert_local_backup_artifacts "$DIR"
verify_sha256_sidecar "${DIR}/database.tar.gz.age"
verify_sha256_sidecar "${DIR}/storage.tar.gz.age"
assert_manifest_for_backup "${DIR}/manifest.json" "$BACKUP_ID"
assert_age_ciphertext "${DIR}/database.tar.gz.age"
assert_age_ciphertext "${DIR}/storage.tar.gz.age"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/nomadas-local-verify.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

age_decrypt "${DIR}/database.tar.gz.age" "${WORK}/database.tar.gz"
age_decrypt "${DIR}/storage.tar.gz.age" "${WORK}/storage.tar.gz"
gzip -t "${WORK}/database.tar.gz" || die "database archive failed gzip -t"
gzip -t "${WORK}/storage.tar.gz" || die "storage archive failed gzip -t"

mkdir -p "${WORK}/db" "${WORK}/st"
tar -xzf "${WORK}/database.tar.gz" -C "${WORK}/db"
tar -xzf "${WORK}/storage.tar.gz" -C "${WORK}/st"

assert_roles_sql "${WORK}/db/roles.sql"
assert_schema_sql "${WORK}/db/schema.sql"
assert_data_sql_backup_contract "${WORK}/db/data.sql"
[[ -d "${WORK}/st" ]] || die "storage tree missing after decompress"

log "local verify PASS"
