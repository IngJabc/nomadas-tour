#!/usr/bin/env bash
# Write the final manifest (only after DB + Storage succeeded) and copy GFS generations.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

BACKUP_LOG_PREFIX="backup-finalize"
require_cmd jq
require_env BACKUP_WORK_DIR BACKUP_ID

DBJ="${BACKUP_WORK_DIR}/manifest/database.json"
STJ="${BACKUP_WORK_DIR}/manifest/storage.json"
[[ -f "$DBJ" && -f "$STJ" ]] || die "partial backup — refusing to write success manifest"

STATUS="success"
CREATED="$(utc_now)"
GIT_SHA="${GITHUB_SHA:-$(git -C "${BACKUP_REPO_ROOT:-.}" rev-parse HEAD 2>/dev/null || echo unknown)}"
RUN_URL="${GITHUB_SERVER_URL:-}/$(echo "${GITHUB_REPOSITORY:-}")/actions/runs/${GITHUB_RUN_ID:-}"

OUT="${BACKUP_WORK_DIR}/manifest/manifest.json"
jq -n \
  --slurpfile db "$DBJ" \
  --slurpfile st "$STJ" \
  --arg backup_id "$BACKUP_ID" \
  --arg created_at "$CREATED" \
  --arg status "$STATUS" \
  --arg git_sha "$GIT_SHA" \
  --arg workflow_run "${GITHUB_RUN_ID:-local}" \
  --arg workflow_url "$RUN_URL" \
  --arg schedule_note "cron 03:00 UTC = 23:00 America/Caracas of the previous calendar day (GitHub cron is not exact to the minute)" \
  --arg rpo "24h" \
  --arg rto_target "8h" \
  --arg rto_estimate "90min (operational estimate, not an SLA)" \
  '{
    backup_id: $backup_id,
    created_at: $created_at,
    status: $status,
    rpo: $rpo,
    rto_target: $rto_target,
    rto_expected_estimate: $rto_estimate,
    schedule_note: $schedule_note,
    git_sha: $git_sha,
    workflow_run: $workflow_run,
    workflow_url: $workflow_url,
    database: $db[0],
    storage: $st[0],
    auth_included: false,
    limitations: [
      "Logical dump does not include auth.users or GoTrue state. Auth must be reconfigured on restore.",
      "storage schema is excluded from supabase db dump; object bytes are in the storage archive.",
      "RPO 24h means up to 24 hours of data may be missing after a disaster. This is not zero-loss."
    ]
  }' >"$OUT"

assert_nonempty_file "$OUT" "manifest.json"
# Guard: never put env-looking secrets into the manifest.
if grep -Eiq 'postgres://|AGE-SECRET-KEY|SERVICE_ROLE|SECRET_ACCESS_KEY|eyJ' "$OUT"; then
  die "manifest appears to contain a secret — aborting upload"
fi

MF_DAILY="production/manifests/daily/${BACKUP_ID}/manifest.json"
if [[ "${BACKUP_UPLOAD:-1}" == "1" ]]; then
  log "uploading manifest"
  r2_cp_up "$OUT" "$MF_DAILY"

  DOW="$(date -u +%u)"
  DOM="$(date -u +%d)"
  copy_set() {
    local gen="$1"
    r2_cp_copy "production/database/daily/${BACKUP_ID}/database.tar.gz.age" \
      "production/database/${gen}/${BACKUP_ID}/database.tar.gz.age"
    r2_cp_copy "production/database/daily/${BACKUP_ID}/database.tar.gz.age.sha256" \
      "production/database/${gen}/${BACKUP_ID}/database.tar.gz.age.sha256"
    r2_cp_copy "production/storage/daily/${BACKUP_ID}/storage.tar.gz.age" \
      "production/storage/${gen}/${BACKUP_ID}/storage.tar.gz.age"
    r2_cp_copy "production/storage/daily/${BACKUP_ID}/storage.tar.gz.age.sha256" \
      "production/storage/${gen}/${BACKUP_ID}/storage.tar.gz.age.sha256"
    r2_cp_copy "$MF_DAILY" "production/manifests/${gen}/${BACKUP_ID}/manifest.json"
  }
  if [[ "$DOW" == "7" ]]; then
    log "Sunday UTC — copying snapshot to weekly/"
    copy_set weekly
  fi
  if [[ "$DOM" == "01" ]]; then
    log "1st of month UTC — copying snapshot to monthly/"
    copy_set monthly
  fi
else
  log "BACKUP_UPLOAD=0 — manifest written locally only"
fi

log "finalize complete"
