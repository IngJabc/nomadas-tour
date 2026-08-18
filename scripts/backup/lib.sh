#!/usr/bin/env bash
# Shared helpers for Nómadas Tour backup/restore. Source this file; do not execute.
# Never print secrets, connection strings, or age identities.

set -euo pipefail

BACKUP_LOG_PREFIX="${BACKUP_LOG_PREFIX:-backup}"

# Supabase Storage internals — excluded from logical data dump (object bytes live in storage.sh).
BACKUP_DATA_EXCLUDE_STORAGE_TABLES=(
  storage.buckets_vectors
  storage.vector_indexes
)

# Transient / platform-managed Auth tables — excluded from data dump.
# Core Auth (users, identities, mfa_factors, audit_log_entries) is kept.
# sessions / refresh_tokens / mfa_amr_claims are kept by default (not treated as reusable after restore).
BACKUP_DATA_EXCLUDE_AUTH_TABLES=(
  auth.flow_state
  auth.saml_relay_states
  auth.oauth_client_states
  auth.mfa_challenges
  auth.webauthn_challenges
  auth.instances
  auth.schema_migrations
)

BACKUP_DATA_EXCLUDE_TABLES=(
  "${BACKUP_DATA_EXCLUDE_STORAGE_TABLES[@]}"
  "${BACKUP_DATA_EXCLUDE_AUTH_TABLES[@]}"
)

log() {
  printf '[%s] %s\n' "${BACKUP_LOG_PREFIX}" "$*" >&2
}

die() {
  printf '[%s] ERROR: %s\n' "${BACKUP_LOG_PREFIX}" "$*" >&2
  exit 1
}

require_cmd() {
  local c
  for c in "$@"; do
    command -v "$c" >/dev/null 2>&1 || die "required command not found: $c"
  done
}

require_env() {
  local n
  for n in "$@"; do
    if [[ -z "${!n:-}" ]]; then
      die "missing required environment variable: $n"
    fi
  done
}

# Redact userinfo from URLs if a string is ever echoed by mistake.
redact() {
  sed -E 's#(postgres(ql)?|https?)://[^/@]+:[^/@]+@#\1://***:***@#g'
}

sha256_file() {
  local f="$1"
  [[ -f "$f" ]] || die "checksum target missing: $f"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$f" | awk '{print $1}'
  else
    shasum -a 256 "$f" | awk '{print $1}'
  fi
}

write_sha256_sidecar() {
  local f="$1"
  local hash
  hash="$(sha256_file "$f")"
  printf '%s  %s\n' "$hash" "$(basename "$f")" >"${f}.sha256"
  printf '%s' "$hash"
}

assert_nonempty_file() {
  local f="$1"
  local label="${2:-$f}"
  [[ -f "$f" ]] || die "$label does not exist"
  [[ -s "$f" ]] || die "$label is empty"
}

age_encrypt() {
  local infile="$1"
  local outfile="$2"
  require_env BACKUP_AGE_RECIPIENT
  require_cmd age
  local args=(-r "${BACKUP_AGE_RECIPIENT}")
  if [[ -n "${BACKUP_AGE_VERIFY_RECIPIENT:-}" ]]; then
    args+=(-r "${BACKUP_AGE_VERIFY_RECIPIENT}")
  fi
  age "${args[@]}" -o "$outfile" "$infile"
  [[ -s "$outfile" ]] || die "age produced an empty ciphertext: $outfile"
  # age v1 header — confirms encryption, not a renamed plaintext.
  head -c 21 "$outfile" | grep -q 'age-encryption.org/v1' \
    || die "ciphertext missing age header: $outfile"
}

age_decrypt() {
  local infile="$1"
  local outfile="$2"
  local identity="${3:-}"
  require_cmd age
  if [[ -z "$identity" ]]; then
    identity="${BACKUP_AGE_IDENTITY_FILE:-}"
  fi
  if [[ -z "$identity" && -n "${BACKUP_AGE_VERIFY_IDENTITY:-}" ]]; then
    identity="$(mktemp)"
    printf '%s\n' "${BACKUP_AGE_VERIFY_IDENTITY}" >"$identity"
    chmod 600 "$identity"
  fi
  if [[ -z "$identity" && -n "${BACKUP_AGE_SECRET_KEY:-}" ]]; then
    identity="$(mktemp)"
    printf '%s\n' "${BACKUP_AGE_SECRET_KEY}" >"$identity"
    chmod 600 "$identity"
  fi
  [[ -n "$identity" && -f "$identity" ]] || die "no age identity available for decrypt"
  age -d -i "$identity" -o "$outfile" "$infile"
  [[ -s "$outfile" ]] || die "decrypt produced an empty file"
}

