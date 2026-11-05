#!/usr/bin/env bash
# audit-go-readability.sh — Runs the 12 mechanical Go Readability self-audit
# checks recursively across a Go repository, package directory, or single .go file.
#
# Usage:
#   ./scripts/audit-go-readability.sh [target_path] [--strict] [--json]

set -euo pipefail

TARGET_PATH="."
STRICT=0
JSON_OUT=0

for arg in "$@"; do
  case "$arg" in
    --strict)
      STRICT=1
      ;;
    --json)
      JSON_OUT=1
      ;;
    *)
      TARGET_PATH="$arg"
      ;;
  esac
done

if [[ ! -e "$TARGET_PATH" ]]; then
  echo "Error: path '$TARGET_PATH' does not exist." >&2
  exit 1
fi

TOTAL_FINDINGS=0
JSON_ITEMS=""

if [[ -f "$TARGET_PATH" ]]; then
  SEARCH_DIR="$(cd "$(dirname "$TARGET_PATH")" && pwd)"
  SINGLE_FILE="$(basename "$TARGET_PATH")"
else
  SEARCH_DIR="$(cd "$TARGET_PATH" && pwd)"
  SINGLE_FILE=""
fi

cd "$SEARCH_DIR"

if [[ "$JSON_OUT" -eq 0 ]]; then
  echo "# Go Readability Self-Audit Report"
  if [[ -n "$SINGLE_FILE" ]]; then
    echo "- **Target**: \`$SEARCH_DIR/$SINGLE_FILE\`"
  else
    echo "- **Target**: \`$SEARCH_DIR\`"
  fi
  echo ""
fi

run_check() {
  local num="$1"
  local title="$2"
  local include_glob="$3"
  local pattern="$4"
  local exclude_pattern="${5:-}"

  local matches=""
  if [[ -n "$SINGLE_FILE" ]]; then
    if [[ "$include_glob" == "*_test.go" && "$SINGLE_FILE" != *_test.go ]]; then
      matches=""
    elif [[ -n "$exclude_pattern" ]]; then
      matches="$(grep -nHE "$pattern" "$SINGLE_FILE" 2>/dev/null | grep -vE "$exclude_pattern" || true)"
    else
      matches="$(grep -nHE "$pattern" "$SINGLE_FILE" 2>/dev/null || true)"
    fi
  else
    if [[ -n "$exclude_pattern" ]]; then
      matches="$(grep -rnE --include="$include_glob" --exclude-dir={.git,vendor,node_modules,dist,.serena,.beads,.dolt,fixtures,testdata} "$pattern" . 2>/dev/null | grep -vE "$exclude_pattern" || true)"
    else
      matches="$(grep -rnE --include="$include_glob" --exclude-dir={.git,vendor,node_modules,dist,.serena,.beads,.dolt,fixtures,testdata} "$pattern" . 2>/dev/null || true)"
    fi
  fi

  local count=0
  if [[ -n "$matches" ]]; then
    count="$(printf '%s\n' "$matches" | wc -l | tr -d ' ')"
  fi
  TOTAL_FINDINGS=$((TOTAL_FINDINGS + count))

  if [[ "$JSON_OUT" -eq 1 ]]; then
    local item
    item="$(printf '{"id":%s,"title":"%s","count":%s}' "$num" "$title" "$count")"
    if [[ -n "$JSON_ITEMS" ]]; then
      JSON_ITEMS="$JSON_ITEMS,$item"
    else
      JSON_ITEMS="$item"
    fi
  else
    printf "## %s. %s (%s match(es))\n" "$num" "$title" "$count"
    if [[ "$count" -gt 0 ]]; then
      printf '```text\n%s\n```\n\n' "$matches"
    else
      printf "_Clean (0 matches)_\n\n"
    fi
  fi
}

run_check "1"  "Manually-quoted format verbs (prefer %q)" "*.go" "('%[svqd]'|\\\\\"%[svqd]\\\\\")"
run_check "2"  "Capitalized error strings (inspect proper nouns/identifiers)" "*.go" '(fmt\.Errorf|errors\.New)\("[A-Z]'
run_check "3"  "Error strings ending in punctuation" "*.go" 'fmt\.Errorf\(".*[.!?]"'
run_check "4"  "Test failures missing function-under-test name" "*_test.go" 't\.(Error|Fatal)f?\("(got|expected) '
run_check "5"  "Test failures with empty parens (missing inputs)" "*_test.go" 't\.(Error|Fatal)f?\("[A-Za-z_]+\(\)'
run_check "6"  "Get-prefixed functions or methods (decisions#getters)" "*.go" 'func (\([^)]+\) )?Get[A-Z]'
run_check "7"  "Receiver names longer than 2 letters" "*.go" 'func \([a-zA-Z]{3,} \*?[A-Z]'
run_check "8"  "Indented else blocks (decisions#indent-error-flow)" "*.go" '\} else \{$'
run_check "9"  "Legacy interface{} (prefer any)" "*.go" '\binterface\{\}'
run_check "10" "Detached context.Background() outside main/init/tests" "*.go" 'context\.Background\(\)' '(_test\.go|main\.go|init\.go)'
run_check "11" "Non-nil empty slice literal := []T{} (prefer var s []T)" "*.go" ':= \[\][a-zA-Z*]+\{\}'
run_check "12" "Overly permissive file modes (0666 or 0777)" "*.go" '\b0(666|777)\b'

if [[ "$JSON_OUT" -eq 1 ]]; then
  PASSED="true"
  if [[ "$TOTAL_FINDINGS" -gt 0 ]]; then
    PASSED="false"
  fi
  printf '{"passed":%s,"total_findings":%d,"checks":[%s]}\n' "$PASSED" "$TOTAL_FINDINGS" "$JSON_ITEMS"
fi

if [[ "$STRICT" -eq 1 && "$TOTAL_FINDINGS" -gt 0 ]]; then
  exit 1
fi
exit 0
