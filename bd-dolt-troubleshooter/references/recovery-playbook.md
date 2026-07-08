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

## Case E: Engine mode mismatch (embedded when server data exists)

`bd dolt show` reports `Mode: embedded` but `.beads/dolt/` contains an existing
server-mode database. bd won't start properly, or throws "hyphens are not allowed
in embedded mode" errors.

1. Find the existing database name and configured port:
   ```bash
   ls .beads/dolt/                        # directory name = database name
   grep "port:" .beads/dolt/config.yaml   # server port
   ```

2. Re-init into server mode, preserving all server data:
   ```bash
   bd init --server --reinit-local \
     --database <db-name> \
     --server-port <port> \
     --non-interactive \
     --skip-hooks --skip-agents
   ```
   bd will auto-start a Dolt server pointed at the existing `.beads/dolt/` data.
   If it picks a different port than configured, pin it afterward:
   ```bash
   # find the new port
   bd dolt status
   # optionally pin it in config.yaml for team consistency
   # dolt: port: <N>
   ```

3. If a repo ID mismatch remains (daemon-error still present):
   ```bash
   bd migrate --update-repo-id --yes
   ```

4. Clean up the stale daemon-error file:
   ```bash
   rm -f .beads/daemon-error
   ```

5. Verify all issues are accessible:
   ```bash
   bd list --all
   bd dolt show   # should report Mode: per-project and ✓ Server connection OK
   ```

## Case F: Multiple `dolt sql-server` processes — lock contention across projects

**Symptom.** `bd dolt start` (or auto-start) fails with:
```
server started (PID N) but not accepting connections on port … : timeout
```
and `.beads/dolt-server.log` shows repeated:
```
database "dolt" is locked by another dolt process; either clone the database to
run a second server, or stop the dolt process which currently holds an exclusive
write lock on the database
```
Dolt takes a **single exclusive filesystem write lock** per data directory. This
bites in two situations:
- **Bind-mounted `.beads/` shared between two machines** (e.g. a host + a
  container both mounting the same workspace): only ONE server may run against it,
  on *either* machine. bd's per-project auto-start is not cross-machine-aware.
- **One machine running many projects at once**: each project has its own
  `dolt sql-server`, so you must not blanket-kill them — killing another project's
  server disrupts that project's bd state.

**Do NOT `kill` all `dolt sql-server` processes.** Isolate the one bound to *this*
project's `.beads/` directory. The reliable discriminator is each server's
**current working directory (CWD)**, not its port (ports here are ephemeral).

### 1. Identify the server that owns THIS project (prints PID + path together)

macOS / BSD (`lsof`):
```bash
for pid in $(pgrep -f "dolt sql-server"); do
  cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
  printf 'PID %s\t%s\n' "$pid" "$cwd"
done
```
Linux (`/proc`, no lsof needed):
```bash
for pid in $(pgrep -f "dolt sql-server"); do
  printf 'PID %s\t%s\n' "$pid" "$(readlink -f /proc/$pid/cwd)"
done
```
The target is the PID whose path is under **this repo's** `.beads/`. A bundled
helper does exactly this and highlights the match:
```bash
scripts/find-dolt-server.sh            # lists all; marks the one for CWD's repo
```

### 2. Stop only that server (prefer the scoped command)

From the project root, `bd dolt stop` acts on **this project's** server only —
it will not touch other projects' servers:
```bash
bd dolt stop
```
Re-run the PID+path loop to confirm no remaining process points at this repo's
`.beads/`. Only if a truly orphaned process survives, `kill <that-PID>` — the
*specific* PID you identified, never a blanket kill.

> **Trap: `bd dolt stop` can report "server is not running" while the process is
> still alive.** When the server was auto-started (or started outside bd's
> management) and this shell has `BEADS_DOLT_AUTO_START=false`, bd does not treat
> it as *its* managed server, so `bd dolt stop` prints
> `Error: dolt server is not running` **even though the `dolt sql-server` process
> is still holding the lock.** Do not trust that message — **always re-verify by
> PID** (`pgrep -af 'dolt sql-server'` or the PID+path loop) and `kill` the
> specific orphan. Observed live: an auto-started server survived `bd dolt stop`
> and only died on `kill <PID>` (SIGTERM was sufficient; escalate to `kill -9`
> only if it persists). After killing, `pgrep`'s own command line may match the
> pattern — confirm you're not seeing a false positive from the grep/pgrep itself.

### 3. Clear stale runtime files and start the single owner

These are machine-local and never committed (safe to remove):
```bash
rm -f .beads/dolt-server.lock .beads/dolt-server.port \
      .beads/dolt-server.info .beads/dolt-server.pid
bd dolt start
bd dolt status
```

### Cross-machine coordination (bind-mount case)

If the `.beads/` is bind-mounted into a container, don't run a second server
there — pick ONE owner (usually the host) and make the other side Dolt-free
(`BEADS_DOLT_AUTO_START=false`), reading issues from `.beads/issues.jsonl`
directly. See the project's `AGENTS.md` for the full host/container runbook.

## Prevention checklist

- [ ] `.beads/backup/` is **not** in `git ls-files`
- [ ] `.beads/dolt-server.*` are **not** in `git ls-files`
- [ ] `.beads/.gitignore` contains `backup/`, `dolt-server.pid`, `dolt-server.port`, `dolt-server.lock`
- [ ] CI/agents run `bd export -o .beads/issues.jsonl` before committing bd changes
- [ ] After bulk bd operations, diff `issues.jsonl` before `git commit`
- [ ] On any machine that must stay Dolt-free (the non-owning side of a
      bind-mounted `.beads/`, e.g. a container), `BEADS_DOLT_AUTO_START=false` is
      exported **in the current shell**, not just in `/etc/environment`. A `bd`
      command in a shell that missed the env var can auto-start a server and steal
      the lock. Set it explicitly: `export BEADS_DOLT_AUTO_START=false` before
      running `bd`, and prefer reading state from `.beads/issues.jsonl` directly.
