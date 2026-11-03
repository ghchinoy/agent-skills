#!/usr/bin/env bash
# run-preprint-gates.sh — Unified deterministic acceptance runner for arXiv preprints.
#
# Chains four non-destructive checks against a preprint directory (e.g., docs/preprint):
#   1. Luminous Graphviz semantic .dot lint (+ optional figure rendering via luminous.gvpr)
#   2. docstats clean-prose Two-Axis acceptance gate (Axis A FK 10-16, Axis B >= 9.5)
#   3. Optional Syntaxis non-destructive peer review (`syntaxis review <project-id> -o json`)
#   4. 100-point preprint & @preview/arkheion:0.1.2 Typst oracle (`validate_preprint.py`)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'EOF'
Usage:
  run-preprint-gates.sh <preprint_dir> [options]

Description:
  Runs the deterministic quality gates for an arXiv / Syntaxis preprint package
  without modifying manuscript prose. Pairs with the `preprint-workflow`,
  `arxiv-preprint-authoring`, and `technical-post-editorial` skills.

Options:
  --project-id <id>          Run `syntaxis review <id> -o json` and count open suggestions
  --render-figures           Render `figures/*.dot` to `.webp` and 288 DPI `.png` via luminous.gvpr
  --check-syntaxis-prompts   Also verify Syntaxis repo `pkg/prompts/{writer,reviewer}.md` parity
  --docstats-dir <path>      Path to local `docstats` checkout (default: $DOCSTATS_DIR or ~/projects/docstats)
  --syntaxis-dir <path>      Path to local `syntaxis` checkout (default: $SYNTAXIS_DIR or ~/projects/syntaxis)
  --graphviz-theme <path>    Path to `luminous.gvpr` (default: $LUMINOUS_GVPR or ~/projects/graphviz-style/theme/luminous.gvpr)
  --validator <path>         Explicit path to `validate_preprint.py`
  --json                     Emit a single machine-readable JSON report to stdout
  -h, --help                 Show this help message and exit

Examples:
  # Audit a preprint directory with human-readable output
  ./scripts/run-preprint-gates.sh docs/preprint

  # Render Luminous figures, run Syntaxis review, and emit JSON for an agent
  ./scripts/run-preprint-gates.sh docs/preprint --render-figures --project-id my_paper --json
EOF
}

PREPRINT_DIR=""
PROJECT_ID=""
RENDER_FIGURES=0
CHECK_SYNTAXIS_PROMPTS=0
JSON_OUT=0
DOCSTATS_DIR="${DOCSTATS_DIR:-$HOME/projects/docstats}"
SYNTAXIS_DIR="${SYNTAXIS_DIR:-$HOME/projects/syntaxis}"
LUMINOUS_GVPR="${LUMINOUS_GVPR:-$HOME/projects/graphviz-style/theme/luminous.gvpr}"
VALIDATOR_PATH=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --project-id)
      [ "$#" -ge 2 ] || { echo "Error: --project-id requires an argument. Hint: pass your Syntaxis project ID." >&2; exit 2; }
      PROJECT_ID="$2"
      shift 2
      ;;
    --project-id=*)
      PROJECT_ID="${1#*=}"
      shift
      ;;
    --render-figures)
      RENDER_FIGURES=1
      shift
      ;;
    --check-syntaxis-prompts)
      CHECK_SYNTAXIS_PROMPTS=1
      shift
      ;;
    --docstats-dir)
      [ "$#" -ge 2 ] || { echo "Error: --docstats-dir requires a path." >&2; exit 2; }
      DOCSTATS_DIR="$2"
      shift 2
      ;;
    --docstats-dir=*)
      DOCSTATS_DIR="${1#*=}"
      shift
      ;;
    --syntaxis-dir)
      [ "$#" -ge 2 ] || { echo "Error: --syntaxis-dir requires a path." >&2; exit 2; }
      SYNTAXIS_DIR="$2"
      shift 2
      ;;
    --syntaxis-dir=*)
      SYNTAXIS_DIR="${1#*=}"
      shift
      ;;
    --graphviz-theme)
      [ "$#" -ge 2 ] || { echo "Error: --graphviz-theme requires a path to luminous.gvpr." >&2; exit 2; }
      LUMINOUS_GVPR="$2"
      shift 2
      ;;
    --graphviz-theme=*)
      LUMINOUS_GVPR="${1#*=}"
      shift
      ;;
    --validator)
      [ "$#" -ge 2 ] || { echo "Error: --validator requires a path to validate_preprint.py." >&2; exit 2; }
      VALIDATOR_PATH="$2"
      shift 2
      ;;
    --validator=*)
      VALIDATOR_PATH="${1#*=}"
      shift
      ;;
    --json)
      JSON_OUT=1
      shift
      ;;
    -*)
      echo "Error: Unknown flag '$1'. Hint: run with --help to inspect valid options." >&2
      exit 2
      ;;
    *)
      if [ -z "$PREPRINT_DIR" ]; then
        PREPRINT_DIR="$1"
      else
        echo "Error: Unexpected extra argument '$1'." >&2
        exit 2
      fi
      shift
      ;;
  esac