r2_endpoint() {
  require_env R2_ACCOUNT_ID
  printf 'https://%s.r2.cloudflarestorage.com' "${R2_ACCOUNT_ID}"
}

r2_env() {
  require_env R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY
  export AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}"
  export AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}"
  export AWS_DEFAULT_REGION="${R2_REGION:-auto}"
  export AWS_EC2_METADATA_DISABLED=true
}

r2_bucket() {
  printf '%s' "${R2_BUCKET:-nomadas-backups}"
}

r2_cp_up() {
  local src="$1"
  local key="$2"
  r2_env
  require_cmd aws
  aws s3 cp "$src" "s3://$(r2_bucket)/${key}" \
    --endpoint-url "$(r2_endpoint)" \
    --only-show-errors
}

r2_cp_down() {
  local key="$1"
  local dest="$2"
  mkdir -p "$(dirname "$dest")"
  if [[ -n "${BACKUP_R2_FIXTURE_DIR:-}" ]]; then
    local src="${BACKUP_R2_FIXTURE_DIR}/${key}"
    [[ -f "$src" ]] || die "R2 fixture missing: ${key}"
    cp -p "$src" "$dest"
    return 0
  fi
  r2_env
  require_cmd aws
  aws s3 cp "s3://$(r2_bucket)/${key}" "$dest" \
    --endpoint-url "$(r2_endpoint)" \
    --only-show-errors
}

r2_cp_copy() {
  local src_key="$1"
  local dest_key="$2"
  r2_env
  require_cmd aws
  aws s3 cp "s3://$(r2_bucket)/${src_key}" "s3://$(r2_bucket)/${dest_key}" \
    --endpoint-url "$(r2_endpoint)" \
    --only-show-errors
}

r2_ls() {
  local prefix="$1"
  r2_env
  require_cmd aws
  aws s3 ls "s3://$(r2_bucket)/${prefix}" \
    --endpoint-url "$(r2_endpoint)" \
    --recursive
}

r2_rm() {
  local key="$1"
  r2_env
  require_cmd aws
  aws s3 rm "s3://$(r2_bucket)/${key}" \
    --endpoint-url "$(r2_endpoint)" \
    --only-show-errors
}

utc_now() {
  date -u +%Y-%m-%dT%H:%M:%SZ
}

new_backup_id() {
  local run="${GITHUB_RUN_ID:-local}"
  printf '%s-%s' "$(date -u +%Y%m%dT%H%M%SZ)" "$run"
}

latest_repo_migration() {
  local dir="${BACKUP_REPO_ROOT:-.}/supabase/migrations"
  if [[ -d "$dir" ]]; then
    basename "$(ls -1 "$dir"/*.sql 2>/dev/null | sort | tail -n 1)"
  else
    printf ''
  fi
}

# pg_dump may emit COPY schema.table or COPY "schema"."table".
data_sql_has_copy_table() {
  local f="$1"
  local schema="$2"
  local table="$3"
  grep -Eq "^COPY ${schema}\\.${table} |^COPY \"${schema}\"\\.\"${table}\" " "$f"
}

# Count COPY tuples only (never prints row payloads).
count_copy_rows() {
  local f="$1"
  local schema="$2"
  local table="$3"
  awk -v schema="$schema" -v table="$table" '
    BEGIN { inblk = 0; n = 0 }
    $0 ~ "^COPY " schema "[.]" table " " { inblk = 1; next }
    $0 ~ "^COPY \"" schema "\"[.]\"" table "\" " { inblk = 1; next }
    inblk && ($0 == "\\." || $0 == "\\.\r") { print n; found = 1; exit }
    inblk { n++ }
    END { if (!found) print 0 }
  ' "$f"
}

# Read-only Auth counts. Prefers a live SELECT when psql + SUPABASE_DB_URL exist;
# otherwise counts COPY tuples in data.sql (the production dump snapshot).
# Whitelisted table names only. Prints a single integer. Never logs row data.
auth_table_count() {
  local table="$1"
  local data_sql="${2:-}"
  local from_db=""
  case "$table" in
    users|identities|mfa_factors) ;;
    *) die "refusing unknown auth table count" ;;
  esac
  if [[ "${BACKUP_SKIP_DUMP:-0}" != "1" && -n "${SUPABASE_DB_URL:-}" ]] \
    && command -v psql >/dev/null 2>&1; then
    from_db="$(
      psql --no-psqlrc --quiet --tuples-only --no-align \
        --dbname "${SUPABASE_DB_URL}" \
        --command "SELECT count(*)::bigint FROM auth.${table};" 2>/dev/null \
        | tr -d '[:space:]' || true
    )"
  fi
  if [[ "$from_db" =~ ^[0-9]+$ ]]; then
    printf '%s' "$from_db"
    return 0
  fi
  [[ -n "$data_sql" && -f "$data_sql" ]] || die "cannot count auth.${table}: no dump and no live query"
  count_copy_rows "$data_sql" auth "$table"
}

