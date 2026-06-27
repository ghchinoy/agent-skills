# Recovery Playbook (Harder Cases)

Use this when the standard repair (`scripts/repair-corrupt-backup.sh`) isn't
enough — e.g. Dolt and JSONL have genuinely diverged, or writes were lost.

## Case A: Dolt is correct, JSONL is stale

The Dolt DB has your latest changes (`bd show` is right) but `issues.jsonl`
is behind.

```bash
bd export -o .beads/issues.jsonl
# verify, then commit
```

This is the common case. The export regenerates JSONL from the authoritative
Dolt state.

## Case B: JSONL is correct, Dolt is stale/reverted

A write was lost in Dolt but `issues.jsonl` still reflects the intent (rare),
or you want to reset Dolt to match the committed JSONL.

```bash
bd dolt stop
# bd re-imports issues.jsonl into the working DB on next command
bd dolt start
bd list --status open   # triggers import; confirm state
```

If Dolt still doesn't match, re-apply the specific mutations and verify each
with `bd show` *before* exporting.

## Case C: Both diverged — reconcile by intent

Neither layer is fully right. Treat your **intended** end-state as truth.

1. Repair the backup first (`scripts/repair-corrupt-backup.sh`) so writes stop
   reverting.
2. For each affected issue, set the intended state explicitly:
   ```bash
   bd close <id> --reason "..."      # or
   bd update <id> --priority N --title "..."
   ```
3. After **each** write, verify it landed in Dolt:
   ```bash
   bd show <id> --json | python3 -c "import json,sys;d=json.load(sys.stdin);i=d[0] if isinstance(d,list) else d;print(i['status'],i['priority'])"
   ```
4. Once all are correct in Dolt, export once and diff:
   ```bash
   bd export -o .beads/issues.jsonl
   git diff .beads/issues.jsonl
   ```

## Case D: Restore from a bd backup snapshot

If the Dolt DB is unrecoverable:

```bash
bd backup list                 # see available snapshots
bd backup restore <snapshot>   # restore the DB
bd export -o .beads/issues.jsonl
```

Note: `bd backup` snapshots are distinct from the `.beads/backup/` Dolt backup
target that causes the corruption — don't confuse them.

## Prevention checklist

- [ ] `.beads/backup/` is **not** in `git ls-files`
- [ ] `.beads/dolt-server.*` are **not** in `git ls-files`
- [ ] `.beads/.gitignore` contains `backup/`, `dolt-server.pid`, `dolt-server.port`, `dolt-server.lock`
- [ ] CI/agents run `bd export -o .beads/issues.jsonl` before committing bd changes
- [ ] After bulk bd operations, diff `issues.jsonl` before `git commit`
