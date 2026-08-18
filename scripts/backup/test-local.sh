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

# Minimal valid dump: business rows + required Auth COPY blocks, no excluded tables.
write_valid_data_sql() {
  local dest="$1"
  cat >"$dest" <<'EOF'
COPY public.trips (id) FROM stdin;
11111111-1111-1111-1111-111111111111
\.
COPY "auth"."users" (id) FROM stdin;
aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa
\.
COPY "auth"."identities" (id) FROM stdin;
bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb
\.
EOF
}

# --- schema-only data.sql ---
schema_only="${TMP}/schema-only.sql"
printf 'SET session_replication_role = replica;\n-- no rows\n' >"$schema_only"
assert_fail "data.sql without COPY/INSERT" \
  bash -c "source '${ROOT}/scripts/backup/lib.sh'; assert_data_sql_has_rows '${schema_only}'"

# --- Auth contract: required COPY blocks (quoted pg_dump form) ---
auth_users_ok="${TMP}/auth-users-ok.sql"
write_valid_data_sql "$auth_users_ok"
assert_ok "data.sql with COPY auth.users" \
  bash -c "source '${ROOT}/scripts/backup/lib.sh'; assert_data_sql_has_auth_users '${auth_users_ok}'"

auth_users_missing="${TMP}/auth-users-missing.sql"
printf 'COPY public.trips (id) FROM stdin;\n11111111-1111-1111-1111-111111111111\n\\.\nCOPY "auth"."identities" (id) FROM stdin;\nbbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb\n\\.\n' >"$auth_users_missing"
assert_fail "data.sql without COPY auth.users" \
  bash -c "source '${ROOT}/scripts/backup/lib.sh'; assert_data_sql_has_auth_users '${auth_users_missing}'"

assert_ok "data.sql with COPY auth.identities" \
  bash -c "source '${ROOT}/scripts/backup/lib.sh'; assert_data_sql_has_auth_identities '${auth_users_ok}'"

auth_identities_missing="${TMP}/auth-identities-missing.sql"
printf 'COPY public.trips (id) FROM stdin;\n11111111-1111-1111-1111-111111111111\n\\.\nCOPY "auth"."users" (id) FROM stdin;\naaaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\n\\.\n' >"$auth_identities_missing"
assert_fail "data.sql without COPY auth.identities" \
  bash -c "source '${ROOT}/scripts/backup/lib.sh'; assert_data_sql_has_auth_identities '${auth_identities_missing}'"

# --- Auth contract: excluded transient/managed tables ---
assert_transient_fail() {
  local name="$1"
  local table="$2"
  local f="${TMP}/bad-${name}.sql"
  write_valid_data_sql "$f"
  printf 'COPY "auth"."%s" (id) FROM stdin;\n\\.\n' "$table" >>"$f"
  assert_fail "data.sql with COPY auth.${table}" \
    bash -c "source '${ROOT}/scripts/backup/lib.sh'; assert_data_sql_excludes_transient_auth '${f}'"
}
assert_transient_fail "flow_state" "flow_state"
assert_transient_fail "saml_relay_states" "saml_relay_states"
assert_transient_fail "oauth_client_states" "oauth_client_states"
assert_transient_fail "mfa_challenges" "mfa_challenges"
assert_transient_fail "webauthn_challenges" "webauthn_challenges"
assert_transient_fail "instances" "instances"
assert_transient_fail "schema_migrations" "schema_migrations"

# --- Supabase Storage internals must not appear in data.sql ---
bad_vectors="${TMP}/bad-vectors.sql"
write_valid_data_sql "$bad_vectors"
printf 'COPY storage.buckets_vectors (id) FROM stdin;\n\\.\n' >>"$bad_vectors"
assert_fail "data.sql with storage.buckets_vectors COPY" \
  bash -c "source '${ROOT}/scripts/backup/lib.sh'; assert_data_sql_has_rows '${bad_vectors}'; assert_data_sql_excludes_internal_storage '${bad_vectors}'"

bad_indexes="${TMP}/bad-indexes.sql"
write_valid_data_sql "$bad_indexes"
printf 'COPY storage.vector_indexes (id) FROM stdin;\n\\.\n' >>"$bad_indexes"
assert_fail "data.sql with storage.vector_indexes COPY" \
  bash -c "source '${ROOT}/scripts/backup/lib.sh'; assert_data_sql_has_rows '${bad_indexes}'; assert_data_sql_excludes_internal_storage '${bad_indexes}'"

good_data="${TMP}/good-business.sql"
write_valid_data_sql "$good_data"
assert_ok "business+auth data.sql passes full backup contract" \
  bash -c "source '${ROOT}/scripts/backup/lib.sh'; assert_data_sql_backup_contract '${good_data}'"

