---
name: bd-dolt-troubleshooter
description: Diagnose and repair beads (bd) issue-tracker problems caused by its Dolt backend — including engine-mode mismatches (embedded vs server), database name incompatibilities, DATABASE MISMATCH repo-ID errors, the "auto-backup failed / table file not found" corruption that silently reverts writes, and lock contention when multiple `dolt sql-server` processes (across projects, or a bind-mounted .beads/ shared by host + container) fight over the single exclusive write lock. Use when bd won't start, a daemon-error file is present, bd updates don't persist, issues.jsonl is out of sync with bd show output, you see "database locked by another dolt process" / "server started but not accepting connections", or you see Dolt backup/sync errors.
license: Apache-2.0
compatibility: Requires the `bd` (beads) CLI and a repo with a `.beads/` directory using the Dolt backend. Diagnostic scripts are POSIX sh; tested on macOS and Linux.
metadata:
  author: ghchinoy
  version: "1.1"
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

## Quick Diagnosis

**Start here — three commands before anything else:**

```bash
# 1. Reveal engine mode, data directory, and server connection status
bd dolt show

# 2. Let bd self-diagnose and suggest fixes
bd doctor

# 3. Read the cached failure reason if bd won't start at all
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
