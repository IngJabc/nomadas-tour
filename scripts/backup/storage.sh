#!/usr/bin/env bash
# Storage object backup: discover buckets, download bytes, preserve paths, encrypt, upload.
# Fails the whole backup if any bucket/object download fails.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

BACKUP_LOG_PREFIX="backup-storage"
WORK="${BACKUP_WORK_DIR:-}"
CREATED_WORK=0
if [[ -z "$WORK" ]]; then
  WORK="$(mktemp -d "${TMPDIR:-/tmp}/nomadas-backup-st.XXXXXX")"
  CREATED_WORK=1
  export BACKUP_WORK_DIR="$WORK"
fi
ST_DIR="${WORK}/storage"
TREE="${ST_DIR}/tree"
mkdir -p "$TREE"

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

urlencode_path() {
  python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe="/"))' "$1"
}

list_buckets() {
  local url="${SUPABASE_URL%/}/storage/v1/bucket"
  curl -fsS "$url" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}"
}

list_prefix() {
  local bucket="$1"
  local prefix="$2"
  local offset="$3"
  local url="${SUPABASE_URL%/}/storage/v1/object/list/${bucket}"
  curl -fsS "$url" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg p "$prefix" --argjson o "$offset" '{prefix:$p, limit:100, offset:$o, sortBy:{column:"name", order:"asc"}}')"
}

download_object() {
  local bucket="$1"
  local path="$2"
  local dest="$3"
  mkdir -p "$(dirname "$dest")"
  local encoded
  encoded="$(urlencode_path "$path")"
  local url="${SUPABASE_URL%/}/storage/v1/object/${bucket}/${encoded}"
  curl -fsS "$url" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -o "$dest"
  [[ -f "$dest" ]] || die "download failed: ${bucket}/${path}"
}

# Recurse prefixes. Entries with id==null are folders in Storage list API.
walk_bucket() {
  local bucket="$1"
  local prefix="$2"
  local offset=0
  local batch count name id rel dest
  while true; do
    batch="$(list_prefix "$bucket" "$prefix" "$offset")"
    count="$(printf '%s' "$batch" | jq 'length')"
    if [[ "$count" -eq 0 ]]; then
      break
    fi
    local i
    for i in $(seq 0 $((count - 1))); do
      name="$(printf '%s' "$batch" | jq -r ".[$i].name")"
      id="$(printf '%s' "$batch" | jq -r ".[$i].id")"
      if [[ "$name" == "null" || -z "$name" ]]; then
        continue
      fi
      if [[ "$id" == "null" ]]; then
        walk_bucket "$bucket" "${prefix}${name}/"
        continue
      fi
      rel="${prefix}${name}"
      dest="${TREE}/${bucket}/${rel}"
      log "download ${bucket}/${rel}"
      download_object "$bucket" "$rel" "$dest"
    done
    if [[ "$count" -lt 100 ]]; then
      break
    fi
    offset=$((offset + 100))
  done
}

OBJECT_COUNT=0
if [[ "${BACKUP_SKIP_STORAGE_API:-0}" == "1" ]]; then
  log "BACKUP_SKIP_STORAGE_API=1 — packaging fixture tree at ${TREE}"
  [[ -d "$TREE" ]] || die "fixture tree missing: ${TREE}"
else
  require_cmd curl python3
  require_env SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY
  log "discovering storage buckets"
  buckets_json="$(list_buckets)"
  buckets=()
  mapfile -t buckets < <(printf '%s' "$buckets_json" | jq -r '.[].name // empty')
  if [[ "${#buckets[@]}" -eq 0 ]]; then
    log "no buckets found — writing empty archive"
  else
    for b in "${buckets[@]}"; do
      [[ -n "$b" ]] || continue
      log "backing up bucket: $b"
      mkdir -p "${TREE}/${b}"
      walk_bucket "$b" ""
    done
  fi
fi

OBJECT_COUNT="$(find "$TREE" -type f | wc -l | tr -d ' ')"
log "storage objects packed: ${OBJECT_COUNT}"

(
  cd "$TREE"
  tar_czf "${ST_DIR}/storage.tar.gz" .
)

age_encrypt "${ST_DIR}/storage.tar.gz" "${ST_DIR}/storage.tar.gz.age"
ST_SHA="$(write_sha256_sidecar "${ST_DIR}/storage.tar.gz.age")"
log "storage ciphertext sha256=${ST_SHA}"
rm -rf "$TREE" "${ST_DIR}/storage.tar.gz"

PREFIX_DAILY="production/storage/daily/${BACKUP_ID}"
if [[ "${BACKUP_UPLOAD:-1}" == "1" ]]; then
  log "uploading storage ciphertext to R2 ${PREFIX_DAILY}/"
  r2_cp_up "${ST_DIR}/storage.tar.gz.age" "${PREFIX_DAILY}/storage.tar.gz.age"
  r2_cp_up "${ST_DIR}/storage.tar.gz.age.sha256" "${PREFIX_DAILY}/storage.tar.gz.age.sha256"
else
  log "BACKUP_UPLOAD=0 — skipping R2 upload"
fi

MANIFEST_DIR="${WORK}/manifest"
mkdir -p "$MANIFEST_DIR"
cat >"${MANIFEST_DIR}/storage.json" <<EOF
{
  "backup_id": $(printf '%s' "$BACKUP_ID" | jq -Rs .),
  "object_key": $(printf '%s' "${PREFIX_DAILY}/storage.tar.gz.age" | jq -Rs .),
  "sha256": $(printf '%s' "$ST_SHA" | jq -Rs .),
  "bytes": $(wc -c <"${ST_DIR}/storage.tar.gz.age" | tr -d ' '),
  "object_count": ${OBJECT_COUNT}
}
EOF

log "storage backup artifacts ready (plaintext tree removed)"
