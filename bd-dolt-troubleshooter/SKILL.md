---
name: bd-dolt-troubleshooter
description: Diagnose and repair beads (bd) issue-tracker problems caused by its Dolt backend — including engine-mode mismatches (embedded vs server), database name incompatibilities, DATABASE MISMATCH repo-ID errors, the "auto-backup failed / table file not found" corruption that silently reverts writes, lock contention from multiple `dolt sql-server` processes (across projects or host/container), the hook-timeout stash-wipe that destroys untracked files on commit, orphaned dolt sql-server process leaks, and schema version skew in BOTH directions — a newer bd client refusing to auto-apply migrations to a remote-backed database, AND an older client stranded behind a database another agent/machine already migrated forward (bd doctor reports "database is at vX, binary knows up to vY (N migrations ahead)" and writes fail with "Field 'id' doesn't have a default value"). Use when bd won't start, a daemon-error file is present, bd updates don't persist, issues.jsonl is out of sync with bd show output, untracked files vanish after a commit, you see lock errors/connection issues, you see Dolt backup/sync errors, a watcher/agent fails with "refusing to auto-apply N pending schema migrations", or bd writes fail after a colleague/agent upgraded the shared database.
license: Apache-2.0
compatibility: Requires the `bd` (beads) CLI and a repo with a `.beads/` directory using the Dolt backend. Diagnostic scripts are POSIX sh; tested on macOS and Linux.
metadata:
  author: ghchinoy
  version: "1.4"
---

# bd / Dolt Troubleshooter

`bd` (beads) stores issues in a Dolt database under `.beads/` and exports them to
`.beads/issues.jsonl` (the file committed to git). Most operational failures come
from a mismatch between four layers:

0. **Engine mode** — embedded (in-process) or server (external `dolt sql-server`).
   Mode controls which data directory is used and which database name constraints
   apply. Everything else depends on this being correct. Check with `bd dolt show`.
1. **Dolt server** — the live database (`.beads/dolt/` in server mode, `.beads/embeddeddolt/` in embedded mode)
2. **JSONL export** — `.beads/issues.jsonl` (git source of truth)
3. **Auto-backup** — `.beads/backup/` (a local Dolt backup target)

## The Signature Failure: Writes Silently Revert

**Symptom:** You run `bd close X` or `bd update X`, bd prints success, but the
change is gone on the next command. `bd show X` and `.beads/issues.jsonl`
disagree, or both revert to the old state.

**Tell-tale log line** (in `.beads/dolt-server.log`):
```
auto-backup failed: sync to backup: sync backup backup_export:
Error 1105 (HY000): error opening table file: table file not found:
.beads/backup/<hash>
```

### Root-cause chain

1. The `.beads/backup/` Dolt backup is **corrupt** — its `manifest` references
   table files that no longer exist on disk.
2. On every invocation bd **auto-imports** `issues.jsonl` into a working DB
   ("auto-importing into empty database").
3. After a write, bd tries to **export** to `issues.jsonl` and **sync to backup**.
   The backup sync fails, and the export does not land.
4. The **next** bd command auto-imports the now-stale `issues.jsonl`, which
   **reverts** the previous write before applying the new one.

The result is a write-rollback loop where only one change "sticks" at a time and
even that is unreliable.

### Why it recurs across clones

If `.beads/backup/` was ever committed to git (despite being listed in
`.beads/.gitignore`), the corruption travels with the repo. Git honors tracking
over `.gitignore`, so a file added before the ignore rule stays tracked.

## The Hook-Timeout Stash-Wipe (untracked files vanish after a commit)

**Symptom:** Untracked files (drafts, new posts, uncommitted work) disappear from the
working tree after a `git commit`. `git stash list` shows a new stash with message
`WIP on <branch>: <hash> <msg>`. The untracked files are in `stash@{0}^3`.

**Root-cause chain:**

1. bd's git hooks (pre-commit, post-commit, etc.) run `bd hooks run …` on every commit.
2. bd's sync does a `git stash -u` (includes untracked files) to get a clean tree for
   Dolt ref work.
3. The hook runs under a `timeout` (default 30s). If Dolt sync takes longer, the
   timeout fires, the hook prints "continuing without beads" and exits — **without
   popping the stash**.
4. The working tree stays at the stashed state: untracked files are gone, tracked files
   are reverted to HEAD.

**Identify:** Check whether the stash was bd-caused (has an untracked section):
```bash
git stash list            # look for unexpected stash@{0}
git ls-tree -r --name-only stash@{0}^3 2>/dev/null  # non-empty = -u stash, likely bd
```

