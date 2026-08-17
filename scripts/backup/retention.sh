#!/usr/bin/env bash
# Grandfather-father-son retention on R2.
# Keep: 14 daily, 4 weekly, 2 monthly. Idempotent. Default dry-run.
#
# R2 lifecycle cannot express "keep last N" when days are skipped, so this script
# is the policy engine. Optional lifecycle (expire after 95 days) is a safety net
# documented in the runbook — it must not delete objects this script still needs.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

BACKUP_LOG_PREFIX="backup-retention"
DRY_RUN=1
KEEP_DAILY=14
KEEP_WEEKLY=4
KEEP_MONTHLY=2

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) DRY_RUN=0; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --keep-daily) KEEP_DAILY="$2"; shift 2 ;;
    --keep-weekly) KEEP_WEEKLY="$2"; shift 2 ;;
    --keep-monthly) KEEP_MONTHLY="$2"; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done

require_cmd aws awk sort
r2_env

# List unique backup_id directories under a prefix (last path segment before filename).
list_ids() {
  local prefix="$1"
  r2_ls "$prefix" | awk '{print $NF}' | awk -F/ '{
    for (i=1;i<=NF;i++) if ($i ~ /^[0-9]{8}T/) { print $i; break }
  }' | sort -u
}

# Do not delete a backup_id newer than 20 hours (protect in-progress / today's backup).
too_new() {
  local id="$1"
  local stamp="${id%%-*}"
  local epoch now
  epoch="$(date -u -d "${stamp:0:8} ${stamp:9:2}:${stamp:11:2}:${stamp:13:2}" +%s 2>/dev/null || true)"
  if [[ -z "$epoch" ]]; then
    return 1
  fi
  now="$(date -u +%s)"
  if [[ $((now - epoch)) -lt 72000 ]]; then
    return 0
  fi
  return 1
}

prune_prefix() {
  local kind="$1"
  local prefix="$2"
  local keep="$3"
  local ids=()
  mapfile -t ids < <(list_ids "$prefix" | sort -r)
  local total="${#ids[@]}"
  log "${kind}: ${total} backup_id(s) under ${prefix} (keep ${keep})"
  if [[ "$total" -le "$keep" ]]; then
    return 0
  fi
  local i id
  for i in $(seq "$keep" $((total - 1))); do
    id="${ids[$i]}"
    [[ -n "$id" ]] || continue
    if too_new "$id"; then
      log "skip delete ${kind}/${id} (too recent)"
      continue
    fi
    if [[ "$DRY_RUN" -eq 1 ]]; then
      log "DRY-RUN would delete ${prefix}${id}/"
      continue
    fi
    log "deleting ${prefix}${id}/"
    aws s3 rm "s3://$(r2_bucket)/${prefix}${id}/" \
      --endpoint-url "$(r2_endpoint)" \
      --recursive --only-show-errors
  done
}

prune_prefix daily "production/database/daily/" "$KEEP_DAILY"
prune_prefix daily "production/storage/daily/" "$KEEP_DAILY"
prune_prefix daily "production/manifests/daily/" "$KEEP_DAILY"
prune_prefix weekly "production/database/weekly/" "$KEEP_WEEKLY"
prune_prefix weekly "production/storage/weekly/" "$KEEP_WEEKLY"
prune_prefix weekly "production/manifests/weekly/" "$KEEP_WEEKLY"
prune_prefix monthly "production/database/monthly/" "$KEEP_MONTHLY"
prune_prefix monthly "production/storage/monthly/" "$KEEP_MONTHLY"
prune_prefix monthly "production/manifests/monthly/" "$KEEP_MONTHLY"

if [[ "$DRY_RUN" -eq 1 ]]; then
  log "retention dry-run complete (no deletes)"
else
  log "retention apply complete"
fi
