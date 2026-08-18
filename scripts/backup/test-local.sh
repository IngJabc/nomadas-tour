#!/usr/bin/env bash
# Local tests for backup scripts. No production network. Requires: bash, age, jq, tar, gzip.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=lib.sh
source "${ROOT}/scripts/backup/lib.sh"
BACKUP_LOG_PREFIX="backup-test"

require_cmd age age-keygen jq tar gzip

PASS=0
FAIL=0
assert_fail() {
  local name="$1"
  shift
  if "$@" >/tmp/nomadas-backup-test.out 2>/tmp/nomadas-backup-test.err; then
    printf 'FAIL %s (expected non-zero)\n' "$name"
    FAIL=$((FAIL + 1))
  else
    printf 'PASS %s\n' "$name"
    PASS=$((PASS + 1))
  fi
}
assert_ok() {
  local name="$1"
  shift
  if "$@"; then
    printf 'PASS %s\n' "$name"
    PASS=$((PASS + 1))
  else
    printf 'FAIL %s\n' "$name"
    FAIL=$((FAIL + 1))
  fi
}

TMP="$(mktemp -d "${TMPDIR:-/tmp}/nomadas-backup-test.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

PRIMARY="${TMP}/primary.txt"
VERIFY="${TMP}/verify.txt"
age-keygen -o "$PRIMARY" 2>/dev/null
age-keygen -o "$VERIFY" 2>/dev/null
PRIMARY_PUB="$(age-keygen -y "$PRIMARY")"
VERIFY_PUB="$(age-keygen -y "$VERIFY")"

export BACKUP_AGE_RECIPIENT="$PRIMARY_PUB"
export BACKUP_AGE_VERIFY_RECIPIENT="$VERIFY_PUB"
export BACKUP_AGE_IDENTITY_FILE="$VERIFY"
export BACKUP_UPLOAD=0
export BACKUP_KEEP_WORK=1
export BACKUP_SKIP_DUMP=1
export BACKUP_SKIP_STORAGE_API=1
export BACKUP_VERIFY_LOCAL=1
export BACKUP_REPO_ROOT="$ROOT"

# --- missing secret ---
assert_fail "missing BACKUP_AGE_RECIPIENT" \
  env -u BACKUP_AGE_RECIPIENT bash -c "source '${ROOT}/scripts/backup/lib.sh'; require_env BACKUP_AGE_RECIPIENT"

# --- empty artifact ---
empty="${TMP}/empty.sql"
: >"$empty"
assert_fail "empty data.sql" \
  bash -c "source '${ROOT}/scripts/backup/lib.sh'; assert_nonempty_file '${empty}' data.sql"

# --- schema-only data.sql ---
schema_only="${TMP}/schema-only.sql"
printf 'SET session_replication_role = replica;\n-- no rows\n' >"$schema_only"
assert_fail "data.sql without COPY/INSERT" \
  bash -c "source '${ROOT}/scripts/backup/lib.sh'; assert_data_sql_has_rows '${schema_only}'"

# --- Supabase Storage internals must not appear in data.sql ---
bad_vectors="${TMP}/bad-vectors.sql"
printf 'COPY public.trips (id) FROM stdin;\n11111111-1111-1111-1111-111111111111\n\\.\nCOPY storage.buckets_vectors (id) FROM stdin;\n\\.\n' >"$bad_vectors"
assert_fail "data.sql with storage.buckets_vectors COPY" \
  bash -c "source '${ROOT}/scripts/backup/lib.sh'; assert_data_sql_has_rows '${bad_vectors}'; assert_data_sql_excludes_internal_storage '${bad_vectors}'"

bad_indexes="${TMP}/bad-indexes.sql"
printf 'COPY public.trips (id) FROM stdin;\n11111111-1111-1111-1111-111111111111\n\\.\nCOPY storage.vector_indexes (id) FROM stdin;\n\\.\n' >"$bad_indexes"
assert_fail "data.sql with storage.vector_indexes COPY" \
  bash -c "source '${ROOT}/scripts/backup/lib.sh'; assert_data_sql_has_rows '${bad_indexes}'; assert_data_sql_excludes_internal_storage '${bad_indexes}'"

good_data="${TMP}/good-business.sql"
printf 'COPY public.trips (id) FROM stdin;\n11111111-1111-1111-1111-111111111111\n\\.\nCOPY public.agencies (id) FROM stdin;\n22222222-2222-2222-2222-222222222222\n\\.\n' >"$good_data"
assert_ok "business data.sql passes row + storage exclusion checks" \
  bash -c "source '${ROOT}/scripts/backup/lib.sh'; assert_data_sql_has_rows '${good_data}'; assert_data_sql_excludes_internal_storage '${good_data}'"

