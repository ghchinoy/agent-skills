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
| **Content Pages** | `1 (Landing) + P (Plugins) + S (Skills) + R (References) + 1 (Skills Index) + 3 (About)` | `site/tests/content.test.mjs` (line 51), `site/tests/chrome.test.mjs`, `site/tests/fields.test.mjs`, `site/tests/no-fabrication.test.mjs`, `site/tests/links.test.mjs` |
| **Forbidden `okf_version` Pages** | `Content Pages - 5` (`pages.length - legitimate.length`) | `site/tests/content.test.mjs` (line 239) |
| **Built HTML** | `Content Pages + 1 (404.html)` | `site/tests/links.test.mjs` |
| **Resource Files** | `References + Scripts + Assets` (`RESOURCE_FILE_POPULATION`) | `site/tests/advisories.test.mjs`, `site/tests/resources.test.mjs` |
| **Scripts** | Count of files under `plugins/*/skills/*/scripts/` | `site/tests/resources.test.mjs` (AC1 & AC5) |
| **Baseline Advisories** | Only increments if a new plugin/skill triggers `[I1]`, `[I3]`, or `[I4]` (see Authoring Guardrails below) | `site/tests/build-e2e.test.mjs` |
| **Main Links** | Crawled internal `<a href>` inside `<main>` (`internal.length`) and file-resolving links (`internal.length - 2`) | `site/tests/links.test.mjs` |

## 2. Authoring Guardrails (Preventing Unnecessary Advisory & Test Drift)

- **Keep `description` byte-identical between `plugin.json` and `.claude-plugin/marketplace.json`**:
  The `[I1]` advisory (`two competing descriptions for "<plugin>"`) only fires when `plugin.json` and `marketplace.json` differ. Using the exact same string in both files prevents new `[I1]` advisories and keeps the baseline count in `site/tests/build-e2e.test.mjs` unchanged.
- **Inline backtick dead-pointer (`[D4]`) rule in `SKILL.md`**:
  The loader's `adviseDeadPointers` (`[D4]`) rule treats any inline backtick code span (` `...` `) starting with `scripts/`, `references/`, or `assets/` as a literal file path on disk.
  - **DO NOT** put CLI arguments inside a bare inline span (e.g., `` `scripts/my-tool.sh --flag` `` will fail `[D4]`).
  - **DO** prefix inline CLI invocations with `./` (e.g., `` `./scripts/my-tool.sh --flag` ``) or place them in fenced ` ```bash ` code blocks, reserving bare `` `scripts/my-tool.sh` `` spans for referring to the file itself.

## 3. Sandbox & Container Environment Setup (`EXDEV` & Node Version)

- **Avoid `EXDEV: cross-device link not permitted`**: In container/sandbox environments where `/tmp` is a separate `tmpfs` mount from `/home`, Astro/Node temporary directory operations across mounts will fail. Always point `TMPDIR` to a directory on the home filesystem:
  ```bash
  mkdir -p ~/.tmp && export TMPDIR="$HOME/.tmp"
  ```
- **Node version requirement (`>=22.19.0`)**: `site/package.json` and `site/tests/pins.test.mjs` enforce `node >= 22.19.0`. If your default shell is on an older Node 22.x release, switch via nvm first (`source ~/.config/nvm/nvm.sh && nvm use 22.19.0`).

## 4. Two-Step Fast Verification Workflow (< 2 Seconds vs 90 Seconds)

- **Step 1: Fast (< 2s) Static Tripwire Sweep**:
  All population tripwires (`Plugins`, `Skills`, `Content Pages`, `Forbidden okf_version Pages`, `Built HTML`, `Scripts`, `Resource Files`, and `Main Links`) are tested by suites that read the static `site/dist/` directory without spawning child `astro build` processes. Run these immediately after building to discover exact link/page counts in ~1.5 seconds:
  ```bash
  export TMPDIR="$HOME/.tmp"
  npm run build --prefix site
  node --test site/tests/{content,fields,links,resources,skill-index,versions,chrome,no-fabrication}.test.mjs
  ```
- **Step 2: Full Sequential Verification (`--test-concurrency=1`)**:
  The E2E suites (`advisories.test.mjs` and `build-e2e.test.mjs`) spawn live `astro build` subprocesses. Running them concurrently causes race conditions on the shared `site/.astro/` content collection cache (`AstroUserError: The slug "index" specified in the Starlight sidebar config does not exist`). `npm test` in `site/package.json` is configured with `--test-concurrency=1` to prevent this:
  ```bash
  export TMPDIR="$HOME/.tmp"
  ./scripts/validate-plugins.sh && npm test --prefix site
  ```


