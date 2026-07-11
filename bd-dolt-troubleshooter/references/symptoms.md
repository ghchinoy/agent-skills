# Symptom → Cause → Fix Lookup

| Symptom | Likely Cause | Fix |
|---|---|---|
| `refusing to auto-apply N pending schema migrations to a remote-backed database (vX -> vY): migrating clones independently forks the schema` | A newer bd version opened the DB (e.g., watcher app, agent) but cannot safely apply migrations because a Dolt remote is configured — doing so would fork the schema across clones | Run `bd migrate schema` on the **primary host** to apply migrations, then `bd dolt push` to propagate to the remote. Clones must `bd dolt pull` before opening with the new version. See **Schema Version Skew** below. |
| `column "content_hash" could not be found in any table in scope` in dolt-server.log | A client is querying columns added in a newer schema version that has not been migrated yet (symptom of the above migration block) | Apply pending migrations: `bd migrate schema && bd dolt push`, then restart any reader/watcher using the new bd version |
| `bd doctor`: `schema version mismatch: database is at vX, binary knows up to vY (N migrations ahead)` | **Inverse skew** — your bd binary is OLDER than a DB another agent/machine already migrated forward. Reads warn, writes fail. NOT corruption. | **Upgrade the client binary** to match the DB (`go install github.com/steveyegge/beads/cmd/bd@main`; see CGO/ICU note). Do NOT `bd migrate` on the old binary. See **Schema Version Skew — Client BEHIND the Database**. |
| `failed to record event: record event in events: Error 1105 (HY000): Field 'id' doesn't have a default value` on any `bd update`/`bd close` | The old binary is writing to a newer `events`-table schema it doesn't understand (inverse schema skew) | Upgrade the client binary to match the DB version (see above) |
| `go install` of bd fails: `fatal error: 'unicode/regex.h' file not found` | Recent bd pulls `dolthub/go-icu-regex` (CGO) which needs ICU C++ headers | `ICU="$(brew --prefix icu4c)"; CGO_CFLAGS="-I$ICU/include" CGO_CPPFLAGS="-I$ICU/include" CGO_LDFLAGS="-L$ICU/lib" go install github.com/steveyegge/beads/cmd/bd@main` |
| "I upgraded bd but `bd --version` still shows the old version" | `go install` wrote to `~/go/bin` but PATH `bd` is a stale copy elsewhere (e.g. `~/.local/bin/bd`) | `cp ~/go/bin/bd "$(which bd)" && hash -r`; verify `which bd && bd --version` |
| `daemon-error` file contains "DATABASE MISMATCH DETECTED" | Repo ID in DB doesn't match current git remote (bd upgrade, URL change, or copied `.beads/`) | `bd migrate --update-repo-id --yes`; if mismatch persists after reinit, it may already be resolved — check `bd list` |
| Any bd command fails with "hyphens are not allowed in embedded mode" | `dolt_database` contains hyphens; embedded mode forbids them | Switch to server mode: `bd init --server --reinit-local --database <name> --non-interactive` |
| `bd dolt show` reports `Mode: embedded` but `.beads/dolt/` contains data | bd was upgraded or re-initialized without `--server`; engine mode is wrong | `bd init --server --reinit-local --database <name> --server-port <port> --non-interactive --skip-hooks --skip-agents`; find `<name>` with `ls .beads/dolt/` and `<port>` in `.beads/dolt/config.yaml` |
| `bd close`/`bd update` prints success but reverts on next command | Corrupt `.beads/backup/` → export fails → next command re-imports stale JSONL and reverts | `scripts/repair-corrupt-backup.sh` |
| `auto-backup failed ... table file not found` in dolt-server.log | Backup manifest references deleted table files | Move backup aside; let bd recreate it |
| `bd show X` disagrees with `.beads/issues.jsonl` | Export to JSONL is failing silently | `bd export -o .beads/issues.jsonl` after confirming Dolt state |
| Same corruption returns after a fresh `git clone` | `.beads/backup/` was committed to git | `git rm --cached -r .beads/backup/` and commit |
| `nothing to commit` warnings from Dolt | Benign — no pending Dolt changes | Ignore |
| "auto-importing into empty database" on every command | Normal bd behavior with `no-db = true` in `.beads/config.yaml` | Not a problem by itself |
| Only one write "sticks" per session | The import-revert loop | Batch writes, verify with `bd show`, then single `bd export` |
| `bd dolt status` shows server not running | Server crashed or never started | `bd dolt start` |
| Stale `.beads/dolt-server.pid`/`.port` cause connection errors | Runtime files tracked/leftover | Untrack them; restart server |
| `server started (PID N) but not accepting connections … timeout` + log repeats `database "dolt" is locked by another dolt process` | Another `dolt sql-server` holds the single exclusive write lock (another project, or a bind-mounted `.beads/` shared by host + container) | `scripts/find-dolt-server.sh` to isolate this repo's server by CWD; `bd dolt stop` (scoped); clear stale runtime files; `bd dolt start`. See recovery-playbook Case F |

## Distinguishing real corruption from normal noise

These are **normal** and not problems on their own:
- `auto-importing N bytes ... into empty database`
- `auto-imported N issues`
- Dolt `nothing to commit` warnings

These indicate **real** problems:
- `table file not found`
- `auto-backup failed: sync to backup`
- `bd show` vs JSONL mismatch
- writes that revert
- `refusing to auto-apply N pending schema migrations to a remote-backed database`
- `column "X" could not be found in any table in scope` (schema version skew)
- `schema version mismatch: database is at vX, binary knows up to vY` (inverse skew — client behind DB)
- `Field 'id' doesn't have a default value` on writes (inverse skew — old binary writing newer `events` schema)
