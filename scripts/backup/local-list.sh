#!/usr/bin/env bash
# List local contingency backups under <LOCAL_DIR>.
# Usage: bash scripts/backup/local-list.sh <LOCAL_DIR>
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

BACKUP_LOG_PREFIX="backup-local-list"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/backup/local-list.sh <LOCAL_DIR>
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

LOCAL_DIR="${1:-}"
[[ -n "$LOCAL_DIR" ]] || { usage; die "missing LOCAL_DIR"; }
[[ -d "$LOCAL_DIR" ]] || die "LOCAL_DIR does not exist"

list_gen() {
  local gen="$1"
  local root="${LOCAL_DIR%/}/${gen}"
  local ids=() id dir status
  if [[ ! -d "$root" ]]; then
    return 0
  fi
  while IFS= read -r id; do
    [[ -n "$id" ]] || continue
    ids+=("$id")
  done < <(find "$root" -mindepth 1 -maxdepth 1 -type d | sed 's|.*/||' | sort)
  if [[ "${#ids[@]}" -eq 0 ]]; then
    return 0
  fi
  printf '%s\n' "${gen^^}"
  for id in "${ids[@]}"; do
    dir="${root}/${id}"
    status="incomplete"
    if local_backup_checksums_ok "$dir"; then
      status="verified-checksums"
    fi
    printf '  %s  [%s]\n' "$id" "$status"
    TOTAL=$((TOTAL + 1))
  done
  printf '\n'
}

TOTAL=0
printf 'Available local backups:\n\n'
list_gen daily
list_gen weekly
list_gen monthly
printf 'Total: %s\n' "$TOTAL"