# --- happy path fixtures ---
export BACKUP_WORK_DIR="${TMP}/work"
export BACKUP_ID="19700101T000000Z-test"
mkdir -p "${BACKUP_WORK_DIR}/database" "${BACKUP_WORK_DIR}/storage/tree/agency-assets/logos"
printf 'ALTER ROLE postgres WITH LOGIN;\n' >"${BACKUP_WORK_DIR}/database/roles.sql"
printf 'CREATE TABLE public.trips (id uuid);\n' >"${BACKUP_WORK_DIR}/database/schema.sql"
write_valid_data_sql "${BACKUP_WORK_DIR}/database/data.sql"
printf 'logo-bytes' >"${BACKUP_WORK_DIR}/storage/tree/agency-assets/logos/test.png"

assert_ok "database.sh fixtures" bash "${ROOT}/scripts/backup/database.sh"
assert_ok "storage.sh fixtures" bash "${ROOT}/scripts/backup/storage.sh"
assert_ok "finalize.sh local" bash "${ROOT}/scripts/backup/finalize.sh"
assert_ok "manifest auth_included true with counts" \
  jq -e '.auth_included == true and (.auth.users | type == "number") and (.auth.identities | type == "number") and (.auth.mfa_factors | type == "number")' \
    "${BACKUP_WORK_DIR}/manifest/manifest.json" >/dev/null
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
write_valid_data_sql "${BACKUP_WORK_DIR}/database/data.sql"
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
write_valid_data_sql "${BACKUP_WORK_DIR}/database/data.sql"
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

# --- local contingency copy (R2 fixture, no network) ---
LOCAL_ROOT="${TMP}/local-backups"
FIXTURE_R2="${TMP}/r2-fixture"
BID="19700101T120000Z-localcopy"
export BACKUP_ID="$BID"
export BACKUP_WORK_DIR="${TMP}/work-localcopy"
rm -rf "${BACKUP_WORK_DIR}"
mkdir -p "${BACKUP_WORK_DIR}/database" "${BACKUP_WORK_DIR}/storage/tree/agency-assets"
printf 'ALTER ROLE postgres WITH LOGIN;\n' >"${BACKUP_WORK_DIR}/database/roles.sql"
printf 'CREATE TABLE public.trips (id uuid);\n' >"${BACKUP_WORK_DIR}/database/schema.sql"
write_valid_data_sql "${BACKUP_WORK_DIR}/database/data.sql"
printf 'x' >"${BACKUP_WORK_DIR}/storage/tree/agency-assets/a.bin"
bash "${ROOT}/scripts/backup/database.sh"
bash "${ROOT}/scripts/backup/storage.sh"
bash "${ROOT}/scripts/backup/finalize.sh"

mkdir -p \
  "${FIXTURE_R2}/production/database/daily/${BID}" \
  "${FIXTURE_R2}/production/storage/daily/${BID}" \
  "${FIXTURE_R2}/production/manifests/daily/${BID}"
cp "${BACKUP_WORK_DIR}/database/database.tar.gz.age" \
  "${FIXTURE_R2}/production/database/daily/${BID}/database.tar.gz.age"
cp "${BACKUP_WORK_DIR}/database/database.tar.gz.age.sha256" \
  "${FIXTURE_R2}/production/database/daily/${BID}/database.tar.gz.age.sha256"
cp "${BACKUP_WORK_DIR}/storage/storage.tar.gz.age" \
  "${FIXTURE_R2}/production/storage/daily/${BID}/storage.tar.gz.age"
cp "${BACKUP_WORK_DIR}/storage/storage.tar.gz.age.sha256" \
  "${FIXTURE_R2}/production/storage/daily/${BID}/storage.tar.gz.age.sha256"
cp "${BACKUP_WORK_DIR}/manifest/manifest.json" \
  "${FIXTURE_R2}/production/manifests/daily/${BID}/manifest.json"
export BACKUP_R2_FIXTURE_DIR="${FIXTURE_R2}"
DEST="$(local_daily_dir "$LOCAL_ROOT" "$BID")"

assert_fail "local.sh missing BACKUP_ID" \
  bash "${ROOT}/scripts/backup/local.sh"
assert_fail "local.sh missing LOCAL_DIR" \
  bash "${ROOT}/scripts/backup/local.sh" "$BID"
assert_fail "local.sh missing R2 credentials" \
  env -u BACKUP_R2_FIXTURE_DIR -u R2_ACCOUNT_ID -u R2_ACCESS_KEY_ID -u R2_SECRET_ACCESS_KEY \
    bash "${ROOT}/scripts/backup/local.sh" "$BID" "$LOCAL_ROOT"