# --- happy path fixtures ---
export BACKUP_WORK_DIR="${TMP}/work"
export BACKUP_ID="19700101T000000Z-test"
mkdir -p "${BACKUP_WORK_DIR}/database" "${BACKUP_WORK_DIR}/storage/tree/agency-assets/logos"
printf 'ALTER ROLE postgres WITH LOGIN;\n' >"${BACKUP_WORK_DIR}/database/roles.sql"
printf 'CREATE TABLE public.trips (id uuid);\n' >"${BACKUP_WORK_DIR}/database/schema.sql"
printf 'COPY public.trips (id) FROM stdin;\n11111111-1111-1111-1111-111111111111\n\\.\n' >"${BACKUP_WORK_DIR}/database/data.sql"
printf 'logo-bytes' >"${BACKUP_WORK_DIR}/storage/tree/agency-assets/logos/test.png"

assert_ok "database.sh fixtures" bash "${ROOT}/scripts/backup/database.sh"
assert_ok "storage.sh fixtures" bash "${ROOT}/scripts/backup/storage.sh"
assert_ok "finalize.sh local" bash "${ROOT}/scripts/backup/finalize.sh"
assert_ok "verify.sh local decrypt" bash "${ROOT}/scripts/backup/verify.sh"

# --- corrupt checksum ---
echo "deadbeef  database.tar.gz.age" >"${BACKUP_WORK_DIR}/database/database.tar.gz.age.sha256"
assert_fail "invalid checksum" bash "${ROOT}/scripts/backup/verify.sh"

# restore good sidecar then corrupt ciphertext
# re-run encrypt path for remaining tests
rm -rf "${BACKUP_WORK_DIR}"
mkdir -p "${BACKUP_WORK_DIR}/database" "${BACKUP_WORK_DIR}/storage/tree/agency-assets"
printf 'ALTER ROLE postgres WITH LOGIN;\n' >"${BACKUP_WORK_DIR}/database/roles.sql"
printf 'CREATE TABLE public.trips (id uuid);\n' >"${BACKUP_WORK_DIR}/database/schema.sql"
printf 'COPY public.trips (id) FROM stdin;\n11111111-1111-1111-1111-111111111111\n\\.\n' >"${BACKUP_WORK_DIR}/database/data.sql"
printf 'x' >"${BACKUP_WORK_DIR}/storage/tree/agency-assets/a.bin"
bash "${ROOT}/scripts/backup/database.sh"
bash "${ROOT}/scripts/backup/storage.sh"
bash "${ROOT}/scripts/backup/finalize.sh"

# --- corrupt ciphertext ---
printf 'not-an-age-file' >"${BACKUP_WORK_DIR}/database/database.tar.gz.age"
write_sha256_sidecar "${BACKUP_WORK_DIR}/database/database.tar.gz.age" >/dev/null
assert_fail "corrupt ciphertext" bash "${ROOT}/scripts/backup/verify.sh"

# --- wrong identity ---
rm -rf "${BACKUP_WORK_DIR}"
mkdir -p "${BACKUP_WORK_DIR}/database" "${BACKUP_WORK_DIR}/storage/tree/agency-assets"
printf 'ALTER ROLE postgres WITH LOGIN;\n' >"${BACKUP_WORK_DIR}/database/roles.sql"
printf 'CREATE TABLE public.trips (id uuid);\n' >"${BACKUP_WORK_DIR}/database/schema.sql"
printf 'COPY public.trips (id) FROM stdin;\nx\n\\.\n' >"${BACKUP_WORK_DIR}/database/data.sql"
printf 'x' >"${BACKUP_WORK_DIR}/storage/tree/agency-assets/a.bin"
bash "${ROOT}/scripts/backup/database.sh"
bash "${ROOT}/scripts/backup/storage.sh"
WRONG="${TMP}/wrong.txt"
age-keygen -o "$WRONG" >/dev/null
assert_fail "wrong encryption identity" \
  env BACKUP_AGE_IDENTITY_FILE="$WRONG" BACKUP_AGE_VERIFY_IDENTITY= BACKUP_AGE_SECRET_KEY= \
    bash "${ROOT}/scripts/backup/verify.sh"

# --- restore refuses without confirm ---
assert_fail "restore without CONFIRM_RESTORE" \
  env BACKUP_ID=test RESTORE_TARGET_DB_URL=postgres://x CONFIRM_RESTORE= RESTORE_ISOLATED=yes \
    bash "${ROOT}/scripts/backup/restore.sh"

assert_fail "restore without RESTORE_ISOLATED" \
  env BACKUP_ID=test RESTORE_TARGET_DB_URL=postgres://x CONFIRM_RESTORE=RESTORE RESTORE_ISOLATED= \
    bash "${ROOT}/scripts/backup/restore.sh"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
