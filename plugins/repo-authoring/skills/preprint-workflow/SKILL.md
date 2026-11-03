---
name: preprint-workflow
description: Orchestrate end-to-end arXiv preprint authoring, Syntaxis non-destructive peer review, docstats two-axis clean-prose gating, technical-post-editorial surgery, Luminous Graphviz diagram rendering, and @preview/arkheion:0.1.2 Typst PDF compilation. Use when asked to run a full preprint review-edit-compile cycle, audit a manuscript across Syntaxis and docstats, or ship a validated arXiv preprint package.
license: Apache-2.0
compatibility: Requires python3 and bash. Optional uv (docstats), syntaxis CLI, typst, and graphviz (dot, gvpr).
metadata:
  author: ghchinoy
  version: "1.1.0"
---

# arXiv Preprint Orchestration Workflow (`preprint-workflow`)

Coordinate the sibling skills in `repo-authoring` (`arxiv-preprint-authoring` and `technical-post-editorial`) alongside local checkouts of `syntaxis`, `docstats`, and `graphviz-style` to turn raw benchmark CSVs and repository code into a compiled, audited `@preview/arkheion:0.1.2` arXiv PDF.

![End-to-end arXiv preprint workflow](assets/01-preprint-lifecycle-light.webp)

---

## Resource, Asset & Script Files (Progressive Disclosure)

- [`scripts/run-preprint-gates.sh`](scripts/run-preprint-gates.sh): Single-command deterministic gate runner chaining Luminous `.dot` figure rendering, `docstats` clean-prose Axis A + Axis B scoring, optional `syntaxis review` JSON inspection, and the 100-point `validate_preprint.py` oracle (`--json` supported).
- [`references/howto-and-scorecard.md`](references/howto-and-scorecard.md): Practitioner preflight checklist, clean-prose Two-Axis calibration table, Typst syntax checks, and troubleshooting matrix.
- [`assets/01-preprint-lifecycle-light.webp`](assets/01-preprint-lifecycle-light.webp): Five-stage end-to-end preprint lifecycle diagram.
- [`assets/02-editorial-acceptance-gate-light.webp`](assets/02-editorial-acceptance-gate-light.webp): Clean-prose extraction, `docstats` Two-Axis gate, and `technical-post-editorial` human rubric loop.
- [`assets/03-syntaxis-orchestration-light.webp`](assets/03-syntaxis-orchestration-light.webp): Dual-mode `syntaxis` DAG (`review` vs. `execute`) and selective `--skip-*` asset regeneration.
- [`assets/04-preprint-oracle-matrix-light.webp`](assets/04-preprint-oracle-matrix-light.webp): `docs/preprint/` package contract mapped to the six pillars of `validate_preprint.py`.

---

## Sibling Skill & Tool Delegation