mv "${FIXTURE_R2}/production/storage/daily/${BID}/storage.tar.gz.age" \
  "${FIXTURE_R2}/production/storage/daily/${BID}/storage.tar.gz.age.off"
assert_fail "local.sh missing artifact" \
  bash "${ROOT}/scripts/backup/local.sh" "$BID" "$LOCAL_ROOT"
[[ ! -e "$DEST" ]]
mv "${FIXTURE_R2}/production/storage/daily/${BID}/storage.tar.gz.age.off" \
  "${FIXTURE_R2}/production/storage/daily/${BID}/storage.tar.gz.age"

cp "${FIXTURE_R2}/production/database/daily/${BID}/database.tar.gz.age.sha256" \
  "${TMP}/database.tar.gz.age.sha256.good"
echo "deadbeef  database.tar.gz.age" \
  >"${FIXTURE_R2}/production/database/daily/${BID}/database.tar.gz.age.sha256"
assert_fail "local.sh checksum mismatch" \
  bash "${ROOT}/scripts/backup/local.sh" "$BID" "$LOCAL_ROOT"
[[ ! -e "$DEST" ]]
cp "${TMP}/database.tar.gz.age.sha256.good" \
  "${FIXTURE_R2}/production/database/daily/${BID}/database.tar.gz.age.sha256"

jq '.backup_id="wrong-id"' "${FIXTURE_R2}/production/manifests/daily/${BID}/manifest.json" \
  >"${TMP}/manifest.bad.json"
cp "${FIXTURE_R2}/production/manifests/daily/${BID}/manifest.json" "${TMP}/manifest.good.json"
cp "${TMP}/manifest.bad.json" "${FIXTURE_R2}/production/manifests/daily/${BID}/manifest.json"
assert_fail "local.sh manifest backup_id mismatch" \
  bash "${ROOT}/scripts/backup/local.sh" "$BID" "$LOCAL_ROOT"
[[ ! -e "$DEST" ]]
printf '{not-json' >"${FIXTURE_R2}/production/manifests/daily/${BID}/manifest.json"
assert_fail "local.sh invalid manifest" \
  bash "${ROOT}/scripts/backup/local.sh" "$BID" "$LOCAL_ROOT"
[[ ! -e "$DEST" ]]
cp "${TMP}/manifest.good.json" "${FIXTURE_R2}/production/manifests/daily/${BID}/manifest.json"

cp "${FIXTURE_R2}/production/database/daily/${BID}/database.tar.gz.age" "${TMP}/database.tar.gz.age.good"
printf 'not-an-age-file' >"${FIXTURE_R2}/production/database/daily/${BID}/database.tar.gz.age"
write_sha256_sidecar "${FIXTURE_R2}/production/database/daily/${BID}/database.tar.gz.age" >/dev/null
assert_fail "local.sh invalid age ciphertext" \
  bash "${ROOT}/scripts/backup/local.sh" "$BID" "$LOCAL_ROOT"
[[ ! -e "$DEST" ]]
cp "${TMP}/database.tar.gz.age.good" \
  "${FIXTURE_R2}/production/database/daily/${BID}/database.tar.gz.age"
write_sha256_sidecar "${FIXTURE_R2}/production/database/daily/${BID}/database.tar.gz.age" >/dev/null

PERM_ROOT="${TMP}/local-noperm"
mkdir -p "$PERM_ROOT"
chmod a-w "$PERM_ROOT"
assert_fail "local.sh destination permissions" \
  bash "${ROOT}/scripts/backup/local.sh" "$BID" "$PERM_ROOT"
chmod u+w "$PERM_ROOT"

assert_ok "local.sh downloads fixture artifacts" \
  bash "${ROOT}/scripts/backup/local.sh" "$BID" "$LOCAL_ROOT"

assert_ok "local ciphertext byte-identical to R2 fixture (database)" \
  cmp "${DEST}/database.tar.gz.age" \
    "${FIXTURE_R2}/production/database/daily/${BID}/database.tar.gz.age"
assert_ok "local ciphertext byte-identical to R2 fixture (storage)" \
  cmp "${DEST}/storage.tar.gz.age" \
    "${FIXTURE_R2}/production/storage/daily/${BID}/storage.tar.gz.age"
assert_ok "local dest has no persistent plaintext archives" \
  bash -c "[[ ! -e '${DEST}/database.tar.gz' && ! -e '${DEST}/storage.tar.gz' && ! -e '${DEST}/data.sql' ]]"
assert_ok "temporary plaintext cleaned after local.sh" \
  bash -c "! compgen -G '${TMPDIR:-/tmp}/nomadas-local-plain.*' >/dev/null"

