#!/usr/bin/env bash
# Verify a backup already stored in R2: download → checksum → decrypt → decompress → structural checks.
# Does not connect to production Postgres. Requires an age identity (CI verify key or offline secret).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

BACKUP_LOG_PREFIX="backup-verify"
require_cmd tar gzip age jq
require_env BACKUP_ID

WORK="$(mktemp -d "${TMPDIR:-/tmp}/nomadas-verify.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

DB_KEY="production/database/daily/${BACKUP_ID}/database.tar.gz.age"
ST_KEY="production/storage/daily/${BACKUP_ID}/storage.tar.gz.age"

if [[ "${BACKUP_VERIFY_LOCAL:-0}" == "1" ]]; then
  require_env BACKUP_WORK_DIR
  cp "${BACKUP_WORK_DIR}/database/database.tar.gz.age" "${WORK}/database.tar.gz.age"
  cp "${BACKUP_WORK_DIR}/database/database.tar.gz.age.sha256" "${WORK}/database.tar.gz.age.sha256"
  cp "${BACKUP_WORK_DIR}/storage/storage.tar.gz.age" "${WORK}/storage.tar.gz.age"
  cp "${BACKUP_WORK_DIR}/storage/storage.tar.gz.age.sha256" "${WORK}/storage.tar.gz.age.sha256"
  log "BACKUP_VERIFY_LOCAL=1 — using local ciphertexts (no R2)"
else
  require_cmd aws
  log "downloading database ciphertext"
  r2_cp_down "$DB_KEY" "${WORK}/database.tar.gz.age"
  r2_cp_down "${DB_KEY}.sha256" "${WORK}/database.tar.gz.age.sha256"
  log "downloading storage ciphertext"
  r2_cp_down "$ST_KEY" "${WORK}/storage.tar.gz.age"
  r2_cp_down "${ST_KEY}.sha256" "${WORK}/storage.tar.gz.age.sha256"
fi

assert_nonempty_file "${WORK}/database.tar.gz.age" "downloaded database ciphertext"
assert_nonempty_file "${WORK}/storage.tar.gz.age" "downloaded storage ciphertext"

verify_sidecar() {
  local f="$1"
  local side="${f}.sha256"
  [[ -f "$side" ]] || die "missing sha256 sidecar for $(basename "$f")"
  local expected actual
  expected="$(awk '{print $1}' "$side")"
  actual="$(sha256_file "$f")"
  [[ "$expected" == "$actual" ]] || die "SHA-256 mismatch for $(basename "$f")"
}

verify_sidecar "${WORK}/database.tar.gz.age"
verify_sidecar "${WORK}/storage.tar.gz.age"
log "SHA-256 of downloaded ciphertexts matches sidecars"

age_decrypt "${WORK}/database.tar.gz.age" "${WORK}/database.tar.gz"
age_decrypt "${WORK}/storage.tar.gz.age" "${WORK}/storage.tar.gz"
gzip -t "${WORK}/database.tar.gz" || die "database archive failed gzip -t"
gzip -t "${WORK}/storage.tar.gz" || die "storage archive failed gzip -t"

mkdir -p "${WORK}/db" "${WORK}/st"
tar -xzf "${WORK}/database.tar.gz" -C "${WORK}/db"
tar -xzf "${WORK}/storage.tar.gz" -C "${WORK}/st"

assert_roles_sql "${WORK}/db/roles.sql"
assert_schema_sql "${WORK}/db/schema.sql"
assert_data_sql_has_rows "${WORK}/db/data.sql"
assert_data_sql_excludes_internal_storage "${WORK}/db/data.sql"
[[ -d "${WORK}/st" ]] || die "storage tree missing after decompress"

log "verify PASS (download/checksum/decrypt/decompress/structure)"
