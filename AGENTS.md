<!-- headroom:rtk-instructions -->
# RTK (Rust Token Killer) - Token-Optimized Commands

When running shell commands, **always prefix with `rtk`**. This reduces context
usage by 60-90% with zero behavior change. If rtk has no filter for a command,
it passes through unchanged — so it is always safe to use.

## Key Commands
```bash
# Git (59-80% savings)
rtk git status          rtk git diff            rtk git log

# Files & Search (60-75% savings)
rtk ls <path>           rtk read <file>         rtk grep <pattern>
rtk find <pattern>      rtk diff <file>

# Test (90-99% savings) — shows failures only
rtk pytest tests/       rtk cargo test          rtk test <cmd>

# Build & Lint (80-90% savings) — shows errors only
rtk tsc                 rtk lint                rtk cargo build
rtk prettier --check    rtk mypy                rtk ruff check

# Analysis (70-90% savings)
rtk err <cmd>           rtk log <file>          rtk json <file>
rtk summary <cmd>       rtk deps                rtk env

# GitHub (26-87% savings)
rtk gh pr view <n>      rtk gh run list         rtk gh issue list

# Infrastructure (85% savings)
rtk docker ps           rtk kubectl get         rtk docker logs <c>

# Package managers (70-90% savings)
rtk pip list            rtk pnpm install        rtk npm run <script>
```

## Rules
- In command chains, prefix each segment: `rtk git add . && rtk git commit -m "msg"`
- For debugging, use raw command without rtk prefix
<!-- /headroom:rtk-instructions -->

# Docs Site Maintenance & Test Suite Guardrails

The Astro Starlight documentation site (`site/`) enforces exact population invariants across its 311-test suite (`site/tests/`). When adding, modifying, or removing a plugin or skill, update the tripwire assertions in one batch rather than discovering them iteratively.

## 1. Population Metrics Dependency Formulas

When a plugin or skill is added/modified, the following numbers change:

| Metric | Formula / Calculation | Files to Update |
| :--- | :--- | :--- |
| **Plugins** | Total plugin directories under `plugins/` | `site/tests/content.test.mjs`, `README.md` |
| **Skills** | Total `SKILL.md` files declared in `marketplace.json` | `site/tests/content.test.mjs`, `site/tests/fields.test.mjs`, `site/tests/versions.test.mjs`, `site/tests/skill-index.test.mjs` |
| **Content Pages** | `1 (Landing) + P (Plugins) + S (Skills) + R (References) + 1 (Skills Index) + 3 (About)` | `site/tests/content.test.mjs`, `site/tests/chrome.test.mjs`, `site/tests/fields.test.mjs`, `site/tests/no-fabrication.test.mjs`, `site/tests/links.test.mjs` |
| **Built HTML** | `Content Pages + 1 (404.html)` | `site/tests/links.test.mjs` |
| **Resource Files** | `References + Scripts + Assets` | `site/tests/advisories.test.mjs`, `site/tests/resources.test.mjs` |
| **Scripts** | Count of files under `plugins/*/skills/*/scripts/` | `site/tests/resources.test.mjs` |
| **Baseline Advisories** | Count base: 1 per plugin for `[I1]`, plus version skews & orphan references | `site/tests/build-e2e.test.mjs` |
| **Main Links** | Crawled internal `<a href>` inside `<main>` and file-resolving links | `site/tests/links.test.mjs` |

## 2. Fast Verification Workflow

- **Do not run the full `npm test` after each single-line edit**: The full suite takes 45–90s due to multiple live `astro build` subprocesses.
- **Run targeted test files first**:
  ```bash
  rtk node --test site/tests/<test-name>.test.mjs
  ```
- **Avoid editing files while an Astro build is actively running**: Prevents `.astro/.prerender` module resolution race conditions.
- **Run the full suite and plugin validator once at the end**:
  ```bash
  rtk npm test --prefix site && rtk ./scripts/validate-plugins.sh
  ```

