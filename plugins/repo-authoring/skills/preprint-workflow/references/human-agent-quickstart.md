# Human-to-Agent Quickstart Guide (`feat/preprint-workflow`)

This guide shows human authors what to install, what inputs to hand an AI coding agent, and which prompts to paste when running [`../SKILL.md`](../SKILL.md) from the `feat/preprint-workflow` branch. For low-level metric thresholds and templates, see [`howto-and-scorecard.md`](howto-and-scorecard.md).

---

## 1. Install the Three-Skill Triad From the Branch

`preprint-workflow` pairs with two sibling skills in `repo-authoring`: `arxiv-preprint-authoring` (blueprint and `validate_preprint.py`) and `technical-post-editorial` (prose editing rules). Install all three skills together into your project or global config.

```bash
npx skills add https://github.com/ghchinoy/agent-skills/tree/feat/preprint-workflow \
  --skill preprint-workflow \
  --skill arxiv-preprint-authoring \
  --skill technical-post-editorial
```

If `npx` is missing on the target host, clone the branch so the agent can read `SKILL.md` and run [`../scripts/run-preprint-gates.sh`](../scripts/run-preprint-gates.sh).

```bash
git clone --depth 1 --branch feat/preprint-workflow \
  https://github.com/ghchinoy/agent-skills.git /tmp/agent-skills
```

> **Do not rely on bare `/tree/` web fetches.** Fetching a `https://github.com/.../tree/...` URL returns GitHub's HTML directory page instead of raw Markdown. Use `npx skills add` or `git clone` so the executable gate scripts land on disk.

---

## 2. Host Prerequisites

Verify the tools on the host or container before starting your agent. Core gates run offline with Python, Typst, and Graphviz; `docstats` and `syntaxis` add style scoring and multi-agent builds.

| Requirement | Tier | Purpose | Quick Check / Install |
| :--- | :--- | :--- | :--- |
| **`python3` (`>= 3.10`), `bash`, `git`** | **Required** | Runs `run-preprint-gates.sh` and `validate_preprint.py` | `python3 --version` |
| **3 Sibling Skills** | **Required** | Blueprint, editorial rubric, and 100-point validator | `npx skills add` command above |
| **`typst` CLI** | **Required for PDF** | Compiles `@preview/arkheion:0.1.2` (`paper.typ` -> `paper.pdf`) | `brew install typst && typst --version` |
| **Graphviz (`dot`, `gvpr`) + Google Sans fonts + `luminous.gvpr`** | **Required for Figures** | Renders semantic `.dot` sources to `.webp` and `288 DPI` `.png` | `brew install graphviz && brew install --cask font-google-sans-flex font-google-sans-code` |
| **`docstats` (`~/projects/docstats`) + `uv`** | **Recommended** | Computes Axis B (`ai_tell_score >= 9.5`) and per-section `max_sec_FK` | `cd ~/projects/docstats && uv sync` *(if absent, `validate_preprint.py` still runs built-in clean-prose `FK` and hotspot checks)* |
| **`syntaxis` (`~/projects/syntaxis`) + Gemini/Vertex auth** | **Optional** | Runs `syntaxis review` (`Suggestion[]`) and `syntaxis execute` | `make -C ~/projects/syntaxis build-backend` *(skipped if `--project-id` is omitted)* |

Run this four-line preflight check before launching a long session.

```bash
python3 --version && typst --version && dot -V
echo 'digraph{a}' | dot -Twebp > /dev/null && echo "webp ok"
fc-match "Google Sans Flex" && fc-match "Google Sans Code"
ls ~/projects/graphviz-style/theme/luminous.gvpr
```

---

## 3. What to Provide Your Agent (Input Expectations)

Pick the row matching your starting material and include those paths and decisions in your prompt.

| Scenario | What You Hand the Agent | What the Agent Delivers in `docs/preprint/` |
| :--- | :--- | :--- |
| **A. Codebase + Raw Telemetry** *(greenfield `v1.0`)* | 1. Repository path (`$PWD`)<br>2. Raw benchmark outputs (JSON, JSONL, logs, or runner script)<br>3. Working title, author names/emails/affiliations, and a 2–3 sentence thesis naming the bottleneck and mechanism<br>4. Citation policy (seed `.bib`/references or permission to verify live arXiv refs) | Exports read-only `data/*.csv` first, authors multi-row `figures/*.dot` (`aspect_ratio <= 3.0:1`), writes `paper.md` and `paper.typ` with timeless mechanism names, compiles and visually inspects `paper.pdf`, and commits `editorial-scorecard.md`. |
| **B. Rough Draft + Data** *(notes or blog post -> `v1.0`)* | 1. Draft path (`notes.md`, design doc, or blog post)<br>2. Canonical CSVs or benchmark folder to verify every number<br>3. Optional codebase path so method claims match code<br>4. Author block and citation list/policy | Locks `data/*.csv`, reshapes prose into the 6-section `arXiv:2610.28380` progression + `Appendices A–B` (quarantining `v0.x.y` release tags to an `Appendix B` crosswalk), clears Axis A (`max_sec_FK <= 16.5`) and Axis B (`>= 9.5`), compiles `paper.pdf`, and writes `editorial-scorecard.md`. |
| **C. Existing `docs/preprint/`** *(iterative `v1.X -> v1.Y`)* | 1. Existing `docs/preprint/` path<br>2. New ablation CSVs, upstream code release range, or editorial focus<br>3. Explicit role selection: **Reviewer (Read-Only Plan)** or **Author (Execute)** | **Reviewer pass:** Emits `revision-plan-vX.Y.md` (`RP-YYYY-MM-DD-vX.Y` with `REV-vX.Y-01..NN`) without editing manuscript files.<br>**Author pass:** Executes approved `REV-*` items in lockstep, graduates solved `Limitations` items, inspects `paper.pdf` pages, and updates `editorial-scorecard.md`. |

