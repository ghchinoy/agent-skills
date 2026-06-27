# Symptom → Cause → Fix Lookup

| Symptom | Likely Cause | Fix |
|---|---|---|
| `bd close`/`bd update` prints success but reverts on next command | Corrupt `.beads/backup/` → export fails → next command re-imports stale JSONL and reverts | `scripts/repair-corrupt-backup.sh` |
| `auto-backup failed ... table file not found` in dolt-server.log | Backup manifest references deleted table files | Move backup aside; let bd recreate it |
| `bd show X` disagrees with `.beads/issues.jsonl` | Export to JSONL is failing silently | `bd export -o .beads/issues.jsonl` after confirming Dolt state |
| Same corruption returns after a fresh `git clone` | `.beads/backup/` was committed to git | `git rm --cached -r .beads/backup/` and commit |
| `nothing to commit` warnings from Dolt | Benign — no pending Dolt changes | Ignore |
| "auto-importing into empty database" on every command | Normal bd behavior with `no-db = true` in `.beads/config.yaml` | Not a problem by itself |
| Only one write "sticks" per session | The import-revert loop | Batch writes, verify with `bd show`, then single `bd export` |
| `bd dolt status` shows server not running | Server crashed or never started | `bd dolt start` |
| Stale `.beads/dolt-server.pid`/`.port` cause connection errors | Runtime files tracked/leftover | Untrack them; restart server |

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
