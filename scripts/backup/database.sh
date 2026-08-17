#!/usr/bin/env bash
# Logical database backup: roles.sql + schema.sql + data.sql → tar.gz → age → checksum.
# Read-only against production. Does not migrate, UPDATE, or DELETE.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

BACKUP_LOG_PREFIX="backup-db"
BACKUP_REPO_ROOT="${BACKUP_REPO_ROOT:-$(cd "${SCRIPT_DIR}/../.." && pwd)}"
WORK="${BACKUP_WORK_DIR:-}"
CREATED_WORK=0
if [[ -z "$WORK" ]]; then
  WORK="$(mktemp -d "${TMPDIR:-/tmp}/nomadas-backup-db.XXXXXX")"
  CREATED_WORK=1
  export BACKUP_WORK_DIR="$WORK"
fi
DB_DIR="${WORK}/database"
mkdir -p "$DB_DIR"

cleanup() {
  if [[ "${BACKUP_KEEP_WORK:-0}" != "1" && "$CREATED_WORK" -eq 1 ]]; then
    rm -rf "$WORK"
  fi
}
trap cleanup EXIT

require_cmd tar gzip age jq
require_env BACKUP_AGE_RECIPIENT

BACKUP_ID="${BACKUP_ID:-$(new_backup_id)}"
export BACKUP_ID

if [[ "${BACKUP_SKIP_DUMP:-0}" == "1" ]]; then
  log "BACKUP_SKIP_DUMP=1 — using fixture files in ${DB_DIR}"
  [[ -f "${DB_DIR}/roles.sql" && -f "${DB_DIR}/schema.sql" && -f "${DB_DIR}/data.sql" ]] \
    || die "fixtures missing (roles.sql/schema.sql/data.sql) under ${DB_DIR}"
else
  require_cmd supabase docker
  require_env SUPABASE_DB_URL
  log "dumping roles (cluster roles only; not application data)"
  supabase db dump --db-url "${SUPABASE_DB_URL}" --role-only -f "${DB_DIR}/roles.sql"
  log "dumping schema (structure only — no rows)"
  supabase db dump --db-url "${SUPABASE_DB_URL}" -f "${DB_DIR}/schema.sql"
  log "dumping data (COPY statements; real rows)"
  supabase db dump --db-url "${SUPABASE_DB_URL}" --data-only --use-copy -f "${DB_DIR}/data.sql"
fi

assert_roles_sql "${DB_DIR}/roles.sql"
assert_schema_sql "${DB_DIR}/schema.sql"
assert_data_sql_has_rows "${DB_DIR}/data.sql"

log "packaging database artifacts"
(
  cd "$DB_DIR"
  tar_czf database.tar.gz roles.sql schema.sql data.sql
)

age_encrypt "${DB_DIR}/database.tar.gz" "${DB_DIR}/database.tar.gz.age"
DB_SHA="$(write_sha256_sidecar "${DB_DIR}/database.tar.gz.age")"
log "database ciphertext sha256=${DB_SHA}"

# Drop plaintext after encryption so a later crash does not leave dumps around.
rm -f "${DB_DIR}/roles.sql" "${DB_DIR}/schema.sql" "${DB_DIR}/data.sql" "${DB_DIR}/database.tar.gz"

PREFIX_DAILY="production/database/daily/${BACKUP_ID}"
if [[ "${BACKUP_UPLOAD:-1}" == "1" ]]; then
  log "uploading database ciphertext to R2 ${PREFIX_DAILY}/"
  r2_cp_up "${DB_DIR}/database.tar.gz.age" "${PREFIX_DAILY}/database.tar.gz.age"
  r2_cp_up "${DB_DIR}/database.tar.gz.age.sha256" "${PREFIX_DAILY}/database.tar.gz.age.sha256"
else
  log "BACKUP_UPLOAD=0 — skipping R2 upload"
fi

MANIFEST_DIR="${WORK}/manifest"
mkdir -p "$MANIFEST_DIR"
cat >"${MANIFEST_DIR}/database.json" <<EOF
{
  "backup_id": $(printf '%s' "$BACKUP_ID" | jq -Rs .),
  "created_at": $(printf '%s' "$(utc_now)" | jq -Rs .),
  "object_key": $(printf '%s' "${PREFIX_DAILY}/database.tar.gz.age" | jq -Rs .),
  "sha256": $(printf '%s' "$DB_SHA" | jq -Rs .),
  "bytes": $(wc -c <"${DB_DIR}/database.tar.gz.age" | tr -d ' '),
  "artifacts": ["roles.sql", "schema.sql", "data.sql"],
  "auth_included": false,
  "storage_schema_included": false,
  "repo_latest_migration": $(printf '%s' "$(latest_repo_migration)" | jq -Rs .)
}
EOF

log "database backup artifacts ready (plaintext dumps removed)"
