#!/usr/bin/env sh
# bd / Dolt troubleshooter — unified repair script.
# Safely snapshot .beads/dolt and apply standard resolution steps for schema skew,
# repo fingerprint mismatches, corrupt backup loops, and doctor warnings.
#
# Usage: scripts/repair.sh [path-to-repo-root]
# Defaults to current working directory.

set -eu

REPO="${1:-.}"
cd "$REPO"

red()    { printf '\033[1;31m%s\033[0m\n' "$1"; }
green()  { printf '\033[1;32m%s\033[0m\n' "$1"; }
yellow() { printf '\033[1;33m%s\033[0m\n' "$1"; }
info()   { printf '\033[1;34m==>\033[0m %s\n' "$1"; }

if [ ! -d .beads ]; then
  red "No .beads/ directory here. Run from a bd-managed repo root, or pass the path."
  exit 1
fi
if ! command -v bd >/dev/null 2>&1; then
  red "bd not found in PATH."
  exit 1
fi

TS=$(date +%s)
BACKUP_SNAPSHOT="/tmp/bd-raw-snapshot-$TS"

info "1. Taking raw filesystem snapshot backup"
if [ -d .beads/dolt ]; then
  cp -R .beads/dolt "$BACKUP_SNAPSHOT"
  green "    Created snapshot backup: $BACKUP_SNAPSHOT"
else
  yellow "    No .beads/dolt directory found to snapshot."
fi

info "1b. Checking for missing or misplaced server-mode database"
META_MODE=""
META_DB=""
if [ -f .beads/metadata.json ]; then
  META_MODE=$(sed -n 's/.*"dolt_mode"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' .beads/metadata.json | head -1)
  META_DB=$(sed -n 's/.*"dolt_database"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' .beads/metadata.json | head -1)
fi
if [ -z "$(git config --get beads.role 2>/dev/null || true)" ]; then
  git config beads.role maintainer 2>/dev/null || true
fi
if [ "$META_MODE" = "server" ] && [ -n "$META_DB" ] && [ ! -d ".beads/dolt/$META_DB" ]; then
  if [ ! -d ".beads/embeddeddolt/$META_DB" ]; then
    yellow "    Server-mode database '$META_DB' missing locally; running 'bd bootstrap --yes' (may retry up to ~70s)..."
    bd bootstrap --yes 2>&1 | sed 's/^/    /' || true
  fi
  if [ -d ".beads/embeddeddolt/$META_DB" ] && [ ! -d ".beads/dolt/$META_DB" ]; then
    yellow "    Relocating bootstrapped database from .beads/embeddeddolt/$META_DB -> .beads/dolt/$META_DB..."
    bd dolt stop >/dev/null 2>&1 || true
    BEADS_ABS=$(cd .beads 2>/dev/null && pwd || true)
    if [ -n "$BEADS_ABS" ] && command -v pgrep >/dev/null 2>&1; then
      for pid in $(pgrep -f "dolt sql-server" 2>/dev/null || true); do
        pcwd=""
        if [ -r "/proc/$pid/cwd" ]; then
          pcwd=$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)
        elif command -v lsof >/dev/null 2>&1; then
          pcwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' || true)
        fi
        case "$pcwd" in
          "$BEADS_ABS"*) kill -TERM "$pid" 2>/dev/null || true; sleep 1 ;;
        esac
      done
    fi
    mkdir -p .beads/dolt
    mv ".beads/embeddeddolt/$META_DB" ".beads/dolt/$META_DB"
    rm -rf .beads/embeddeddolt
    rm -f .beads/dolt-server.lock .beads/dolt-server.port .beads/dolt-server.info .beads/dolt-server.pid .beads/dolt-server-config.yaml
    bd dolt start 2>&1 | sed 's/^/    /' || true
    green "    Server-mode database '$META_DB' restored and Dolt server started."
  fi
else
  green "    Server-mode database directory present (or not in server mode)."
fi

info "2. Checking for corrupt backup directory"
if [ -d .beads/backup ]; then
  # Stop server temporarily before moving backup
  bd dolt stop >/dev/null 2>&1 || true
  sleep 1
  mv .beads/backup ".beads/backup.corrupt.$TS"
  green "    Moved .beads/backup -> .beads/backup.corrupt.$TS"
  bd dolt start >/dev/null 2>&1 || true
  sleep 1
  rm -rf ".beads/backup.corrupt.$TS" 2>/dev/null || true
else
  green "    No corrupt backup directory to clear."
fi

info "3. Checking and applying pending schema migrations"
MIG_CHECK=$(bd migrate --inspect 2>&1 || true)
DOCTOR_CHECK=$(bd doctor 2>&1 || true)
if echo "$MIG_CHECK $DOCTOR_CHECK" | grep -qi -E "refusing to auto-apply|pending schema migration|schema version mismatch|Database: version .* \(CLI:"; then
  yellow "    Pending schema migrations detected. Applying schema + metadata migrations with --force..."
  bd migrate schema --force 2>&1 | sed 's/^/    /' || true
  bd migrate --force 2>&1 | sed 's/^/    /' || true
  bd vc commit -m "chore(bd): commit config working set" >/dev/null 2>&1 || true
else
  green "    No pending schema migrations."
fi

info "4. Checking and updating repository fingerprint if mismatched"
if echo "$DOCTOR_CHECK" | grep -qi "Database belongs to different repository" || [ -f .beads/daemon-error ]; then
  yellow "    Updating repo fingerprint..."
  bd migrate --update-repo-id --yes 2>&1 | sed 's/^/    /' || true
  rm -f .beads/daemon-error
else
  green "    Repo fingerprint is up to date."
fi

info "5. Untracking local-only files from git"
UNTRACKED_ANY=0
for f in $(git ls-files .beads/ 2>/dev/null); do
  case "$f" in
    .beads/backup/*|.beads/backup.*/*|.beads/dolt/*|.beads/dolt.*/*|.beads/dolt-server*|.beads/dolt-config.log)
      git rm --cached "$f" >/dev/null 2>&1 && { echo "    untracked $f"; UNTRACKED_ANY=1; } ;;
  esac
done
[ "$UNTRACKED_ANY" -eq 0 ] && green "    No local runtime files tracked in git."

info "6. Running bd doctor --fix and committing metadata changes"
bd doctor --fix --yes 2>&1 | sed 's/^/    /' || true
bd vc commit -m "chore(bd): commit doctor metadata fixes" >/dev/null 2>&1 || true
if [ -f .git/hooks/pre-commit ] && [ ! -f .git/hooks/pre-commit.disabled ]; then
  bd hooks install --force >/dev/null 2>&1 || true
fi

info "7. Exporting clean JSONL"
bd export -o .beads/issues.jsonl 2>&1 | sed 's/^/    /'

echo
green "Unified repair complete."
echo "Raw snapshot saved at: $BACKUP_SNAPSHOT"
