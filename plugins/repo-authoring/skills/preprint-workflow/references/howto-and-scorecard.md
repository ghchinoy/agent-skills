# Preprint How-To Guide & Two-Axis Scorecard Reference

This reference accompanies [`../SKILL.md`](../SKILL.md) and [`../scripts/run-preprint-gates.sh`](../scripts/run-preprint-gates.sh). It provides copy-paste setup verification, clean-prose scoring calibration, Typst compile checks, and troubleshooting fixes.

---

## 1. Local Toolchain Preflight

Check your local binaries and font cache before creating a `docs/preprint/` directory.

1. **Verify Graphviz WebP output and Google Sans fonts.**
   ```bash
   echo 'digraph{a}' | dot -Twebp > /dev/null && echo "webp ok"
   make -C ~/projects/graphviz-style fonts
   ```
   Every line from `make fonts` must resolve to `GoogleSansFlex.ttf` or `GoogleSansCode[wght].ttf`. If a font is missing, Pango falls back to a serif face without printing an error.

2. **Build the Syntaxis CLI.**
   ```bash
   make -C ~/projects/syntaxis build-backend
   ~/projects/syntaxis/bin/syntaxis version
   ```
   Run `make build` instead of `build-backend` if you want the embedded Web UI (`syntaxis serve --port 8080`) for side-by-side Typst and PDF previews.

3. **Sync the `docstats` virtual environment.**
   ```bash
   cd ~/projects/docstats && uv sync
   ```

4. **Check your Typst binary.**
   ```bash
   typst --version
   ```

---

## 2. Two-Axis & Per-Section Calibration Targets (`docstats` + `technical-post-editorial`)

Evaluating readability on a technical manuscript requires guarding against **three measurement illusions** (`run-preprint-gates.sh` handles all three automatically):
1. **The Raw-Markdown Table Illusion:** Running Flesch-Kincaid on raw `paper.md` gives a false pass (`FK ~9–11`) because sentence splitters treat 800+ short Markdown table cells as three-word sentences, hiding 45-word prose paragraphs.
2. **The Decimal-Point & `## References` Illusion:** Standard `textstat.sentence_count()` splits on every decimal point (`1.78%`, `91.6x`) and author initial (`Radford, A., Kim, J. W.`), doubling sentence count and halving measured `ASL`. Always strip `## References` and sanitize decimal points (`1.78` $\to$ `1_78`) before computing `ASL` and `FK`.
3. **The Whole-Document Averaging Illusion:** A document-wide `FK = 14.6` can still hide an `Impenetrable` `## Limitations` (`FK = 23.9`, `ASL = 44 w/s`) or `## Appendix B` (`FK = 19.3`) washed out by a crisp Introduction. Always check **`max_sec_FK`** across every `## ` section.

| Axis | Metric | Preprint Target (`Dense` Band) | Surgical Remediation Lever |
| :--- | :--- | :--- | :--- |
| **Axis A (Readability)** | Document `flesch_kincaid_grade` | **10.5 – 14.5** (pass `10.0–16.0`) | Split 40+ word multi-clause sentences into two declarative sentences. |
| **Axis A (Readability)** | Per-section `max_sec_FK` | **`<= 16.5` in every `## ` section** | Audit `## Limitations`, `## 3 Method`, and `## Appendix B` for 50–90w sentences with stacked parentheticals. |
| **Axis A (Readability)** | `flesch_reading_ease` | **30.0 – 50.0** | Swap stacked abstract nouns (`"syntactic validity verification"`) for plain words (`"syntax checks"`). |
| **Axis A (Readability)** | Clean-prose `ASL` / `ASW` | **15–19.5 w/s** · **1.60–1.88 syl/w** | Put the mechanism in one 15-word sentence and report parenthetical metrics in the next (max 1 parenthetical per sentence). |
| **Axis B (House Style)** | `ai_tell_score` | **`>= 9.5 / 10.0`** (blog floor `7.0`) | Clear every deterministic flag below via `technical-post-editorial`. |
| **Axis B (House Style)** | `em_dash_count` | **`0` in prose and tables** | Replace `—` in prose with `:`, `;`, or `(...)`; use `-` in empty Markdown table cells. |
| **Axis B (House Style)** | `throat_clearing_count` | **`0`** | Delete preambles like `"It is worth noting that"`; start with a named actor and verb. |
| **Axis B (House Style)** | `binary_contrast_count` | **`0`** | Rewrite `"X isn't a linter, it's an oracle"` as a direct statement of what X does. |
| **Axis B (House Style)** | `adverb_ly_rate` | **`<= 1.0 / 100w`** | Delete filler softeners (`notably`, `fundamentally`, `simply`); keep technical allowlist (`atomically`, `deterministically`, `concurrently`). |

