#!/usr/bin/env bash
# Manual GFS retention for local contingency copies. Default dry-run.
# Usage: bash scripts/backup/local-retention.sh <LOCAL_DIR> [--dry-run|--apply]
#          [--keep-daily N] [--keep-weekly N] [--keep-monthly N]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

BACKUP_LOG_PREFIX="backup-local-retention"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/backup/local-retention.sh <LOCAL_DIR> [options]

Options:
  --dry-run          list deletes only (default)
  --apply            actually delete
  --keep-daily N     default 7
  --keep-weekly N    default 2
  --keep-monthly N   default 1

Manual only. No cron. Does not touch R2 or GitHub Actions.
EOF
}

DRY_RUN=1
KEEP_DAILY=7
KEEP_WEEKLY=2
KEEP_MONTHLY=1
LOCAL_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --apply) DRY_RUN=0; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --keep-daily) KEEP_DAILY="$2"; shift 2 ;;
    --keep-weekly) KEEP_WEEKLY="$2"; shift 2 ;;
    --keep-monthly) KEEP_MONTHLY="$2"; shift 2 ;;
    *)
      if [[ -z "$LOCAL_DIR" && "$1" != -* ]]; then
        LOCAL_DIR="$1"
        shift
      else
        die "unknown argument: $1"
      fi
      ;;
  esac
done

[[ -n "$LOCAL_DIR" ]] || { usage; die "missing LOCAL_DIR"; }
[[ -d "$LOCAL_DIR" ]] || die "LOCAL_DIR does not exist"

list_ids() {
  local root="$1"
  if [[ ! -d "$root" ]]; then
    return 0
  fi
  find "$root" -mindepth 1 -maxdepth 1 -type d | sed 's|.*/||' | sort
}

prune_gen() {
  local kind="$1"
  local keep="$2"
  local root="${LOCAL_DIR%/}/${kind}"
  local ids=()
  mapfile -t ids < <(list_ids "$root" | sort -r)
  local total="${#ids[@]}"
  log "${kind}: ${total} backup_id(s) under ${root} (keep ${keep})"
  if [[ "$total" -le "$keep" ]]; then
    return 0
  fi
  local i id
  for i in $(seq "$keep" $((total - 1))); do
    id="${ids[$i]}"
    [[ -n "$id" ]] || continue
    if [[ "$DRY_RUN" -eq 1 ]]; then
      log "DRY-RUN would delete ${root}/${id}/"
      continue
    fi
    log "deleting ${root}/${id}/"
    rm -rf "${root}/${id}"
  done
}

prune_gen daily "$KEEP_DAILY"
prune_gen weekly "$KEEP_WEEKLY"
prune_gen monthly "$KEEP_MONTHLY"

if [[ "$DRY_RUN" -eq 1 ]]; then
  log "local retention dry-run complete (no deletes)"
else
  log "local retention apply complete"
fi
