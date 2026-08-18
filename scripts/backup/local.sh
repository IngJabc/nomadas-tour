#!/usr/bin/env bash
# Copy an existing R2 backup to local storage. Does not dump or re-encrypt.
# Usage: bash scripts/backup/local.sh <BACKUP_ID> <LOCAL_DIR>
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

BACKUP_LOG_PREFIX="backup-local"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/backup/local.sh <BACKUP_ID> <LOCAL_DIR>

Downloads the five production/daily artifacts for BACKUP_ID from R2 into:
  <LOCAL_DIR>/daily/<BACKUP_ID>/

Does not generate a new dump. Does not re-encrypt. Ciphertexts stay byte-identical.

Required env: R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY
Required for cryptographic check: age identity (BACKUP_AGE_IDENTITY_FILE,
BACKUP_AGE_VERIFY_IDENTITY, or BACKUP_AGE_SECRET_KEY).
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
[[ "$BACKUP_ID" =~ ^[0-9]{8}T[0-9]{6}Z-.+ ]] || die "BACKUP_ID looks invalid"

require_cmd age jq tar gzip
if [[ -z "${BACKUP_R2_FIXTURE_DIR:-}" ]]; then
  require_cmd aws
  require_env R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY
fi

DEST="$(local_daily_dir "$LOCAL_DIR" "$BACKUP_ID")"
if [[ -e "$DEST" ]]; then
  die "destination already exists (refusing partial/overwrite): ${DEST}"
fi

STAGING="$(mktemp -d "${TMPDIR:-/tmp}/nomadas-local-copy.XXXXXX")"
PLAIN="$(mktemp -d "${TMPDIR:-/tmp}/nomadas-local-plain.XXXXXX")"
cleanup() {
  if [[ -n "${STAGING:-}" && -d "${STAGING:-}" ]]; then
    rm -rf "$STAGING"
  fi
  if [[ -n "${PLAIN:-}" && -d "${PLAIN:-}" ]]; then
    rm -rf "$PLAIN"
  fi
}
trap cleanup EXIT

DB_KEY="production/database/daily/${BACKUP_ID}/database.tar.gz.age"
ST_KEY="production/storage/daily/${BACKUP_ID}/storage.tar.gz.age"
MF_KEY="production/manifests/daily/${BACKUP_ID}/manifest.json"

log "downloading R2 artifacts for ${BACKUP_ID}"
r2_cp_down "$DB_KEY" "${STAGING}/database.tar.gz.age"
r2_cp_down "${DB_KEY}.sha256" "${STAGING}/database.tar.gz.age.sha256"
r2_cp_down "$ST_KEY" "${STAGING}/storage.tar.gz.age"
r2_cp_down "${ST_KEY}.sha256" "${STAGING}/storage.tar.gz.age.sha256"
r2_cp_down "$MF_KEY" "${STAGING}/manifest.json"

assert_local_backup_artifacts "$STAGING"
verify_sha256_sidecar "${STAGING}/database.tar.gz.age"
verify_sha256_sidecar "${STAGING}/storage.tar.gz.age"
assert_manifest_for_backup "${STAGING}/manifest.json" "$BACKUP_ID"
assert_age_ciphertext "${STAGING}/database.tar.gz.age"
assert_age_ciphertext "${STAGING}/storage.tar.gz.age"

log "cryptographic check (temporary plaintext, then wipe)"
age_decrypt "${STAGING}/database.tar.gz.age" "${PLAIN}/database.tar.gz"
age_decrypt "${STAGING}/storage.tar.gz.age" "${PLAIN}/storage.tar.gz"
gzip -t "${PLAIN}/database.tar.gz" || die "database archive failed gzip -t"
gzip -t "${PLAIN}/storage.tar.gz" || die "storage archive failed gzip -t"
rm -rf "$PLAIN"
PLAIN=""

DB_BYTES="$(wc -c <"${STAGING}/database.tar.gz.age" | tr -d ' ')"
ST_BYTES="$(wc -c <"${STAGING}/storage.tar.gz.age" | tr -d ' ')"

mkdir -p "$(dirname "$DEST")"
chmod 700 "$(dirname "$DEST")" 2>/dev/null || true
mv "$STAGING" "$DEST"
STAGING=""
chmod 700 "$DEST" 2>/dev/null || true
chmod 600 "$DEST"/* 2>/dev/null || true

log "local copy PASS"
log "backup_id=${BACKUP_ID}"
log "artifact_count=5"
log "database_ciphertext_bytes=${DB_BYTES}"
log "storage_ciphertext_bytes=${ST_BYTES}"
log "verification=PASS"
log "destination=${DEST}"
