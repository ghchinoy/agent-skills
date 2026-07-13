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

---

## Case G: Schema version skew — remote-backed database refuses auto-migration

A newer bd binary (watcher, agent, second machine) cannot open the database
because pending schema migrations exist but the database has a Dolt remote, so
auto-applying would fork the schema across clones.

Error signature:
```
refusing to auto-apply N pending schema migrations to a remote-backed database
(vX -> vY): migrating clones independently forks the schema (#4259)
```
Secondary symptom in `dolt-server.log` — recurring every poll interval:
```
error running query ... error="column "<col>" could not be found in any table in scope"
```

**Recovery:**

1. On the **primary** host (where the main bd server runs):
   ```bash
   # BD_ALLOW_REMOTE_MIGRATE=1 is REQUIRED — without it, bd migrate schema
   # silently no-ops because the gate fires first ("Schema already at vX").
   BD_ALLOW_REMOTE_MIGRATE=1 bd migrate schema   # apply vX → vY
   bd migrate --inspect                           # confirm Schema Version is now vY
   bd dolt push                                   # push to remote
   ```

2. On **every other clone** (including the watcher machine):
   ```bash
   bd dolt pull               # pull migrated schema
   ```

3. Restart the watcher / newer-version bd client. The SQL errors stop and the
   client opens successfully.

**If `bd migrate schema` itself fails** (the server is stuck or the schema is
partially applied):
```bash
bd dolt stop
bd dolt start
BD_ALLOW_REMOTE_MIGRATE=1 bd migrate schema --verbose   # retry with detail
```

**Upgrade order rule:** always migrate-and-push on the primary before updating
any secondary client to a newer bd version.

---

## Case H: Schema version skew — client binary is BEHIND the database (inverse of G)

The mirror image of Case G, and the more common one in a multi-agent setup:
another agent/machine already migrated the shared database **forward**, and
your bd binary is now **older** than the schema. bd auto-migrates a shared DB
on first touch by a newer client, which strands every older client on it.

Error signature (`bd doctor`):
```
schema version mismatch: database is at v53, binary knows up to v49
(4 migrations ahead)
```
Reads succeed with a warning; **writes fail**:
```
failed to record event: record event in events:
Error 1105 (HY000): Field 'id' doesn't have a default value
```
`scripts/diagnose.sh` reports the Dolt-vs-JSONL check as `dolt=?` (the old
binary can't read the newer schema).

**Recovery — upgrade the stranded client to match the DB (never downgrade the DB):**

1. **First: identify what the installed binary actually is.** `bd --version`
   is not sufficient — a build from local source shows the same version string
   as the published tag but may be commits ahead. Use the authoritative check:
   ```bash
   go version -m "$(which bd)"
   # Look for the `mod` line, e.g.:
   #   mod  github.com/steveyegge/beads  v1.1.1-0.20260711070917-64a136d56e8a
   # A pseudo-version (v1.x.x-0.YYYYMMDDHHMMSS-<hash>) means it was built
   # from a commit not on any tag. "(dev)" in bd --version output is also a
   # red flag that the binary came from a local source tree.
   ```

2. Find the target version — the one that migrated the DB forward. Check all
   agents/machines sharing the DB. If the migrating binary was a dev build,
   its pseudo-version is the target:
   ```bash
   go list -m -versions github.com/steveyegge/beads   # tagged releases only
   go list -m github.com/steveyegge/beads@main         # current main-tip pseudo-version
   # Or read it directly from the binary that migrated:
   go version -m /path/to/that/bd
   ```

3. Reinstall bd at that version. Recent bd needs ICU (CGO) and a newer Go
   toolchain:
   ```bash
   ICU="$(brew --prefix icu4c)"        # or icu4c@<N>, e.g. icu4c@78
   CGO_CFLAGS="-I$ICU/include" CGO_CPPFLAGS="-I$ICU/include" \
   CGO_LDFLAGS="-L$ICU/lib" \
     go install github.com/steveyegge/beads/cmd/bd@<version-or-pseudo-version>
   ```
   (Failure `fatal error: 'unicode/regex.h' file not found` = ICU flags not set.)

4. Sync the PATH copy — `go install` writes `~/go/bin/bd`; if your PATH `bd`
   is elsewhere (e.g. `~/.local/bin/bd`), copy it or you'll keep running the
   old one:
   ```bash
   cp ~/go/bin/bd "$(which bd)" && hash -r
   go version -m "$(which bd)"    # verify the module version, not just --version
   ```

5. Verify + converge:
   ```bash
   bd doctor                       # mismatch gone
   bd update <id> --append-notes "skew fixed"   # a real write now succeeds
   bd dolt push                    # if the new binary applied a pending migration
   ```

**Do NOT** run `bd migrate` on the old binary — it cannot apply (or write
against) a schema version it doesn't know.

**Read-only stopgap** if you can't upgrade yet: `bd --ignore-schema-skew <cmd>`
lets the old binary *read* the newer DB; it does not fix writes.

**Prevention (multi-agent):** all agents/machines sharing one bd database must
run compatible binaries. Before migrating a shared DB forward, confirm the
others can upgrade to match, or you strand them. Add `bd doctor` as a session
preflight so the skew surfaces before you rely on writes.

---

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
- [ ] All agents/machines sharing one bd database run compatible bd versions —
      "compatible" means the same module pseudo-version hash, verified with
      `go version -m "$(which bd)"`, not just `bd --version` (which is unreliable
      for dev/local builds that show a tag version string but are commits ahead)
- [ ] `(dev)` in `bd --version` output triggers a `go version -m "$(which bd)"`
      check before any operation that could migrate a shared database
- [ ] `bd doctor` is run as a session preflight (catches schema skew before writes)