Close the edit pass with the five-dimension human rubric from `technical-post-editorial`: score `1–10` on **Directness**, **Rhythm**, **Density**, **Authenticity**, and **Trust** (pass `>= 35/50`), and test surviving devices against Ruth Starkman's Core Tension rule.

---

## 3. `@preview/arkheion:0.1.2` Typst Compile & Visual Layout Traps

Before and after running `typst compile docs/preprint/paper.typ docs/preprint/paper.pdf`, check these seven syntax and visual layout rules:

- **Quote multi-letter math identifiers:** Write `$"FVR"$`, `$"SIR"$`, and `$S_"max"$`. Unquoted `$FVR$` renders as $F \cdot V \cdot R$.
- **Use native Typst math symbols:** Write `times`, `arrow.r`, `in`, `cal(T)`, `bb(I)`, `plus.o`, `inter`, `union`, and `emptyset`. Typst rejects LaTeX macros (`\times`, `\to`) and invalid symbol names (`plus.circle`, `sect`).
- **Separate `columns` and `align` in booktabs tables:** Pass widths to `columns: (auto, auto, auto)` and alignments to `align: (left, right, right)`. Escape literal dollar signs (`\$0.002`) outside math blocks.
- **Escape leading hyphens inside `#table(...)` cells:** Writing `[ - (0% KT $Delta$)]` with a space after `-` at the start of a content block triggers Typst's unordered list parser and renders a bullet dot (`•`) inside the table cell. Escape it as `[\- (0% KT $Delta$)]`.
- **Float multi-row tables with `placement: auto`:** Wrapping large `#figure(kind: table, placement: auto, ...)` blocks lets Typst backfill narrative paragraphs and prevents 50% blank half-pages before wide tables.
- **Use native appendix heading counters:** Switch to `#counter(heading).update(0)` and `#set heading(numbering: "A.1")` at the start of the appendices instead of hardcoding `=== A.1 ...` (which renders as `7.1 A.1 ...` when numeric heading numbering is active).
- **Wrap 6+ node `.dot` pipelines into 2 rows (`aspect_ratio <= 3.0:1`):** A single-row `rankdir=LR` Graphviz chain with 7–8 nodes shrinks to `< 0.8 in` tall when scaled to `width: 100%` of the PDF page. Group stages into two horizontal ranks or parallel subgraph clusters.

---

## 4. Troubleshooting Matrix

| Symptom | Cause | Fix |
| :--- | :--- | :--- |
| Diagram renders in Times or another serif font | Google Sans Flex or Google Sans Code is missing from fontconfig | Install both font casks, run `fc-cache -f`, and check `make -C ~/projects/graphviz-style fonts`. |
| Diagram text is tiny (`< 5pt`) in `paper.pdf` despite `width: 100%` | `.dot` graph places 7+ nodes in a single `rankdir=LR` row (`aspect_ratio > 3.5:1`) | Wrap the pipeline into a 2-row snake/grid layout (`rank=same` or stacked clusters) so aspect ratio stays `<= 3.0:1`. |
| Raw `paper.md` scores `FK 11.8`, yet `validate_preprint.py` warns `FK 17.4` | Markdown table cells lowered average sentence length on the raw file | Split 35+ word prose sentences and replace stacked abstract nouns in `paper.md`. |
| Overall clean-prose `FK` is `14.5`, yet `Limitations` or `Appendix B` feels dense | Whole-document averaging masked a section with 50–90w multi-parenthetical sentences | Inspect `max_sec_FK` and `hotspot_sections` in `run-preprint-gates.sh` and unpack sentences until every section has `FK <= 16.5` and `ASL <= 24 w/s`. |
| `docstats` flags `ai_tell_score < 9.5` | Prose contains `—`, `"worth noting"`, `"not X, it's Y"`, or filler `-ly` adverbs | Apply the surgical rules in Section 2 and re-run `./scripts/run-preprint-gates.sh`. |
| Table cell in `paper.pdf` renders with a black bullet dot (`• (0% Δ)`) | Cell starts with `[ - (` which Typst parses as an unordered list item | Escape the leading hyphen as `[\- (0% $Delta$)]`. |
| `typst compile` fails on `FVR` or `plus.circle` | Unquoted multi-letter math identifier or invalid symbol name in `paper.typ` | Quote identifiers (`$"FVR"$`) and replace `plus.circle` / `sect` with `plus.o` / `inter`. |
| Main-body tables are cluttered with `v0.2.0` / `v0.3.0` / `v0.4.0` or `bd` IDs | Engineering release tags and issue IDs leaked into scientific comparisons | Rename main-body rows by architectural mechanism (`Greedy CTC` vs. `Beam + KT`) and move software release history to a Release Crosswalk table in `Appendix B`. |
| Edge crosses a cluster title in a `.webp` figure | Cluster `label` is wider than its leftmost node | Shorten the cluster `label` to 1–2 words or add `constraint=false` on back-edges. |

