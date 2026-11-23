---
name: oss-contribution-audit
description: "Read-only GitHub open-source contribution auditor powered by gh api graphql with four composable modes: open upstream PR/issue status triage (conflicts, CI, reviews, last commenter), fork and dangling branch hygiene (un-PR'd commits, empty branches, cleanup candidates), fuzzy discovery across PRs/issues/forks/stars, and public/private contribution impact ledgers. Use when checking upstream PR or issue status, finding a forgotten repo you contributed to or forked, cleaning up stale forks, or generating an OSS contribution report."
license: Apache-2.0
compatibility: Requires Node.js >= 20 and authenticated gh (GitHub CLI).
metadata:
  author: ghchinoy
  version: "1.0.0"
---

# Open Source Contribution Audit (`oss-contribution-audit`)

A read-only GitHub portfolio auditing skill built on `gh api graphql`. It avoids the truncation, secondary rate limits, and private-collaborator blind spots of `gh search` while exposing four distinct, composable audit modes backed by a single shared data cache.

## Bundled Resources

- `scripts/audit-contributions.mjs` — Zero-dependency Node.js CLI wrapping `gh api graphql` (and bounded REST compare calls for fork branches) with Markdown and `--json` output.
- [GitHub GraphQL Patterns & API Pitfalls](references/graphql-patterns.md) — Why GraphQL outperforms `gh search`, query page-sizing guardrails (`HTTP 502` avoidance), fork branch heuristics, and SSO/visibility caveats.
- [Contribution Triage Rubric & Follow-Up Playbook](references/triage-rubric.md) — Actionability buckets for open PRs/issues and dangling fork branches, privacy hygiene for public impact reports, and maintainer-etiquette guardrails.

---

## Four Composable Modes

Select one or more modes via `--mode <mode1[,mode2,...]>` (comma-separated or repeated `--mode`) or `--mode all`. All active modes share the same filters and reuse one GraphQL cache per invocation.

| Mode | Purpose | Key Signals Surfaced |
| :--- | :--- | :--- |
| **`open`** *(default)* | Open upstream status sweep | Open PRs (`needs-your-action` for merge conflicts, failing CI, `CHANGES_REQUESTED`, or maintainer replied last; `waiting-on-maintainer`; `draft`; `stale`) and open issues (`other-replied-last`, `awaiting-response`, `stale`). |
| **`forks`** | Fork & dangling branch audit | Non-default fork branches with `unprd-commits`, `empty-branch` (`+0` ahead with no PR), `active-pr-branch`, `already-in-upstream`, and `cleanup-candidate` forks. Automatically skips `snyk-fix-*` / `dependabot/*` / `renovate/*` bot branches unless `--include-bot-branches` is passed. |
| **`discover`** *(default if `--query` is set)* | Fuzzy "what was that project?" lookup | Case-insensitive regex/term search across external PRs (all states), issues (all states), fork repos & branch names, and starred repos (`--no-stars` to skip), ranked and grouped by repository. |
| **`impact`** | Contribution impact ledger | Merged/open/closed PRs, open/closed issues, distinct repos and orgs over a time window (`--since`, `--until`, `--days`), with an explicit **Public vs. Private** breakdown (`--public-only` for safe external sharing). |

### Cross-Mode Composition Bonus

When **`forks`** is composed with **`impact`** or **`discover`** (e.g., `--mode forks,impact` or `--mode all`), `scripts/audit-contributions.mjs` automatically cross-references cached historical merged/closed PRs against fork branch names. Squash-merged PR branches—which otherwise look `ahead_by > 0` in raw `git compare`—are accurately labeled `merged-pr-branch` or `closed-pr-branch` without spending extra REST compare calls.

---

## Shared Filters

All filters compose cleanly across every active mode:

- `--user <login>` — Target GitHub username (defaults to authenticated `gh` viewer).
- `--exclude-owner <csv>` — Exclude repos owned by specific users/orgs (self is always excluded unless `--include-self` is set).
- `--exclude-repo <csv>` — Exclude high-volume package registries or primary work repos (e.g., `microsoft/winget-pkgs`).
- `--public-only` / `--private-only` — Restrict scope by repository visibility.
- `--since <YYYY-MM-DD>` / `--until <YYYY-MM-DD>` / `--days <N>` — Time window filter (also enables early GraphQL pagination cutoff for `impact` and `forks`).
- `--stale-days <N>` — Inactivity threshold for flagging open items stale (default: `30`).
- `--format md|json` or `--json` — Choose Markdown summary or structured JSON for downstream reasoning.

---

## Workflow & Composition Recipes

### 1. Triage Open Upstream Work (`open`)

Check what needs your attention first (conflicts, CI failures, maintainer replies):

```bash
./scripts/audit-contributions.mjs --mode open --exclude-owner <work-org>
```

### 2. Weekly Maintenance Pass (`open,forks`)

Combine open upstream triage with dangling fork branch detection over the last 90 days:

```bash
./scripts/audit-contributions.mjs --mode open,forks --days 90 --exclude-repo microsoft/winget-pkgs
```

### 3. Find a Forgotten Project (`discover`)

When the user remembers a topic ("that architecture diagramming repo") but not the name, search across PRs, issues, fork branch names, and stars:

```bash
./scripts/audit-contributions.mjs --mode discover --query "diagram|graphviz|dot|mermaid"
```

Compose with `open` or `forks` if you also want live mergeability / ahead-behind context:

```bash
./scripts/audit-contributions.mjs --mode discover,forks --query "diagram|graphviz"
```

### 4. Quarterly / YTD Public OSS Impact Report (`impact,open`)

Generate a clean, shareable public-only ledger paired with currently open upstream items:

```bash
./scripts/audit-contributions.mjs --mode impact,open --since 2026-01-01 --public-only --exclude-repo microsoft/winget-pkgs --json
```

### 5. Full Portfolio Audit (`all`)

Run `open`, `forks`, and `impact` together (plus `discover` if `--query` is supplied) with automatic squash-merge branch cross-referencing:

```bash
./scripts/audit-contributions.mjs --mode all --since 2026-01-01 --exclude-repo microsoft/winget-pkgs
```

---

## Guardrails & Cross-Skill Handoffs

1. **Strictly read-only by default:** Never close PRs/issues, post maintainer pings, or delete forks/branches without presenting the triaged findings first and getting explicit user confirmation.
2. **Private-repo hygiene:** Always inspect `[private]` tags before quoting results externally; re-run with `--public-only` before producing any public report.
3. **Check local checkouts when `discover` finds nothing:** If an expected repo does not appear in GitHub API results, verify SSO authorization (see `references/graphql-patterns.md`), check local git remotes, or confirm whether a different GitHub account/host was used.
4. **Handoff to sibling skills (when the user approves follow-up actions):**
   - **Rebasing conflicted PRs or opening PRs from `unprd-commits` fork branches:** Delegate to `headless-fork-pr` (same plugin: `repo-authoring`).
   - **Turning an `impact` JSON ledger into a polished standalone HTML briefing:** Delegate to `editorial-report-artifact` (same plugin: `repo-authoring`).
