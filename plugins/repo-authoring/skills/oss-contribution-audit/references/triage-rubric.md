# Contribution Triage Rubric & Follow-Up Playbook

Use this rubric to interpret output from `scripts/audit-contributions.mjs` and recommend concrete, safe next actions.

## 1. Open Pull Request Buckets (`open` mode)

| Bucket | Trigger Signals | Recommended Action |
| :--- | :--- | :--- |
| **`needs-your-action`** | `mergeable == CONFLICTING`, `ciState` is `FAILURE`/`ERROR`, `reviewDecision == CHANGES_REQUESTED`, or another user commented last. | **Act first.** Rebase onto upstream `main` (delegate to `headless-fork-pr` if in a headless/sandbox environment), fix failing checks, or reply to maintainer feedback. |
| **`waiting-on-maintainer`** | Not draft, no conflicts/CI failures/requested changes, updated within `--stale-days`. | **No urgent action.** Monitor; avoid premature pings. |
| **`draft`** | `isDraft == true`. | Decide whether to finish and mark ready for review, or close if abandoned. |
| **`stale`** | Clean PR with no updates for `>= --stale-days` (default 30). | Check if upstream moved on or fixed the issue elsewhere. If still relevant, rebase and post one concise, polite check-in; otherwise close cleanly to reduce maintainer queue noise. |

## 2. Open Issue Buckets (`open` mode)

| Bucket | Trigger Signals | Recommended Action |
| :--- | :--- | :--- |
| **`other-replied-last`** | Another user or maintainer posted the most recent comment. | Read the latest comment; provide repro details, confirm whether a fix worked, or close if resolved. |
| **`awaiting-response`** | Updated within `--stale-days`, no external reply yet (or you replied last). | Hold; check if a companion PR should be linked. |
| **`stale`** | No updates for `>= --stale-days`. | Verify whether the bug still reproduces on current `main` before bumping or closing. |

## 3. Fork & Dangling Branch Buckets (`forks` mode)

| Branch Status | Meaning | Recommended Action |
| :--- | :--- | :--- |
| **`unprd-commits`** | Non-default branch has `ahead_by > 0` commits vs upstream and no matching open (or cached historical) PR. | Inspect the diff (`gh api repos/<parent>/compare/<base>...<user>:<branch>`). Either open the upstream PR (delegate to `headless-fork-pr`) or confirm it was an old squash-merged branch by re-running with `--mode forks,impact`. |
| **`empty-branch`** | Non-default branch points to the exact same commit as the fork's default branch (`ahead_by == 0`). | Likely an idea started and abandoned before committing. Decide whether to resume work or delete the branch. |
| **`active-pr-branch`** | Branch currently backs an open upstream PR. | Keep until the PR merges or closes. |
| **`merged-pr-branch`** | Matched a `MERGED` PR from cached history (`--mode forks,impact` or `--mode all`). | Safe to delete branch on fork (after explicit user confirmation). |
| **`closed-pr-branch`** | Matched an unmerged `CLOSED` PR from cached history. | Safe to delete branch unless you plan to reopen. |
| **`already-in-upstream`** | `ahead_by == 0` against upstream default branch. | Safe to delete branch on fork. |
| **`unchecked-branch`** | Skipped because upstream is archived or `--max-fork-checks` budget was reached. | Raise `--max-fork-checks` or narrow with `--since` if you need exact ahead/behind counts. |

### Fork-Level Statuses
- `has-open-pr` — Keep active.
- `has-unprd-commits` — Review before deleting or archiving.
- `has-empty-branch` — Review abandoned branch, then clean up.
- `cleanup-candidate` — No open PRs and no un-PR'd branches; candidate to sync or delete once the user confirms.

## 4. Privacy Hygiene for Impact Reports (`impact` mode)

Before pasting or publishing an `impact` ledger externally (blog post, performance review, open-source portfolio, or `editorial-report-artifact` report):

1. Re-run with `--public-only` so private collaborator repositories are completely excluded from totals and tables.
2. Exclude automated package-registry mirrors or internal orgs if they skew genuine upstream counts (for example, `--exclude-repo microsoft/winget-pkgs` or `--exclude-owner <work-org>`).
3. Double-check that no `[private]` tags appear anywhere in the rendered output.

## 5. Safety & Mutation Guardrails

- **Read-only by default:** Never run `gh pr close`, `gh issue close`, `gh pr comment`, `gh repo delete`, or `git push --delete` during an audit pass.
- **Confirm before every write:** Present the triaged list grouped by bucket, let the user select specific items, and execute mutations only after explicit approval.
- **Maintainer etiquette:** When nudging a stale upstream PR, keep it to one concise comment after rebasing and verifying CI passes; never mass-ping maintainers in a loop.
