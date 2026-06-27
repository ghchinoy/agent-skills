#!/usr/bin/env sh
# bd / Dolt troubleshooter — diagnostic.
#
# Primary signals (deterministic):
#   - Are local-only files (.beads/backup, dolt-server.*) tracked in git?
#   - Do Dolt and .beads/issues.jsonl agree?
#   - Does a write actually PERSIST? (definitive functional probe)
#
# Secondary signal (informational only): recent backup errors in the log.
#
# By default the functional probe is SKIPPED (read-only mode). Pass --probe to
# run it; it creates and then deletes a temporary throwaway issue.
#
# Usage:
#   scripts/diagnose.sh [--probe] [path-to-repo-root]

set -eu

PROBE=0
REPO="."
for arg in "$@"; do
  case "$arg" in
    --probe) PROBE=1 ;;
    *) REPO="$arg" ;;
  esac
done
cd "$REPO"

red()   { printf '\033[1;31m%s\033[0m\n' "$1"; }
green() { printf '\033[1;32m%s\033[0m\n' "$1"; }
yellow(){ printf '\033[1;33m%s\033[0m\n' "$1"; }
info()  { printf '\033[1;34m==>\033[0m %s\n' "$1"; }

if [ ! -d .beads ]; then
  red "No .beads/ directory here. Run from a bd-managed repo root, or pass the path."
  exit 1
fi
command -v bd >/dev/null 2>&1 || { red "bd not found in PATH."; exit 1; }

ISSUES=0

info "1. Dolt server status"
bd dolt status 2>&1 | sed 's/^/    /' || yellow "    bd dolt status failed"

info "2. PRIMARY: local-only files tracked in git (deterministic)"
TRACKED_BAD=""
for f in $(git ls-files .beads/ 2>/dev/null); do
  case "$f" in
    .beads/backup/*|.beads/dolt-server.pid|.beads/dolt-server.port|.beads/dolt-server.lock)
      TRACKED_BAD="$TRACKED_BAD $f" ;;
  esac
done
if [ -n "$TRACKED_BAD" ]; then
  red "    These local files are committed to git (corruption will spread to clones):"
  for f in $TRACKED_BAD; do echo "      $f"; done
  ISSUES=$((ISSUES+1))
else
  green "    No backup/runtime files tracked. Good."
fi

info "3. PRIMARY: Dolt vs JSONL agreement (the real symptom)"
if command -v python3 >/dev/null 2>&1 && [ -f .beads/issues.jsonl ]; then
  SAMPLE=$(python3 -c "
import json
ids=[json.loads(l)['id'] for l in open('.beads/issues.jsonl') if l.strip()]
print(' '.join(ids[:5]))
" 2>/dev/null || true)
  MISMATCH=0
  for id in $SAMPLE; do
    DOLT=$(bd show "$id" --json 2>/dev/null | python3 -c "import json,sys;d=json.load(sys.stdin);i=d[0] if isinstance(d,list) else d;print(i['status'])" 2>/dev/null || echo "?")
    JSONL=$(python3 -c "
import json
for l in open('.beads/issues.jsonl'):
    if l.strip():
        i=json.loads(l)
        if i['id']=='$id': print(i['status'])
" 2>/dev/null || echo "?")
    if [ "$DOLT" = "$JSONL" ]; then
      green "    $id: dolt=$DOLT jsonl=$JSONL OK"
    else
      red "    $id: dolt=$DOLT jsonl=$JSONL MISMATCH"
      MISMATCH=1
    fi
  done
  [ "$MISMATCH" -eq 1 ] && ISSUES=$((ISSUES+1))
else
  yellow "    Skipped (need python3 and .beads/issues.jsonl)."
fi

info "4. PRIMARY: write-persistence probe (definitive)"
if [ "$PROBE" -eq 1 ]; then
  LOG_BEFORE=$( [ -f .beads/dolt-server.log ] && wc -c < .beads/dolt-server.log || echo 0 )
  OUT=$(bd create "TEMP diagnose probe" --type task --priority 4 2>/dev/null || true)
  PID=$(echo "$OUT" | grep -o 'bd-[a-z0-9]*\|[a-z0-9]*-[a-z0-9]*' | head -1)
  # Fallback: parse prefixed id from JSON
  if [ -z "$PID" ]; then
    PID=$(echo "$OUT" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('id',''))" 2>/dev/null || true)
  fi
  sleep 1
  bd export -o .beads/issues.jsonl >/dev/null 2>&1 || true
  if [ -n "$PID" ] && grep -q "$PID" .beads/issues.jsonl 2>/dev/null; then
    green "    Write persisted to JSONL ($PID). Persistence is healthy."
  else
    red "    Write did NOT persist to JSONL. Active write-rollback corruption."
    ISSUES=$((ISSUES+1))
  fi
  LOG_AFTER=$( [ -f .beads/dolt-server.log ] && wc -c < .beads/dolt-server.log || echo 0 )
  NEWERR=$(tail -c +$((LOG_BEFORE+1)) .beads/dolt-server.log 2>/dev/null | grep -c "table file not found\|auto-backup failed" || true)
  if [ "${NEWERR:-0}" -gt 0 ]; then
    red "    $NEWERR new backup error(s) emitted during the write — backup target is broken."
    ISSUES=$((ISSUES+1))
  fi
  [ -n "$PID" ] && bd delete "$PID" --force >/dev/null 2>&1 || true
  bd export -o .beads/issues.jsonl >/dev/null 2>&1 || true
else
  yellow "    Skipped (read-only mode). Re-run with --probe for the definitive test."
fi

info "5. INFORMATIONAL: recent backup errors in log (heuristic)"
if [ -f .beads/dolt-server.log ]; then
  TOTAL=$(grep -c "table file not found\|auto-backup failed\|sync backup" .beads/dolt-server.log 2>/dev/null || true)
  if [ "${TOTAL:-0}" -gt 0 ]; then
    yellow "    $TOTAL historical backup-error line(s) in the log."
    yellow "    NOTE: historical lines persist after a fix; trust checks 2-4 above, not this count."
  else
    green "    No backup errors in log."
  fi
fi

echo
if [ "$ISSUES" -eq 0 ]; then
  green "No problems detected by primary checks."
  [ "$PROBE" -eq 0 ] && yellow "(Run with --probe for the definitive write-persistence test.)"
else
  red "Detected $ISSUES problem area(s). Run scripts/repair-corrupt-backup.sh to fix."
fi