### Three Guardrails (What the Skill Will Not Invent)

1. **Ground-truth numbers:** The agent never fabricates benchmark metrics, latencies, or baseline scores. Every number in `paper.md` and `paper.typ` must trace to `docs/preprint/data/*.csv` or a verified benchmark artifact you provide.
2. **Citations:** If you run in an offline sandbox without web search, provide a reference list or `.bib` file. Otherwise state in your prompt that the agent may query arXiv/DOI metadata so every `## References` entry is real.
3. **Author metadata:** Supply exact author names, institutional affiliations, and contact emails so the `@preview/arkheion:0.1.2` title block compiles without placeholder tokens.

---

## 4. Copy-Paste Prompts for Human Users

### Prompt A: Greenfield or Rough Draft -> Validated `v1.0` Preprint

```text
Use the `preprint-workflow` skill (along with `arxiv-preprint-authoring` and `technical-post-editorial`) from branch `feat/preprint-workflow` of `ghchinoy/agent-skills`.

If those three skills are not installed yet in this workspace, run:
`npx -y skills add https://github.com/ghchinoy/agent-skills/tree/feat/preprint-workflow --skill preprint-workflow --skill arxiv-preprint-authoring --skill technical-post-editorial -y`
(or `git clone --depth 1 --branch feat/preprint-workflow https://github.com/ghchinoy/agent-skills.git /tmp/agent-skills` and read `/tmp/agent-skills/plugins/repo-authoring/skills/preprint-workflow/SKILL.md`).

Inputs for this paper:
- Codebase path: <PATH_TO_REPO>
- Draft / notes (if any): <PATH_TO_NOTES_OR_NONE>
- Benchmark telemetry / CSV source: <PATH_TO_BENCHMARK_OUTPUTS>
- Working title: "<PAPER_TITLE>"
- Authors & affiliations: <NAME, AFFILIATION, EMAIL>
- Core thesis: <2-3 SENTENCES ON THE BOTTLENECK, MECHANISM, AND HEADLINE GAIN>
- Citations: <USE_PROVIDED_BIB_AT_PATH | VERIFY_REAL_ARXIV_REFERENCES_ONLINE>

Execute Stages 1 through 5 of `preprint-workflow` into `docs/preprint/`:
1. Lock ground-truth CSVs in `docs/preprint/data/` before drafting tables or prose.
2. Author semantic Luminous `.dot` figures (`aspect_ratio <= 3.0:1`, zero hex colors) and render `.webp` and 288 DPI `.png` files.
3. Draft `paper.md` and `@preview/arkheion:0.1.2` `paper.typ` using timeless mechanism names (move software `v0.x.y` history to an Appendix B crosswalk).
4. Run `run-preprint-gates.sh docs/preprint --render-figures --json`, resolve all Axis A (`FK 10.5-14.5`, `max_sec_FK <= 16.5`) and Axis B (`ai_tell_score >= 9.5`, zero prose em-dashes) flags, visually inspect every page of `docs/preprint/paper.pdf`, and record the final `100/100 PASS` results in `docs/preprint/editorial-scorecard.md`.
```

### Prompt B: Iterative Reviewer Role (Read-Only `revision-plan-vX.Y.md`)

```text
Act in the **Editorial & Scientific Reviewer Role** (read-only) defined in the `preprint-workflow` skill (`feat/preprint-workflow` branch of `ghchinoy/agent-skills`).

Audit `docs/preprint/` (`paper.md`, `paper.typ`, `paper.pdf`, `data/*.csv`) alongside new upstream changes in `<REPO_OR_NEW_DATA_PATH>`:
1. Run `run-preprint-gates.sh docs/preprint --json` and inspect every page of `docs/preprint/paper.pdf` visually.
2. Check CSV-to-prose decimal parity, section-level `FK`/`ASL` hotspots (`max_sec_FK <= 16.5`), main-body table economy, version-tag leakage, figure aspect ratios, and solved `Limitations` items ready for graduation.
3. Do NOT edit `paper.md` or `paper.typ`. Write a tracked revision plan to `docs/preprint/revision-plan-vX.Y.md` (`RP-YYYY-MM-DD-vX.Y`) with prioritized `REV-vX.Y-01..NN` items, exact file/line targets, and drop-in specifications.
```

### Prompt C: Iterative Author & Typesetter Role (Execute `revision-plan-vX.Y.md`)

```text
Act in the **Author & Typesetter Role** defined in the `preprint-workflow` skill (`feat/preprint-workflow` branch of `ghchinoy/agent-skills`).

Execute every open item in `docs/preprint/revision-plan-vX.Y.md`:
1. Apply each `REV-vX.Y-NN` change in lockstep across `paper.md`, `paper.typ`, `figures/*.dot`, and `data/*.csv`.
2. Re-render figures and compile `docs/preprint/paper.pdf` (`@preview/arkheion:0.1.2`). Visually inspect every rendered PDF page for table-cell bullet artifacts (`[\- ...]`), half-empty pages (`placement: auto`), and figure legibility.
3. Re-run `run-preprint-gates.sh docs/preprint --render-figures --json` until all six pillars score `100/100 PASS` (`exit 0`), mark `[x]` on completed items in `docs/preprint/revision-plan-vX.Y.md`, and update `docs/preprint/editorial-scorecard.md`.
```