assert_fail "local.sh refuses existing destination" \
  bash "${ROOT}/scripts/backup/local.sh" "$BID" "$LOCAL_ROOT"

assert_ok "local-list.sh" bash "${ROOT}/scripts/backup/local-list.sh" "$LOCAL_ROOT"

assert_ok "local-verify.sh offline (no R2)" \
  env -u BACKUP_R2_FIXTURE_DIR -u R2_ACCOUNT_ID -u R2_ACCESS_KEY_ID -u R2_SECRET_ACCESS_KEY \
    bash "${ROOT}/scripts/backup/local-verify.sh" "$BID" "$LOCAL_ROOT"

assert_fail "local-restore without CONFIRM_RESTORE" \
  env CONFIRM_RESTORE= RESTORE_ISOLATED=yes RESTORE_TARGET_DB_URL=postgres://x \
    bash "${ROOT}/scripts/backup/local-restore.sh" "$BID" "$LOCAL_ROOT"

assert_ok "local-restore dry-run from local copy" \
  env CONFIRM_RESTORE=RESTORE RESTORE_ISOLATED=yes RESTORE_TARGET_DB_URL=postgres://x \
      RESTORE_DRY_RUN=1 RESTORE_STORAGE=1 \
    bash "${ROOT}/scripts/backup/local-restore.sh" "$BID" "$LOCAL_ROOT"

# checksum mismatch
echo "deadbeef  database.tar.gz.age" >"${DEST}/database.tar.gz.age.sha256"
assert_fail "local-verify checksum mismatch" \
  bash "${ROOT}/scripts/backup/local-verify.sh" "$BID" "$LOCAL_ROOT"
# restore good sidecar from fixture
cp "${FIXTURE_R2}/production/database/daily/${BID}/database.tar.gz.age.sha256" \
  "${DEST}/database.tar.gz.age.sha256"

# invalid manifest backup_id
jq '.backup_id="wrong-id"' "${DEST}/manifest.json" >"${DEST}/manifest.json.tmp"
mv "${DEST}/manifest.json.tmp" "${DEST}/manifest.json"
assert_fail "local-verify manifest backup_id mismatch" \
  bash "${ROOT}/scripts/backup/local-verify.sh" "$BID" "$LOCAL_ROOT"
cp "${FIXTURE_R2}/production/manifests/daily/${BID}/manifest.json" "${DEST}/manifest.json"

# invalid JSON
printf '{not-json' >"${DEST}/manifest.json"
assert_fail "local-verify invalid manifest" \
  bash "${ROOT}/scripts/backup/local-verify.sh" "$BID" "$LOCAL_ROOT"
cp "${FIXTURE_R2}/production/manifests/daily/${BID}/manifest.json" "${DEST}/manifest.json"

# invalid age ciphertext
printf 'not-an-age-file' >"${DEST}/database.tar.gz.age"
write_sha256_sidecar "${DEST}/database.tar.gz.age" >/dev/null
assert_fail "local-verify invalid age ciphertext" \
  bash "${ROOT}/scripts/backup/local-verify.sh" "$BID" "$LOCAL_ROOT"
cp "${FIXTURE_R2}/production/database/daily/${BID}/database.tar.gz.age" "${DEST}/database.tar.gz.age"
cp "${FIXTURE_R2}/production/database/daily/${BID}/database.tar.gz.age.sha256" "${DEST}/database.tar.gz.age.sha256"

# missing artifact
rm -f "${DEST}/storage.tar.gz.age"
assert_fail "local-verify missing artifact" \
  bash "${ROOT}/scripts/backup/local-verify.sh" "$BID" "$LOCAL_ROOT"
cp "${FIXTURE_R2}/production/storage/daily/${BID}/storage.tar.gz.age" "${DEST}/storage.tar.gz.age"

# retention: extra older id + dry-run keeps all, apply keeps newest 1
mkdir -p "${LOCAL_ROOT}/daily/19691231T000000Z-old"
printf 'x' >"${LOCAL_ROOT}/daily/19691231T000000Z-old/placeholder"
assert_ok "local-retention dry-run" \
  bash "${ROOT}/scripts/backup/local-retention.sh" "$LOCAL_ROOT" --dry-run --keep-daily 1
[[ -d "${LOCAL_ROOT}/daily/19691231T000000Z-old" ]]
assert_ok "local-retention apply keep 1" \
  bash "${ROOT}/scripts/backup/local-retention.sh" "$LOCAL_ROOT" --apply --keep-daily 1
[[ ! -d "${LOCAL_ROOT}/daily/19691231T000000Z-old" ]]
[[ -d "${LOCAL_ROOT}/daily/${BID}" ]]

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
