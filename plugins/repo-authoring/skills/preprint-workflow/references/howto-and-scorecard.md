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

## 2. Two-Axis Calibration Targets (`docstats` + `technical-post-editorial`)

Running Flesch-Kincaid on raw Markdown gives a false pass (`FK ~11–13`). Sentence splitters treat short Markdown table cells as three-word sentences, which hides 45-word paragraphs pushing true complexity past Grade 20. Strip Markdown tables, fenced code blocks, and `$...$` math before checking Axis A readability (`run-preprint-gates.sh` performs this stripping automatically).

| Axis | Metric | Preprint Target (`Dense` Band) | Surgical Remediation Lever |
| :--- | :--- | :--- | :--- |
| **Axis A (Readability)** | `flesch_kincaid_grade` | **12.0 – 14.5** (pass `10.0–16.0`) | Split 40-word multi-clause sentences into two declarative sentences. |
| **Axis A (Readability)** | `flesch_reading_ease` | **30.0 – 50.0** | Swap stacked abstract nouns (`"syntactic validity verification"`) for plain words (`"syntax checks"`). |
| **Axis A (Readability)** | Clean-prose `ASL` / `ASW` | **15–19 w/s** · **1.75–1.88 syl/w** | Put the mechanism in one 15-word sentence and report parenthetical metrics in the next. |
| **Axis B (House Style)** | `ai_tell_score` | **`>= 9.5 / 10.0`** (blog floor `7.0`) | Clear every deterministic flag below via `technical-post-editorial`. |
| **Axis B (House Style)** | `em_dash_count` | **`0` in prose** | Replace `—` with `:` (causal spec), `;` (independent clause), or `(...)` (brief numbers). |
| **Axis B (House Style)** | `throat_clearing_count` | **`0`** | Delete preambles like `"It is worth noting that"`; start with a named actor and verb. |
| **Axis B (House Style)** | `binary_contrast_count` | **`0`** | Rewrite `"X isn't a linter, it's an oracle"` as a direct statement of what X does. |
| **Axis B (House Style)** | `adverb_ly_rate` | **`<= 1.0 / 100w`** | Delete filler softeners (`notably`, `fundamentally`, `simply`); keep technical allowlist (`atomically`, `deterministically`, `concurrently`). |

Close the edit pass with the five-dimension human rubric from `technical-post-editorial`: score `1–10` on **Directness**, **Rhythm**, **Density**, **Authenticity**, and **Trust** (pass `>= 35/50`), and test surviving devices against Ruth Starkman's Core Tension rule.

---

## 3. `@preview/arkheion:0.1.2` Typst Compile Traps

Before running `typst compile docs/preprint/paper.typ docs/preprint/paper.pdf`, check three Typst syntax rules.

- **Quote multi-letter math identifiers:** Write `$"FVR"$`, `$"SIR"$`, and `$S_"max"$`. Unquoted `$FVR$` renders as $F \cdot V \cdot R$.
- **Use native Typst math symbols:** Write `times`, `arrow.r`, `in`, `cal(T)`, `bb(I)`, `plus.o`, `inter`, `union`, and `emptyset`. Typst rejects LaTeX macros (`\times`, `\to`) and invalid symbol names (`plus.circle`, `sect`).
- **Separate `columns` and `align` in booktabs tables:** Pass widths to `columns: (auto, auto, auto)` and alignments to `align: (left, right, right)`. Escape literal dollar signs (`\$0.002`) outside math blocks.

---

## 4. Troubleshooting Matrix

| Symptom | Cause | Fix |
| :--- | :--- | :--- |
| Diagram renders in Times or another serif font | Google Sans Flex or Google Sans Code is missing from fontconfig | Install both font casks, run `fc-cache -f`, and check `make -C ~/projects/graphviz-style fonts`. |
| Raw `paper.md` scores `FK 11.8`, yet `validate_preprint.py` warns `FK 17.4` | Markdown table cells lowered average sentence length on the raw file | Split 35+ word prose sentences and replace stacked abstract nouns in `paper.md`. |
| `docstats` flags `ai_tell_score < 9.5` | Prose contains `—`, `"worth noting"`, `"not X, it's Y"`, or filler `-ly` adverbs | Apply the surgical rules in Section 2 and re-run `./scripts/run-preprint-gates.sh`. |
| `typst compile` fails on `FVR` or `plus.circle` | Unquoted multi-letter math identifier or invalid symbol name in `paper.typ` | Quote identifiers (`$"FVR"$`) and replace `plus.circle` / `sect` with `plus.o` / `inter`. |
| Edge crosses a cluster title in a `.webp` figure | Cluster `label` is wider than its leftmost node | Shorten the cluster `label` to 1–2 words or add `constraint=false` on back-edges. |