| Stage | Delegated Skill / Engine | Responsibility |
| :--- | :--- | :--- |
| **1. Scaffold & Blueprint** | `arxiv-preprint-authoring` ([docs](https://ghchinoy.github.io/agent-skills/plugins/repo-authoring/arxiv-preprint-authoring/)) | Scaffolds `docs/preprint/{data,figures}`, locks ground-truth CSVs first, enforces the `arXiv:2610.28380` 6-section progression and 10-row Table Economy rule. |
| **2. Semantic Figures** | `graphviz-style` (`luminous.gvpr`) | Renders semantic `.dot` files (`class="primary"`, `accent`, `store`, `code`; zero hex colors) to `.webp` and `288 DPI` `.png`. |
| **3. Structural Peer Review** | `syntaxis review` | Emits non-destructive `Suggestion[]` JSON (`major`, `minor`, `info`) across up to `2 MB` of project context without modifying source files. |
| **4. Two-Axis Prose Gate** | `docstats` + `technical-post-editorial` ([docs](https://ghchinoy.github.io/agent-skills/plugins/repo-authoring/technical-post-editorial/)) | Scores clean prose on Axis A (`FK 12.0–14.5`) and Axis B (`ai_tell_score >= 9.5`, zero prose em-dashes), then applies surgical voice edits and the 5D human rubric. |
| **5. Synthesis & Audit** | `syntaxis execute` + `arxiv-preprint-authoring` | Compiles `@preview/arkheion:0.1.2` Typst to `paper.pdf` and gates release on `100/100 PASS` in `validate_preprint.py`. |

---

## Execution Workflow

### Stage 1: Scaffold `docs/preprint/` & Render Luminous Figures

Activate `arxiv-preprint-authoring` before writing narrative prose:
1. Export canonical benchmark outputs to `docs/preprint/data/*.csv` first and treat them as read-only ground truth.
2. Author `docs/preprint/figures/*.dot` using semantic `class` attributes only (no `#RRGGBB` hex colors or `fontname`), and visually inspect both light and dark `.webp` renders after running `./scripts/run-preprint-gates.sh docs/preprint --render-figures`.
3. Draft `docs/preprint/paper.md` across the six required sections (`Abstract`, `1 Introduction`, `2 Related Work`, `3 Method`, `4 Experiments`, `5 Analysis`, `6 Conclusion`, `Limitations`, `References`, `Appendices A–B`, plus `Appendix C` when multi-domain tables exceed 10 rows). Write for technical accuracy first without optimizing grade-level numbers mid-sentence.

### Stage 2: Run Non-Destructive Structural Review (`syntaxis review`)

Register the manuscript, CSV directory, and codebase in Syntaxis so structural gaps surface before line editing:

```bash
SYNTAXIS=~/projects/syntaxis/bin/syntaxis

$SYNTAXIS project create my_paper
$SYNTAXIS project goal set my_paper arxiv @preview/arkheion:0.1.2
$SYNTAXIS project source add my_paper "$PWD/docs/preprint/paper.md"
$SYNTAXIS project source add my_paper "$PWD/docs/preprint/data"
$SYNTAXIS project source add my_paper "$PWD" --type code

$SYNTAXIS review my_paper --save
```

Resolve `major` structural, citation, and Table Economy suggestions in `paper.md` before running prose lints.

### Stage 3: Pass the Two-Axis Editorial Gate (`docstats` + `technical-post-editorial`)

Audit clean prose asynchronously after drafting, then activate `technical-post-editorial` to resolve diagnostic flags. Consult [`references/howto-and-scorecard.md`](references/howto-and-scorecard.md) for exact thresholds.

![Review and edit loop](assets/02-editorial-acceptance-gate-light.webp)

1. Run the unified gate script (or invoke the `readability-docstats` MCP `analyze_document` tool on stripped prose):
   ```bash
   ./scripts/run-preprint-gates.sh docs/preprint --project-id my_paper --json
   ```
2. Apply `technical-post-editorial` surgical edits until clean prose lands in `FK 12.0–14.5` (`ASL 15–19` w/s) and Axis B hits `ai_tell_score >= 9.5 / 10.0` (`0` prose em-dashes, `0` throat-clearing openers, `0` binary contrast frames, `-ly` adverb rate `<= 1.0/100w`).
3. Verify the five-dimension human rubric (`>= 35/50` across Directness, Rhythm, Density, Authenticity, and Trust) and Ruth Starkman's Core Tension test.

### Stage 4: Compile `@preview/arkheion:0.1.2` Typst (`syntaxis execute`)

Synthesize visual assets and compile `paper.pdf` via the six-phase Syntaxis DAG, or sync and compile `docs/preprint/paper.typ` directly.

![Syntaxis dual-mode orchestration](assets/03-syntaxis-orchestration-light.webp)

```bash
# Full 6-phase synthesis (Analysts -> Context -> Planner -> Luminous/Gonum/Image -> Writer -> Typst PDF)
~/projects/syntaxis/bin/syntaxis execute my_paper --verbose

# Fast visual iteration without re-running LLM analysis or prose writing
~/projects/syntaxis/bin/syntaxis project asset edit my_paper asset-12345 \
  --prompt="$(cat docs/preprint/figures/fig1_paradigms.dot)"
~/projects/syntaxis/bin/syntaxis execute my_paper --skip-analysis --skip-planning --skip-writing
```

### Stage 5: Close the Loop on the 100-Point Oracle

Run `./scripts/run-preprint-gates.sh` as the final pre-submission gate. Every pillar in `validate_preprint.py` (Structure, Clean Prose, Tables & CSVs, Luminous DOT, Typst Hygiene, and `typst compile`) plus Syntaxis prompt parity (`--check-syntaxis-prompts`) must pass.

![Package contract and 100-point validation oracle](assets/04-preprint-oracle-matrix-light.webp)

```bash
./scripts/run-preprint-gates.sh docs/preprint --render-figures --json
```

Patch any reported line-level error and re-run until `"passed": true` and `"score": 100`.