---

## 5. Templates: `revision-plan-vX.Y.md` & `editorial-scorecard.md`

### 5.1 Iterative Revision Plan (`docs/preprint/revision-plan-vX.Y.md`)

Use this schema when the Editorial Reviewer agent audits a draft and hands off a deterministic worklist to the Author agent:

```markdown
# Preprint Revision Plan — Revision `vX.Y` (`RP-YYYY-MM-DD-vX.Y`)

- **Base Manuscript Version:** `vX.(Y-1)` (`docs/preprint/paper.md`, `docs/preprint/paper.typ`, `docs/preprint/paper.pdf`)
- **Target Manuscript Version:** `vX.Y`
- **Purpose:** <1-2 sentence goal of this iteration: e.g., de-versioning main tables, ingesting new ablation CSVs, or per-section clean-prose calibration>

## Section-by-Section Clean-Prose Audit (`vX.(Y-1)`)

| Section | Words | Sents | Current `ASL` (`15–19.5 w/s`) | Current `FK` (`10.5–14.5`) | Band | Action Required |
|---|---:|---:|---:|---:|---|---|
| `## Abstract` | ... | ... | ... | ... | ... | ... |
| `## Limitations` | ... | ... | ... | ... | ... | ... |

## Tracked Revision Matrix (`vX.Y`)

| Rev ID | Priority | Category | Target Files & Lines | Summary of Recommended Change | Status |
|---|:---:|---|---|---|---:|
| **`REV-vX.Y-01`** | P0 | Pillar / Section | `paper.md:L10-L30`<br>`paper.typ` | Exact specification of prose, table, or figure change. | [ ] |
```

### 5.2 Persistent Editorial Scorecard (`docs/preprint/editorial-scorecard.md`)

Commit `docs/preprint/editorial-scorecard.md` alongside `paper.md` and `paper.pdf` so every revision leaves a verifiable audit trail:

```markdown
# Technical Post & Preprint Editorial Scorecard — Revision `vX.Y`

**Document:** `docs/preprint/paper.md` (Revision `vX.Y`, Tracking ID: `RP-YYYY-MM-DD-vX.Y`)  
**Compiled Preprint:** `docs/preprint/paper.pdf` (`@preview/arkheion:0.1.2`)  

## 1. Deterministic 6-Pillar Preprint Oracle (`validate_preprint.py`)
- **Score:** `100 / 100 PASS` (`0` errors, `0` warnings)
- **Overall Clean Prose:** `FK = ...`, `FRE = ...`, `ASL = ... w/s`, `ASW = ... syl/w`

## 2. Section-by-Section Clean-Prose Readability (`max_sec_FK <= 16.5`)
| Section | Words | Sents | `ASL` | `FK` | `FRE` | Band | Status |
|---|---:|---:|---:|---:|---:|---|---:|
| `## Abstract` | ... | ... | ... | ... | ... | `Dense (10-16)` | `[PASS]` |

## 3. `docstats` Axis B & 5-Dimension Qualitative Rubric (`>= 35/50`)
- **Axis B (`ai_tell_score`):** `10.0 / 10.0` (`0` em-dashes, `0` throat-clearing, `0` binary contrasts)
- **Qualitative Rubric:** Directness (`../10`), Rhythm (`../10`), Density (`../10`), Authenticity (`../10`), Trust (`../10`) — **Total: `../50` `[PASS]`**
```