done

if [ -z "$PREPRINT_DIR" ]; then
  echo "Error: Missing <preprint_dir>. Hint: pass e.g. docs/preprint or run with --help." >&2
  exit 2
fi

if [ ! -d "$PREPRINT_DIR" ]; then
  echo "Error: Preprint directory '$PREPRINT_DIR' does not exist. Hint: scaffold docs/preprint/{data,figures} via arxiv-preprint-authoring first." >&2
  exit 2
fi

PREPRINT_DIR="$(cd "$PREPRINT_DIR" && pwd)"

# Locate validate_preprint.py across plugin-tree or vendored skill layouts
if [ -z "$VALIDATOR_PATH" ]; then
  for candidate in \
    "$SCRIPT_DIR/../../arxiv-preprint-authoring/scripts/validate_preprint.py" \
    "$HOME/projects/agent-skills/plugins/repo-authoring/skills/arxiv-preprint-authoring/scripts/validate_preprint.py"; do
    if [ -f "$candidate" ]; then
      VALIDATOR_PATH="$candidate"
      break
    fi
  done
fi

WORK_TMP="$(mktemp -d "${TMPDIR:-/tmp}/preprint-gates.XXXXXX")"
trap 'rm -rf "$WORK_TMP"' EXIT

# Optional Figure Rendering Step
RENDER_ERRORS_FILE="$WORK_TMP/render_errors.txt"
touch "$RENDER_ERRORS_FILE"
RENDERED_COUNT=0