**Immediate recovery:** restore untracked files from the stash without disturbing
anything committed since:
```bash
# Restore individual files from the untracked tree (stash@{0}^3)
git show stash@{0}^3:<path/to/file> > <path/to/file>
# Or restore all untracked files at once (safe if working tree is clean):
git checkout stash@{0}^3 -- .
# Then drop the stash once everything is confirmed on disk and committed:
git stash drop stash@{0}
```

**Permanent fixes (apply both):**

Fix 1 — Raise the hook timeout in your shell profile so the stash-and-pop completes
before the timeout bails:
```bash
# ~/.zshrc or ~/.bashrc
export BEADS_HOOK_TIMEOUT=120   # was 30; 2 min covers slow Dolt sync
```

Fix 2 — In repos where beads is unused (no issues, no `issues.jsonl`, no remote),
disable the hooks entirely — they add no value and carry real risk:
```bash
cd .git/hooks
for h in pre-commit post-commit post-checkout post-merge pre-push prepare-commit-msg; do
  [ -f "$h" ] && mv "$h" "$h.disabled"
done
```
Detect an unused beads repo: `bd dolt show` shows embedded mode with no remote, and
`bd list` returns "No issues found" with no `issues.jsonl` on disk.

Reverse: `for h in *.disabled; do mv "$h" "${h%.disabled}"; done`

**Check all repos for bd-caused orphaned stashes:**
```bash
for dir in $(find ~/projects -maxdepth 1 -type d); do
  [ -d "$dir/.git" ] || continue
  stash=$(git -C "$dir" stash list 2>/dev/null)
  [ -z "$stash" ] && continue
  # Check for untracked section (^3) which indicates a -u stash
  while IFS= read -r entry; do
    ref=$(echo "$entry" | grep -o 'stash@{[0-9]*}')
    has_untracked=$(git -C "$dir" ls-tree -r --name-only "$ref^3" 2>/dev/null)
    [ -n "$has_untracked" ] && echo "bd-stash candidate: $dir  $entry"
  done <<< "$stash"
done
```

---

## The Orphaned dolt sql-server Process Leak

**Symptom:** `ps aux | grep "dolt sql-server"` shows multiple processes (each
80–160 MB RAM) on different ports. Memory usage grows across the day.

**Root cause:** Each beads repo in server mode spawns a `dolt sql-server` instance.
If the bd daemon exits uncleanly (timeout, SIGKILL, machine sleep) without sending
SIGTERM to its server, the process is orphaned. Repeated bd invocations across many
repos accumulate leaked servers.

**Identify and reap:**
```bash
# Count
pgrep -c -f "dolt sql-server"

# Reap gracefully (SIGTERM allows Dolt to flush)
pkill -TERM -f "dolt sql-server"
sleep 3
pgrep -c -f "dolt sql-server"   # should be 0; if not, use SIGKILL
```

Servers restart automatically on the next `bd` command in each repo. No data is lost
from a clean SIGTERM.

---

## Schema Version Skew (remote-backed database migration block)

**Symptom:** A newer bd version (e.g., a watcher app, agent tool, or second machine)
fails to open the database with:
```
Failed to open beads database: failed to initialize schema: refusing to auto-apply
N pending schema migrations to a remote-backed database (vX -> vY):
migrating clones independently forks the schema (#4259)
```
Simultaneously, `dolt-server.log` fills with recurring errors like:
```
error running query ... error="column "content_hash" could not be found in any table in scope"
```

**Root-cause:**

bd added schema migrations (new columns, tables, etc.) between the version the
database was last migrated on and the version the new client was built against.
The new client refuses to apply those migrations automatically because the
database has a Dolt **remote** configured (`bd dolt show` shows a remote URL).
Applying migrations locally without pushing would leave the remote at the old
schema, so any other clone pulling from the remote would get mismatched data —
a schema fork.

The old server (the running `dolt sql-server`) continues serving the old schema.
Any client querying for columns from the new schema (like `content_hash`) gets
SQL errors on every poll.

**Fix — apply once on primary, push, then pull on all clones:**

```bash
# 1. On the machine with the running bd server (primary):
bd migrate schema          # applies vX → vY migrations idempotently
bd dolt push               # push migrated schema + data to remote

# 2. On every other clone (including the machine running the watcher):
bd dolt pull               # pull the migrated schema from remote

# 3. Restart the watcher / newer-version bd client
#    It will now open successfully at the new schema version.
```

**Verify the migration landed:**
```bash
bd migrate --inspect        # Schema Version should match the new bd binary version
bd doctor                   # should pass schema checks
```

**Why the watcher error recurs every 30s:** The watcher is likely running a
keep-alive or polling loop. Each iteration hits the missing-column SQL error and
logs it. The errors stop once the migration is applied and the watcher is
restarted.

