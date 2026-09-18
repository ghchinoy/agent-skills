---
name: scion-agent-models
description: Audit fleet model configurations across Scion Hub projects, detect unpinned fallback drift (e.g. defaulting to expensive opus models), and live-patch running agent models without container restarts or loss of worktree state. Requires jq and curl.
license: Apache-2.0
compatibility: Requires scion CLI, jq, curl, and bash.
metadata:
  author: ghchinoy
  version: "1.0.0"
---

# Scion Fleet Model Assessment & Live-Patching (`scion-agent-models`)

This skill provides operational procedures, architectural guidelines, and executable scripts for auditing LLM model assignments across Scion Hub projects, identifying unpinned model fallbacks, and executing zero-downtime model patching across running agent containers.

---

## 1. Prerequisites

1. **`scion` CLI installed and authenticated**:
   ```bash
   scion hub auth login --hub-url https://<your-hub-domain>/ --no-browser
   ```
2. **`jq` and `curl` available** in `PATH`.
3. Cached credentials present in `~/.scion/credentials.json`.

---

## 2. Helper Scripts

- [`scripts/hub-model-audit.sh`](scripts/hub-model-audit.sh) — Audits all projects, their default annotations (`scion.io/default-model`, `scion.io/default-harness-config`), running agents, configured models, and effective models (including fallback detection).
- [`scripts/hub-model-patch.sh`](scripts/hub-model-patch.sh) — Live-patches `appliedConfig.model` on running agents via `PATCH /api/v1/agents/{id}` without restarting containers or losing session state.

---

## 3. Core Workflows

### Workflow 1: Fleet Model Audit & Drift Detection

To audit model assignments across all projects and agents:

```bash
# Full fleet audit:
./scripts/hub-model-audit.sh --hub https://<your-hub-domain>/

# Audit specific template role across projects (e.g. all coordinators):
./scripts/hub-model-audit.sh --hub https://<your-hub-domain>/ --template coordinator

# Audit specific project:
./scripts/hub-model-audit.sh --hub https://<your-hub-domain>/ --project <project-slug-or-id>

# Programmatic / JSON output:
./scripts/hub-model-audit.sh --hub https://<your-hub-domain>/ --json
```

#### What the Audit Checks
1. **Explicit vs. Unset Model**: Checks `appliedConfig.model`. If unset (`null`), identifies which harness default will take effect (e.g. `claude` harness container falls back to `opus`).
2. **Project Defaults**: Inspects `scion.io/default-model` and `scion.io/default-harness-config` annotations on the project.
3. **Identity Assignment**: Verifies assigned GCP Service Account and metadata mode (`assign` vs `block`), essential for Vertex AI prediction calls.

---

### Workflow 2: Zero-Downtime Live-Patching Running Agents

When an agent needs to switch models (e.g. moving a coordinator from unpinned `opus` to `claude-opus-4-8`, or switching worker agents to `gemini-3.8-flash` on Vertex):

#### A. Preview Changes (Dry-Run)
```bash
./scripts/hub-model-patch.sh --hub https://<your-hub-domain>/ \
  --template coordinator \
  --model claude-opus-4-8 \
  --dry-run
```

#### B. Patch a Single Agent by ID
```bash
./scripts/hub-model-patch.sh --hub https://<your-hub-domain>/ \
  --agent <agent-id> \
  --model claude-opus-4-8
```

#### C. Bulk Patch by Template Role
```bash
# Patch all running coordinators to claude-opus-4-8:
./scripts/hub-model-patch.sh --hub https://<your-hub-domain>/ \
  --all --template coordinator \
  --model claude-opus-4-8

# Patch all developers in a project to gemini-3.8-flash:
./scripts/hub-model-patch.sh --hub https://<your-hub-domain>/ \
  --project <project-slug> \
  --template developer \
  --model gemini-3.8-flash
```

---

### Workflow 3: Setting Persistent Defaults for Future Agents

To prevent newly created agents from drifting into unexpected harness defaults:

1. **Per-Role Template Defaults (Recommended)**:
   In `agent-team/templates/<role>/scion-agent.yaml`:
   ```yaml
   schema_version: "1"
   description: "..."
   agent_instructions: agents.md
   system_prompt: system-prompt.md

   default_harness_config: "claude"
   model: "claude-opus-4-8"
   ```
   Sync to Hub:
   ```bash
   scion template sync <role> --hub https://<your-hub-domain>/
   ```

2. **Project-Wide Default Model**:
   If templates leave `model` empty, set the baseline model for the project:
   ```bash
   curl -X PUT "https://<your-hub-domain>/api/v1/projects/<project-id>/settings" \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"default_model": "gemini-3.8-flash"}'
   ```