assert_data_sql_has_rows() {
  local f="$1"
  assert_nonempty_file "$f" "data.sql"
  if ! grep -Eq '^COPY |^INSERT ' "$f"; then
    die "data.sql has no COPY/INSERT statements — refusing schema-only dump"
  fi
}

assert_data_sql_has_auth_users() {
  local f="$1"
  data_sql_has_copy_table "$f" auth users \
    || die "data.sql missing COPY auth.users — Auth users are required"
}

assert_data_sql_has_auth_identities() {
  local f="$1"
  data_sql_has_copy_table "$f" auth identities \
    || die "data.sql missing COPY auth.identities — Auth identities are required"
}

assert_data_sql_excludes_internal_storage() {
  local f="$1"
  local t schema table
  for t in "${BACKUP_DATA_EXCLUDE_STORAGE_TABLES[@]}"; do
    schema="${t%%.*}"
    table="${t#*.}"
    if data_sql_has_copy_table "$f" "$schema" "$table"; then
      die "data.sql must not COPY ${t} — restore uses storage.tar.gz.age for object bytes"
    fi
  done
}

assert_data_sql_excludes_transient_auth() {
  local f="$1"
  local t schema table
  for t in "${BACKUP_DATA_EXCLUDE_AUTH_TABLES[@]}"; do
    schema="${t%%.*}"
    table="${t#*.}"
    if data_sql_has_copy_table "$f" "$schema" "$table"; then
      die "data.sql must not COPY ${t} — transient/managed Auth table"
    fi
  done
}

assert_data_sql_backup_contract() {
  local f="$1"
  assert_data_sql_has_rows "$f"
  assert_data_sql_has_auth_users "$f"
  assert_data_sql_has_auth_identities "$f"
  assert_data_sql_excludes_transient_auth "$f"
  assert_data_sql_excludes_internal_storage "$f"
}

assert_schema_sql() {
  local f="$1"
  assert_nonempty_file "$f" "schema.sql"
  grep -Eq 'CREATE TABLE|create table' "$f" \
    || die "schema.sql does not contain CREATE TABLE"
}

assert_roles_sql() {
  local f="$1"
  assert_nonempty_file "$f" "roles.sql"
  grep -Eqi 'ROLE' "$f" || die "roles.sql does not mention ROLE"
}

tar_czf() {
  local archive="$1"
  shift
  require_cmd tar gzip
  tar -czf "$archive" "$@"
  [[ -s "$archive" ]] || die "compression produced an empty archive: $archive"
  gzip -t "$archive" || die "gzip integrity check failed: $archive"
}

verify_sha256_sidecar() {
  local f="$1"
  local side="${f}.sha256"
  [[ -f "$side" ]] || die "missing sha256 sidecar for $(basename "$f")"
  local expected actual
  expected="$(awk '{print $1}' "$side")"
  actual="$(sha256_file "$f")"
  [[ "$expected" == "$actual" ]] || die "SHA-256 mismatch for $(basename "$f")"
}

assert_age_ciphertext() {
  local f="$1"
  assert_nonempty_file "$f" "$(basename "$f")"
  head -c 21 "$f" | grep -q 'age-encryption.org/v1' \
    || die "not an age ciphertext: $(basename "$f")"
}

assert_manifest_for_backup() {
  local f="$1"
  local id="$2"
  require_cmd jq
  assert_nonempty_file "$f" "manifest.json"
  jq -e . "$f" >/dev/null 2>&1 || die "manifest.json is not valid JSON"
  local mid
  mid="$(jq -r '.backup_id // empty' "$f")"
  [[ "$mid" == "$id" ]] || die "manifest backup_id does not match requested backup"
}

local_daily_dir() {
  local root="$1"
  local id="$2"
  printf '%s/daily/%s' "${root%/}" "$id"
}

assert_local_backup_artifacts() {
  local dir="$1"
  local f
  for f in database.tar.gz.age database.tar.gz.age.sha256 \
           storage.tar.gz.age storage.tar.gz.age.sha256 manifest.json; do
    assert_nonempty_file "${dir}/${f}" "$f"
  done
}

