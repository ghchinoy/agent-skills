---
name: scion-hub-admin
description: Diagnose Scion Hub AK1 authorization denials (403 Forbidden, CanDelegate, missing scopes), inspect role definitions and delegation ceilings, and execute zero-downtime agent token re-minting via Hub admin APIs. Requires the scion CLI, jq, and curl.
license: Apache-2.0
compatibility: Requires scion CLI, jq, curl, and bash.
metadata:
  author: ghchinoy
  version: "1.0.0"
---

# Scion Hub Administration & Authz Triage (`scion-hub-admin`)

This skill provides an operational playbook and executable tooling for troubleshooting Scion Hosted Hub authorization (`AK1` kernel), diagnosing `403 Forbidden` / `CanDelegate` denials on coordinator and manager agents, and executing zero-downtime JWT token re-minting across running agent containers.

## Prerequisites

1. **`scion` CLI installed and in `PATH`**:
   ```bash
   scion version
   ```
   *(If building from a local Scion checkout in a Git worktree, compile with `go build -buildvcs=false -o ./build/scion ./cmd/scion` and install to `PATH`.)*
2. **`jq` and `curl` available** for inspecting Hub Admin REST endpoints directly.

## Helper Scripts

- [`scripts/hub-authz-triage.sh`](scripts/hub-authz-triage.sh) — Read-only diagnostic script that inspects Role Definitions, running agent `.appliedConfig.agentRole`, and creation timestamps across all three authorization layers.
- [`scripts/hub-reset-auth.sh`](scripts/hub-reset-auth.sh) — Triggers zero-downtime token re-minting and hot-injection via `POST /api/v1/admin/agents/reset-auth-all` or per-agent `POST /api/v1/agents/{id}/reset-auth`.

---

## Workflow

### Step 1: Headless Hub Authentication & Token Extraction

In headless or remote environments where a local browser cannot open:

1. Start the device authorization login flow:
   ```bash
   scion hub auth login --hub-url https://<your-hub-domain>/ --no-browser
   ```
2. Present the displayed verification URL (`https://www.google.com/device`) and user code to the human operator.
3. Once authenticated, enable global Hub integration:
   ```bash
   scion hub enable --global --hub https://<your-hub-domain>/
   ```
4. Extract the bearer token from `~/.scion/credentials.json` for direct Hub Admin API queries:
   ```bash
   TOKEN=$(jq -r '.hubs["https://<your-hub-domain>/"].accessToken' ~/.scion/credentials.json)
   ```

---

### Step 2: The 3-Layer Authz Diagnosis Playbook

When a coordinator or engineering manager agent reports an error such as:
> `Cannot delegate agent authority you do not hold: agent lacks scope for delegation: project:template:write`

Run `./scripts/hub-authz-triage.sh --hub https://<your-hub-domain>/` or manually verify the three authorization layers:

#### Layer 1: Role Definition Check (`GET /api/v1/admin/roles`)
Verify that the built-in role (`agent-role-full` or `project-owner`) includes the required permission in the Hub database:
```bash
curl -s -H "Authorization: Bearer $TOKEN" "https://<your-hub-domain>/api/v1/admin/roles" | \
  jq '.items[] | select(.name == "agent-role-full") | {id, name, permissions}'
```

#### Layer 2: Delegation Ceiling & Role Bindings (`GET /api/v1/admin/role-bindings`)
Scion enforces a live delegation ceiling (`checkDelegationCeiling`): every agent's `.ancestry` chain traces back to a root user delegator (`ancestry[0]`). Verify the root user holds `super-admin` (system scope) or `project-owner` on the target project:
```bash
curl -s -H "Authorization: Bearer $TOKEN" "https://<your-hub-domain>/api/v1/admin/role-bindings" | \
  jq --arg uid "<root-user-id>" '.items[] | select(.principalId == $uid)'
```

#### Layer 3: Stale Running Container JWT (`GET /api/v1/agents?phase=running`)
Inspect the agent's stored role in `.appliedConfig.agentRole` and its `.created` timestamp:
```bash
curl -s -H "Authorization: Bearer $TOKEN" "https://<your-hub-domain>/api/v1/agents?phase=running&limit=100" | \
  jq '.agents[] | select(.template == "coordinator") | {id, name, project, role: .appliedConfig.agentRole, created}'
```
- **Root Cause of Stale Scopes**: When a new scope (such as `project:template:write`) is added to `ScopesForRole(AgentRoleFull)` in a Hub release, `CanDelegate` immediately requires parent agents creating sub-agents to hold that scope in their active JWT claims.
- Agents started **before** the Hub upgrade still hold their pre-upgrade JWT inside their container environment, even though `.appliedConfig.agentRole` is `"full"`.

---

### Step 3: Zero-Downtime Token Re-Minting (`reset-auth`)

To re-derive JWT scopes from each agent's stored `.appliedConfig.agentRole` (`ScopesForRole(role)`) and push fresh tokens into running containers **without restarting containers or losing session state**:

- **Bulk Re-Mint All Running Agents**:
  ```bash
  scripts/hub-reset-auth.sh --hub https://<your-hub-domain>/ --all
  ```
  *(Calls `POST /api/v1/admin/agents/reset-auth-all`)*

- **Targeted Re-Mint for a Specific Agent**:
  ```bash
  scripts/hub-reset-auth.sh --hub https://<your-hub-domain>/ --agent <agent-uuid>
  ```
  *(Calls `POST /api/v1/agents/<agent-uuid>/reset-auth`)*

---

### Step 4: Verification via AK1 Explain API

Verify that the agent principal passes kernel evaluation for the target action using `POST /api/v1/authz/explain`:

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "principalId": "<agent-uuid>",
    "principalKind": "agent",
    "resource": {"type": "template", "projectId": "<project-uuid>"},
    "action": "create"
  }' \
  "https://<your-hub-domain>/api/v1/authz/explain" | jq .
```