**Prevention:**

- Before upgrading bd on any machine that has a watcher, agent, or second-machine
  clone reading the same Dolt remote: apply `bd migrate schema && bd dolt push`
  on the primary first, then update the secondary.
- Add `bd migrate --inspect` to CI/release gates to catch schema drift before it
  reaches clones.
- Keep all bd clients (CLI, watcher, agent) on the same version, or upgrade in
  primary-first order.

---

## Schema Version Skew — Client BEHIND the Database (the inverse case)

The section above is a *newer* client blocked from migrating an *older* DB.
This is the mirror image, and it is the more likely one in a multi-agent
setup: your bd binary is **older** than a database another agent/machine
already migrated **forward**.

**Symptom:**
```
bd doctor
  ⚠ ... schema version mismatch: database is at v53, binary knows up to v49
    (4 migrations ahead)
```
Reads mostly succeed (with the warning), but **every write fails**:
```
Error updating <id>: failed to record event: record event in events:
Error 1105 (HY000): Field 'id' doesn't have a default value
```
`scripts/diagnose.sh` shows the Dolt-vs-JSONL check reporting `dolt=?` for
issues (the old binary cannot read the newer schema, so status comes back
unknown while JSONL still has the real state).

**Root cause (a multi-agent coordination hazard):** bd auto-migrates a
shared Dolt database forward the first time a newer client touches it. Once
that happens, every *older* client on the same DB is stranded — it can read
past the skew but cannot write against the changed schema (e.g., the `events`
table's `id` column changed between versions). This is not corruption and it
is not fixable with `bd migrate` on the old binary: a v49 binary cannot
apply — or write against — a v53 schema it doesn't know.

**Fix — upgrade the stranded client to match the DB (do NOT downgrade the DB):**

1. Identify the newest bd across all agents/machines sharing the DB. The
   build that migrated it is the one to match (check `go list -m
   github.com/steveyegge/beads@main` for the current tip pseudo-version, or
   the latest tag with `go list -m -versions github.com/steveyegge/beads`).
2. Reinstall bd from source at that version:
   ```bash
   go install github.com/steveyegge/beads/cmd/bd@main   # or @vX.Y.Z
   ```
   **CGO/ICU gotcha (recent bd):** the build pulls `dolthub/go-icu-regex`,
   which needs the ICU C++ header `unicode/regex.h`. If it fails with
   `fatal error: 'unicode/regex.h' file not found`, point CGO at a local ICU:
   ```bash
   ICU="$(brew --prefix icu4c)"        # or icu4c@<N>, e.g. icu4c@78
   CGO_CFLAGS="-I$ICU/include" CGO_CPPFLAGS="-I$ICU/include" \
   CGO_LDFLAGS="-L$ICU/lib" \
     go install github.com/steveyegge/beads/cmd/bd@main
   ```
   Recent bd also requires a newer Go toolchain (it auto-switches, e.g. to
   go1.26.x, if `go >= 1.26.2` is declared).
3. **Sync every copy of the binary on your PATH.** `go install` writes to
   `~/go/bin`; if your PATH `bd` is elsewhere (e.g. `~/.local/bin/bd`), copy
   it: `cp ~/go/bin/bd ~/.local/bin/bd && hash -r`. A stale second copy is a
   classic "I upgraded but it's still the old version" trap — verify with
   `which bd && bd --version`.
4. Verify: `bd doctor` no longer reports the mismatch, and a real write
   (`bd update <id> --append-notes "..."`) succeeds. After the new binary
   applies any pending migration it may prompt `Run bd dolt push` — push so
   other clones converge.

**Read-only stopgap** if you cannot upgrade immediately: the global flag
`--ignore-schema-skew` ("proceed despite forward schema drift; some queries
may fail") lets the old binary read the newer DB. It does **not** fix writes
(the `events` schema mismatch still bites) — it only buys time to read.

**Prevention (multi-agent):** all agents/machines sharing one bd database
MUST run compatible bd binaries. Before an agent migrates a shared DB forward,
confirm the others can be upgraded to match; otherwise you strand them. A
session preflight of `bd doctor` catches the skew before you rely on writes.

---

## Quick Diagnosis

**Start here — four commands before anything else:**

```bash
# 1. Reveal engine mode, data directory, and server connection status
bd dolt show

# 2. Let bd self-diagnose and suggest fixes
bd doctor

# 3. Check schema version and pending migrations (especially after a bd upgrade
#    or when a watcher/agent fails to open the database)
bd migrate --inspect

# 4. Read the cached failure reason if bd won't start at all
cat .beads/daemon-error 2>/dev/null
```

Then run the bundled diagnostic for deeper checks (read-only, safe):

```bash
scripts/diagnose.sh
```

It checks, in order:
- Engine mode and whether a `daemon-error` file is present
- Dolt server status and recent backup errors in the log
- Whether `.beads/backup/` or `dolt-server.*` runtime files are git-**tracked**
  (they should not be)
- Whether `bd show` (Dolt) agrees with `.beads/issues.jsonl` for a sample issue
- Whether the backup `manifest` references missing table files

## Repair

Run the repair (makes changes — review first, commit after):

```bash
scripts/repair-corrupt-backup.sh
```

What it does:
1. `bd dolt stop`
2. Moves the corrupt `.beads/backup/` aside to `.beads/backup.corrupt.<ts>/`
3. `bd dolt start` (bd recreates a fresh, valid backup)
4. `git rm --cached` any tracked `.beads/backup/*` and `dolt-server.*` files so
   `.gitignore` finally takes effect
5. Deletes the moved-aside corrupt copy
6. Forces a clean export: `bd export -o .beads/issues.jsonl`

After repair, **verify** before committing (see below), then:
```bash
git add .beads/issues.jsonl
git commit -m "chore(bd): untrack corrupt dolt backup; resync issues.jsonl"
```

## The Golden Rules

1. **JSONL is the source of truth for git.** After any batch of bd writes, run
   `bd export -o .beads/issues.jsonl` and diff it before committing.
2. **Never commit `.beads/backup/` or `.beads/dolt-server.*`.** They are
   machine-local. If they show in `git ls-files`, untrack them.
3. **Verify, don't trust, the success message.** bd printing "Closed X" is not
   proof of persistence during a corruption episode. Re-read with `bd show X`
   *and* grep the JSONL.
4. **Batch writes, then one export.** Because each command re-imports JSONL,
   apply all mutations, confirm Dolt state with `bd show`, then export once.
5. **Commit before bd operations.** Untracked files are the most vulnerable to
   the hook-timeout stash-wipe. If a file matters, commit it before running
   anything that triggers a git hook.
6. **Set `BEADS_HOOK_TIMEOUT=120` in your shell profile.** The 30s default is
   too short for Dolt sync on slow or cold connections and causes orphaned stashes.
7. **Disable hooks in repos where beads is unused.** An empty beads repo (no
   issues, no JSONL, no remote) with active hooks is a net liability. Detect with
   `bd list` and `bd dolt show`; disable as shown above.

## Manual Verification Snippet

Confirm Dolt and JSONL agree for specific issues:

```bash
for id in a2ac-d9l a2ac-aqj; do
  dolt=$(bd show "$id" --json 2>/dev/null \
    | python3 -c "import json,sys;d=json.load(sys.stdin);i=d[0] if isinstance(d,list) else d;print(i['status'])")
  jsonl=$(python3 -c "
import json
for l in open('.beads/issues.jsonl'):
    if l.strip():
        i=json.loads(l)
        if i['id']=='$id': print(i['status'])")
  echo "$id  dolt=$dolt  jsonl=$jsonl  $([ "$dolt" = "$jsonl" ] && echo OK || echo MISMATCH)"
done
```

## Lock Contention: Multiple `dolt sql-server` Processes

**Symptom:** `bd dolt start` reports `server started (PID N) but not accepting
connections … timeout`, and `.beads/dolt-server.log` repeats `database "dolt" is
locked by another dolt process`. Dolt allows only **one** server per data
directory (a single exclusive write lock). This happens when many projects each
run a server, or a bind-mounted `.beads/` is shared by a host + container.

**Never blanket-kill `dolt sql-server` — you'd disrupt other projects.** Isolate
the server bound to *this* repo by its working directory:

```bash
scripts/find-dolt-server.sh          # lists all servers with PID + CWD; marks THIS repo's
```

Then stop only that one (`bd dolt stop` from the repo root is scoped to this
project), clear stale runtime files, and start the single owner. Full steps:
`references/recovery-playbook.md` → **Case F**. For the bind-mount host/container
variant, one machine owns the server and the other stays Dolt-free — see the
project `AGENTS.md`.

## Related References

- `references/symptoms.md` — symptom → cause → fix lookup table
- `references/recovery-playbook.md` — step-by-step recovery for harder cases
  (lost writes, divergent Dolt vs JSONL, restoring from `bd backup`, and
  multi-server lock contention in Case F)
- `scripts/find-dolt-server.sh` — read-only: list all `dolt sql-server` PIDs with
  their working dirs and flag the one owning the current repo's `.beads/`