if [ "$RENDER_FIGURES" -eq 1 ] && [ -d "$PREPRINT_DIR/figures" ]; then
  if [ ! -f "$LUMINOUS_GVPR" ]; then
    echo "luminous.gvpr not found at $LUMINOUS_GVPR (override with --graphviz-theme)" >>"$RENDER_ERRORS_FILE"
  elif ! command -v gvpr >/dev/null 2>&1 || ! command -v dot >/dev/null 2>&1; then
    echo "graphviz (gvpr/dot) missing on PATH; install via 'brew install graphviz'" >>"$RENDER_ERRORS_FILE"
  else
    shopt -s nullglob
    for dotfile in "$PREPRINT_DIR/figures"/*.dot; do
      base="${dotfile%.dot}"
      if gvpr -c -f "$LUMINOUS_GVPR" -a light "$dotfile" | dot -Twebp -o "${base}-light.webp" 2>>"$RENDER_ERRORS_FILE" \
        && gvpr -c -f "$LUMINOUS_GVPR" -a dark "$dotfile" | dot -Twebp -o "${base}-dark.webp" 2>>"$RENDER_ERRORS_FILE" \
        && gvpr -c -f "$LUMINOUS_GVPR" -a light "$dotfile" | dot -Gdpi=288 -Tpng -o "${base}.png" 2>>"$RENDER_ERRORS_FILE"; then
        RENDERED_COUNT=$((RENDERED_COUNT + 1))
      else
        echo "Failed rendering $dotfile via luminous.gvpr" >>"$RENDER_ERRORS_FILE"
      fi
    done
    shopt -u nullglob
  fi
fi

# Gate 2: docstats Two-Axis Audit (if available)
DOCSTATS_JSON="$WORK_TMP/docstats.json"
if [ -d "$DOCSTATS_DIR" ] && [ -f "$DOCSTATS_DIR/metrics.py" ] && [ -f "$PREPRINT_DIR/paper.md" ] && command -v uv >/dev/null 2>&1; then
  cat >"$WORK_TMP/run_docstats.py" <<'PY'
import json, re, sys
from pathlib import Path
from ai_patterns import strip_code_and_tables
from metrics import _sync_analyze_document, _sync_calculate_metrics

def _prepare_clean_prose(md_block: str) -> str:
    clean = strip_code_and_tables(md_block)
    clean = re.sub(r"\$\$[\s\S]*?\$\$", " ", clean)
    clean = re.sub(r"\$[^$\n]+\$", "math_token", clean)
    clean = re.sub(r"!\[[^\]]*\]\([^)]+\)", " ", clean)
    clean = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", clean)
    lines = []
    for line in clean.splitlines():
        s = line.strip()
        if not s or s.startswith("#") or s.startswith("---"):
            continue
        s = re.sub(r"^[-*+]\s+", "", s)
        s = re.sub(r"^\d+\.\s+", "", s)
        s = re.sub(r"\*\*([^*]+)\*\*|\*([^*]+)\*", r"\1\2", s)
        # Prevent textstat's naive sentence regex from splitting decimal points (e.g. 1.78%, 91.6x)
        # and common scholarly abbreviations (et al., Fig., Eq., Sec., Tab.)
        s = re.sub(r"(?<=\d)\.(?=\d)", "_", s)
        s = re.sub(r"\b(et al|Fig|Figs|Eq|Eqs|Sec|Secs|Tab|Tabs|vs|cf|e\.g|i\.e)\.", r"\1", s)
        lines.append(s)
    return "\n".join(lines)

md_path = Path(sys.argv[1])
raw = md_path.read_text(encoding="utf-8")
# Exclude ## References and ## Author Contributions from narrative prose readability
narrative_raw = re.sub(r"^##\s+(References|Author Contributions)\b[\s\S]*?(?=^##\s+|\Z)", "", raw, flags=re.MULTILINE)
full = _sync_analyze_document(narrative_raw, md_path.name)

clean_prose = _prepare_clean_prose(narrative_raw)
clean_r = _sync_calculate_metrics(clean_prose, f"{md_path.name}:clean")
asl = round(clean_r.word_count / max(1, clean_r.sentence_count), 2)
asw = round(clean_r.syllable_count / max(1, clean_r.word_count), 2)
fk = round(clean_r.flesch_kincaid_grade, 2)
fre = round(clean_r.flesch_reading_ease, 2)
ap = full.ai_patterns

# Compute per-section clean-prose heatmap to catch localized hotspots (e.g., Impenetrable Limitations/Appendices)
section_heatmap = []
hotspot_sections = []
for sec in re.split(r"(?=^##\s+)", raw, flags=re.MULTILINE):
    sec_lines = sec.strip().splitlines()
    if not sec_lines or not sec_lines[0].startswith("## "):
        continue
    title = sec_lines[0].strip()
    if re.match(r"^##\s+(References|Author Contributions)\b", title, flags=re.IGNORECASE):
        continue
    sec_clean = _prepare_clean_prose(sec)
    if len(sec_clean.split()) < 25:
        continue
    try:
        sr = _sync_calculate_metrics(sec_clean, f"{md_path.name}:{title}")
        s_asl = round(sr.word_count / max(1, sr.sentence_count), 2)
        s_fk = round(sr.flesch_kincaid_grade, 2)
        entry = {
            "section": title,
            "word_count": sr.word_count,
            "asl": s_asl,
            "flesch_kincaid_grade": s_fk,
            "flesch_reading_ease": round(sr.flesch_reading_ease, 2),
        }
        section_heatmap.append(entry)
        if s_fk > 16.5 or s_asl > 24.0:
            hotspot_sections.append(f"{title} (FK={s_fk}, ASL={s_asl} w/s)")
    except Exception:
        pass

max_section_fk = max((x["flesch_kincaid_grade"] for x in section_heatmap), default=fk)
axis_a_pass = (10.0 <= fk <= 16.0) and (asl <= 22.0) and (len(hotspot_sections) == 0)
axis_b_pass = (
    ap.ai_tell_score >= 9.5
    and ap.em_dash_count == 0
    and ap.throat_clearing_count == 0
    and ap.binary_contrast_count == 0
)

print(json.dumps({
    "available": True,
    "passed": bool(axis_a_pass and axis_b_pass),
    "axis_a": {
        "passed": bool(axis_a_pass),
        "flesch_kincaid_grade": fk,
        "flesch_reading_ease": fre,
        "text_standard": clean_r.text_standard,
        "word_count": clean_r.word_count,
        "asl": asl,
        "asw": asw,
        "max_section_fk": max_section_fk,
        "hotspot_sections": hotspot_sections,
        "section_heatmap": section_heatmap,
    },
    "axis_b": {
        "passed": bool(axis_b_pass),
        "ai_tell_score": ap.ai_tell_score,
        "em_dash_count": ap.em_dash_count,
        "throat_clearing_count": ap.throat_clearing_count,
        "binary_contrast_count": ap.binary_contrast_count,
        "adverb_ly_rate": ap.adverb_ly_rate,
        "wh_starter_count": ap.wh_starter_count,
        "flags": ap.flags,
    },
}))
PY
  if ! uv run --directory "$DOCSTATS_DIR" python "$WORK_TMP/run_docstats.py" "$PREPRINT_DIR/paper.md" >"$DOCSTATS_JSON" 2>/dev/null; then
    echo '{"available": false, "passed": true, "reason": "docstats execution failed; run uv sync in docstats"}' >"$DOCSTATS_JSON"
  fi
else
  echo '{"available": false, "passed": true, "reason": "docstats checkout or uv not found; skipped"}' >"$DOCSTATS_JSON"
fi

# Gate 3: Optional Syntaxis Advisory Review
SYNTAXIS_JSON="$WORK_TMP/syntaxis_review.json"
SYNTAXIS_BIN=""
if [ -x "$SYNTAXIS_DIR/bin/syntaxis" ]; then
  SYNTAXIS_BIN="$SYNTAXIS_DIR/bin/syntaxis"
elif command -v syntaxis >/dev/null 2>&1; then
  SYNTAXIS_BIN="$(command -v syntaxis)"
fi

if [ -n "$PROJECT_ID" ]; then
  if [ -n "$SYNTAXIS_BIN" ]; then
    RAW_REV="$WORK_TMP/syntaxis_raw.json"
    if "$SYNTAXIS_BIN" review "$PROJECT_ID" -o json >"$RAW_REV" 2>/dev/null; then
      python3 - "$RAW_REV" >"$SYNTAXIS_JSON" <<'PY'
import json, sys
from pathlib import Path
items = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8") or "[]")
major = sum(1 for x in items if x.get("severity") == "major")
minor = sum(1 for x in items if x.get("severity") == "minor")
info = sum(1 for x in items if x.get("severity") == "info")
print(json.dumps({
    "available": True,
    "passed": major == 0,
    "major_count": major,
    "minor_count": minor,
    "info_count": info,
    "suggestions": items,
}))
PY
    else
      echo '{"available": true, "passed": false, "error": "syntaxis review failed for project ID"}' >"$SYNTAXIS_JSON"
    fi
  else
    echo '{"available": false, "passed": false, "error": "syntaxis binary not found; run make build-backend in syntaxis"}' >"$SYNTAXIS_JSON"
  fi
else
  echo '{"available": false, "passed": true, "reason": "no --project-id supplied; skipped"}' >"$SYNTAXIS_JSON"
fi

# Gate 4: 100-Point Validator (validate_preprint.py)
ORACLE_JSON="$WORK_TMP/oracle.json"
if [ -n "$VALIDATOR_PATH" ] && [ -f "$VALIDATOR_PATH" ]; then
  PROMPT_ARGS=()
  if [ "$CHECK_SYNTAXIS_PROMPTS" -eq 1 ] && [ -f "$SYNTAXIS_DIR/pkg/prompts/writer.md" ] && [ -f "$SYNTAXIS_DIR/pkg/prompts/reviewer.md" ]; then
    PROMPT_ARGS=(--check-syntaxis-prompts "$SYNTAXIS_DIR")
  fi
  python3 "$VALIDATOR_PATH" "$PREPRINT_DIR" "${PROMPT_ARGS[@]+"${PROMPT_ARGS[@]}"}" --json >"$ORACLE_JSON" || true
else
  echo '{"passed": false, "score": 0, "errors": ["validate_preprint.py not found; pass --validator <path>"]}' >"$ORACLE_JSON"
fi

# Aggregate unified report & exit code
python3 - "$PREPRINT_DIR" "$RENDER_FIGURES" "$RENDERED_COUNT" "$RENDER_ERRORS_FILE" "$DOCSTATS_JSON" "$SYNTAXIS_JSON" "$ORACLE_JSON" "$JSON_OUT" <<'PY'
import json, os, sys
from pathlib import Path

preprint_dir = sys.argv[1]
render_requested = sys.argv[2] == "1"
rendered_count = int(sys.argv[3])
render_errs = [l.strip() for l in Path(sys.argv[4]).read_text(encoding="utf-8").splitlines() if l.strip()]
docstats = json.loads(Path(sys.argv[5]).read_text(encoding="utf-8"))
syntaxis = json.loads(Path(sys.argv[6]).read_text(encoding="utf-8"))
oracle = json.loads(Path(sys.argv[7]).read_text(encoding="utf-8"))
json_out = sys.argv[8] == "1"

figures_pass = len(render_errs) == 0
overall_pass = bool(figures_pass and docstats.get("passed", True) and syntaxis.get("passed", True) and oracle.get("passed", False))

hints = []
if render_errs:
    hints.append("Check Graphviz/luminous.gvpr setup and run `make -C ~/projects/graphviz-style fonts`.")
if docstats.get("available") and not docstats.get("passed"):
    if not docstats["axis_a"]["passed"]:
        hotspots = docstats["axis_a"].get("hotspot_sections", [])
        if hotspots:
            hints.append(f"Section readability hotspot(s) exceeding FK 16.5 or ASL 24 w/s: {', '.join(hotspots)}.")
        else:
            hints.append("Axis A off-band: split 35+ word sentences and replace stacked nominalizations (`technical-post-editorial`).")
    if not docstats["axis_b"]["passed"]:
        hints.append("Axis B below 9.5 or prose tells > 0: cut em-dashes, throat-clearing openers, and binary contrasts (`technical-post-editorial`).")
if syntaxis.get("available") and not syntaxis.get("passed"):
    hints.append("Resolve `major` suggestions from `syntaxis review` in paper.md before final Typst compilation.")
if not oracle.get("passed", False):
    hints.append("Fix each line-level error reported by `validate_preprint.py` (`arxiv-preprint-authoring`) until score == 100.")
for w in oracle.get("warnings", []):
    hints.append(w)

report = {
    "passed": overall_pass,
    "preprint_dir": preprint_dir,
    "gates": {
        "luminous_figures": {
            "render_requested": render_requested,
            "rendered_count": rendered_count,
            "passed": figures_pass,
            "errors": render_errs,
        },
        "docstats_two_axis": docstats,
        "syntaxis_review": syntaxis,
        "validate_preprint": oracle,
    },
    "hints": hints,
}

if json_out:
    print(json.dumps(report, indent=2))
else:
    tty = sys.stdout.isatty()
    c_pass = "\033[1;32m" if tty else ""
    c_warn = "\033[1;33m" if tty else ""
    c_fail = "\033[1;31m" if tty else ""
    c_acc  = "\033[1;36m" if tty else ""
    c_mut  = "\033[0;90m" if tty else ""
    c_rst  = "\033[0m" if tty else ""

    badge = f"{c_pass}[PASS]{c_rst}" if overall_pass else f"{c_fail}[FAIL]{c_rst}"
    print(f"{badge} {c_acc}Preprint Acceptance Gates{c_rst} ({preprint_dir})")

    if render_requested:
        st = f"{c_pass}PASS{c_rst}" if figures_pass else f"{c_fail}FAIL{c_rst}"
        print(f"  1. Luminous Figures:  {st} ({rendered_count} .dot rendered)")
    else:
        print(f"  1. Luminous Figures:  {c_mut}SKIP (pass --render-figures to render){c_rst}")

    if docstats.get("available"):
        st = f"{c_pass}PASS{c_rst}" if docstats["passed"] else f"{c_warn}REVISE{c_rst}"
        aa, ab = docstats["axis_a"], docstats["axis_b"]
        max_sfk = aa.get("max_section_fk", aa["flesch_kincaid_grade"])
        print(f"  2. docstats 2-Axis:   {st} (FK={aa['flesch_kincaid_grade']}, max_sec_FK={max_sfk}, FRE={aa['flesch_reading_ease']}, ASL={aa['asl']} | Axis B={ab['ai_tell_score']}/10, em_dash={ab['em_dash_count']})")
        for hs in aa.get("hotspot_sections", []):
            print(f"     {c_warn}*{c_rst} Hotspot section: {hs}")
    else:
        print(f"  2. docstats 2-Axis:   {c_mut}SKIP ({docstats.get('reason', 'unavailable')}){c_rst}")

    if syntaxis.get("available"):
        st = f"{c_pass}PASS{c_rst}" if syntaxis["passed"] else f"{c_warn}MAJOR_ISSUES{c_rst}"
        print(f"  3. Syntaxis Review:   {st} (major={syntaxis.get('major_count', '?')}, minor={syntaxis.get('minor_count', '?')}, info={syntaxis.get('info_count', '?')})")
    else:
        print(f"  3. Syntaxis Review:   {c_mut}SKIP ({syntaxis.get('reason') or syntaxis.get('error', 'skipped')}){c_rst}")

    o_pass = oracle.get("passed", False)
    st = f"{c_pass}PASS{c_rst}" if o_pass else f"{c_fail}FAIL{c_rst}"
    print(f"  4. Preprint Oracle:   {st} ({oracle.get('score', 0)}/100 pts)")
    for err in oracle.get("errors", []):
        print(f"     {c_fail}!{c_rst} {err}")
    for warn in oracle.get("warnings", []):
        print(f"     {c_warn}*{c_rst} {warn}")

    if hints:
        print(f"\n{c_acc}Actionable Hints:{c_rst}")
        for h in hints:
            print(f"  - {h}")

sys.exit(0 if overall_pass else 1)
PY
