# GitHub GraphQL Patterns & API Pitfalls

This reference documents why `oss-contribution-audit` uses `gh api graphql` directly instead of `gh search` / REST search endpoints, and records operational limits encountered on real multi-year GitHub accounts.

## Why GraphQL Beats `gh search` for Contribution Audits

| Pitfall with `gh search` / REST Search | How GraphQL (`user(...)`) Solves It |
| :--- | :--- |
| **Self-repo flooding:** `--limit 100` is quickly exhausted by high-volume personal or work monorepos before older upstream contributions appear. | Cursor-paginated `user.pullRequests` and `user.issues` allow exact client-side filtering (`--exclude-owner`, `--exclude-repo`) and early date-window stopping (`orderBy: CREATED_AT DESC`). |
| **Private collaborator repo omission:** GitHub's REST search qualifier `-user:<login>` can silently drop private repositories where you are a collaborator. | `user.pullRequests` and `user.issues` return both public and private items visible to the token with explicit `repository.isPrivate` flags. |
| **Secondary rate limits (HTTP 403):** Paginating multiple REST `search/issues` queries quickly triggers GitHub's search abuse detector. | Standard GraphQL pagination uses the much larger primary GraphQL quota (`5,000` points/hour) and shares one cached pass across composed modes. |
| **Missing repository context:** REST issue search returns only `repository_url`, requiring N extra calls for descriptions and privacy flags. | Each PR/issue node includes `repository { nameWithOwner description isPrivate owner { login } }` in the same response. |
| **Invisible fork work:** Search never surfaces forks where a feature branch was pushed without opening an upstream PR. | `user.repositories(isFork: true)` returns parent linkage, `defaultBranchRef`, `pushedAt`, and branch `refs` in one query. |

## Query Sizing & Timeout Guardrails (`HTTP 502` Prevention)

GitHub computes certain GraphQL fields lazily during query execution. Requesting `first: 100` on expensive connections can exceed GitHub's server-side execution limit and return `HTTP 502`:

1. **Open PR enrichment (`OPEN_PRS_QUERY`):** Keep page size at `first: 25` because `mergeable`, `reviewDecision`, and `commits(last: 1) { statusCheckRollup }` trigger per-PR git mergeability and check-suite lookups.
2. **Fork branch scanning (`FORKS_QUERY`):** Keep page size at `first: 25` with `refs(refPrefix: "refs/heads/", first: 25)` and avoid nested `author { user { login } }` lookups inside bulk ref lists (which multiply into hundreds of user-resolution lookups per page).
3. **Lightweight full-history scans (`ALL_PRS_QUERY`, `ALL_ISSUES_QUERY`, `STARS_QUERY`):** Scalar-only fields safely paginate at `first: 100`.
4. **Transient retries:** Retry transient `HTTP 502`, `503`, `504`, and `ETIMEDOUT` errors with short backoff (`1s`, `2s`), failing fast rather than looping indefinitely.

## Fork Timestamp & Branch Ownership Semantics

- **Use `pushedAt`, not `updatedAt`, for fork recency:** GitHub bumps `updatedAt` on repository metadata changes (stars, settings, automated security alerts), causing decade-old forks to look recently modified. Ordering by `PUSHED_AT` accurately reflects real git activity and supports early cutoff with `--since`.
- **Inherited upstream branches:** Forking a large upstream repo copies its branches into the fork. Distinguish user-created work by checking:
  - Branch backs an open or historical PR (`headRefName` match), OR
  - Branch tip `oid` matches the fork's `defaultBranchRef` `oid` (empty branch created on the fork — detected with zero REST compare calls), OR
  - Branch `committedDate >= fork.createdAt - 60s`.
- **Automated bot branches:** Branches matching `^(snyk-fix-|dependabot/|renovate/)` are skipped by default in `forks` mode unless `--include-bot-branches` is passed.
- **Squash-merge false positives:** When upstream squash-merges a PR, the fork branch's original commit SHA is not an ancestor of upstream `main`, so `repos/<parent>/compare/<base>...<user>:<branch>` reports `ahead_by > 0`. Composing `--mode forks,impact` (or `--mode all`) resolves this automatically by cross-referencing cached historical PR `headRefName` entries and tagging them `merged-pr-branch` or `closed-pr-branch`.

## Visibility & Access Caveats

- **SAML SSO organizations:** If a token is not SSO-authorized for an organization, private repos in that org will be omitted without failing the GraphQL query. Verify SSO headers when auditing enterprise orgs:
  ```bash
  gh api -i "orgs/<org>/repos?per_page=1" 2>&1 | grep -i x-github-sso
  ```
- **Deleted or privatized upstream repos:** If an upstream maintainer deletes a repo or revokes collaborator access, historical PRs/issues in that repo are no longer returned by the API.
- **Multi-account / GHE hosts:** `audit-contributions.mjs` uses the active `gh` host and account (`gh auth status`). Pass `--user <login>` to inspect another user's public contributions, or set `GH_HOST` for GitHub Enterprise Server.
