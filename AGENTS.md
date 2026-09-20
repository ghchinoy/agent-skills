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

The Astro Starlight documentation site (`site/`) enforces exact population invariants across its test suites (`site/tests/`).

## 1. Dynamic Population Invariants & Relational Testing

The test suite uses **dynamic relational invariants** rather than fragile hardcoded scalar counts:
- **Routes & Content Pages**: Derived dynamically via `sourceRoutes()` from `marketplace.json` and the `plugins/` tree, verified against `distContentPages()`.
- **Resources (References, Scripts, Assets)**: Verified group-by-group bidirectionally against disk (`assert.deepEqual(tally(shown), tally(disk))`).
- **Links & In-Page Anchors**: Verified relationally against parsed files and routes, eliminating manual count updates when content is added or modified.

Adding a plugin, skill, script, or reference now passes the static tests automatically without requiring manual edits across test files.

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
- **Node version requirement (`>=22.19.0`)**: `site/package.json` and `site/tests/pins.test.mjs` enforce `node >= 22.19.0`. If your default shell is on an older Node release, load nvm first:
  ```bash
  source ~/.nvm/nvm.sh 2>/dev/null || source ~/.config/nvm/nvm.sh 2>/dev/null
  nvm use 22.19.0
  ```

## 4. Two-Tier Verification Workflow (< 5 Seconds vs Full E2E)

- **Fast Local Iteration (~5s total)**:
  Build the site once (~2.8s) and run the fast static/in-memory test suite (~3.5s):
  ```bash
  export TMPDIR="$HOME/.tmp"
  npm run build --prefix site
  npm run test:fast --prefix site
  ```
- **Full Sequential Verification (CI / Pre-Release)**:
  Runs plugin spec validation, Astro typechecking, and the full sequential test suite including mutation testing and isolated Astro build subprocesses (`build-e2e.test.mjs` and `advisories.test.mjs`):
  ```bash
  export TMPDIR="$HOME/.tmp"
  ./scripts/validate-plugins.sh && npm test --prefix site
  ```