# Returns 0 if the five artifacts exist and both SHA-256 sidecars match.
# Does not abort the caller on mismatch (unlike verify_sha256_sidecar).
local_backup_checksums_ok() {
  local dir="$1"
  local f
  for f in database.tar.gz.age database.tar.gz.age.sha256 \
           storage.tar.gz.age storage.tar.gz.age.sha256 manifest.json; do
    [[ -s "${dir}/${f}" ]] || return 1
  done
  ( verify_sha256_sidecar "${dir}/database.tar.gz.age" && verify_sha256_sidecar "${dir}/storage.tar.gz.age" ) \
    >/dev/null 2>&1 || return 1
  return 0
}

restore_require_guards() {
  require_env RESTORE_TARGET_DB_URL
  if [[ "${CONFIRM_RESTORE:-}" != "RESTORE" ]]; then
    die "refusing to restore: set CONFIRM_RESTORE=RESTORE"
  fi
  if [[ "${RESTORE_ISOLATED:-}" != "yes" ]]; then
    die "refusing to restore: set RESTORE_ISOLATED=yes (isolated target only)"
  fi
  if [[ -n "${PRODUCTION_DB_URL_MARKER:-}" ]]; then
    case "${RESTORE_TARGET_DB_URL}" in
      *"${PRODUCTION_DB_URL_MARKER}"*)
        if [[ "${RESTORE_ALLOW_PRODUCTION:-}" != "I_UNDERSTAND" ]]; then
          die "target URL looks like production; aborting"
        fi
        ;;
    esac
  fi
}

restore_apply_database() {
  local dbdir="$1"
  assert_roles_sql "${dbdir}/roles.sql"
  assert_schema_sql "${dbdir}/schema.sql"
  assert_data_sql_backup_contract "${dbdir}/data.sql"
  if [[ "${RESTORE_DRY_RUN:-0}" == "1" ]]; then
    log "RESTORE_DRY_RUN=1 — skipping psql apply"
    return 0
  fi
  require_cmd psql
  local -a PSQL
  PSQL=(psql --single-transaction --variable ON_ERROR_STOP=1 --dbname "${RESTORE_TARGET_DB_URL}")
  if [[ "${SKIP_ROLES:-0}" != "1" ]]; then
    log "restoring roles.sql"
    "${PSQL[@]}" --file "${dbdir}/roles.sql"
  else
    log "SKIP_ROLES=1 — skipping roles.sql"
  fi
  log "restoring schema.sql"
  "${PSQL[@]}" --file "${dbdir}/schema.sql"
  log "restoring data.sql"
  "${PSQL[@]}" --file "${dbdir}/data.sql"
  log "database restore statements applied"
}

restore_apply_storage() {
  local treedir="$1"
  [[ -d "$treedir" ]] || die "storage tree missing"
  if [[ "${RESTORE_DRY_RUN:-0}" == "1" ]]; then
    log "RESTORE_DRY_RUN=1 — skipping Storage upload"
    return 0
  fi
  require_env SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY
  require_cmd python3 curl
  python3 - "$treedir" <<'PY'
import os, sys, urllib.parse, subprocess
root = sys.argv[1]
url = os.environ["SUPABASE_URL"].rstrip("/")
key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
for dirpath, _, files in os.walk(root):
    for name in files:
        full = os.path.join(dirpath, name)
        rel = os.path.relpath(full, root).replace("\\", "/")
        bucket, _, path = rel.partition("/")
        if not path:
            continue
        encoded = urllib.parse.quote(path, safe="/")
        dest = f"{url}/storage/v1/object/{bucket}/{encoded}"
        subprocess.check_call([
            "curl", "-fsS", "-X", "POST", dest,
            "-H", f"Authorization: Bearer {key}",
            "-H", f"apikey: {key}",
            "-H", "x-upsert: true",
            "-F", f"file=@{full}",
        ])
        print(f"restored {bucket}/{path}", file=sys.stderr)
PY
  log "storage objects uploaded to target project"
}

restore_log_finished() {
  log "restore finished. Auth user data and identities are restored from data.sql."
  log "Users must re-login after restore. Old JWTs, sessions, and refresh tokens are not considered reusable."
  log "External OAuth/SSO/SMTP/platform configuration requires manual reconfiguration."
  log "Next: configure project, deploy API/worker, smoke tests (isolated). See docs/backup-disaster-recovery-runbook.md"
}
