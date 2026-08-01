# Agent Plugins Specification v1.0.0 — Normative Reference Summary

This reference summarizes the core rules of the Agent Plugins Specification v1.0.0 for quick lookup during migration, authoring, and validation.

## 1. Package Containment (§4.1)
- A plugin is a single directory rooted at a filesystem location.
- **Strict Containment:** Every path resolved by a client MUST remain within the plugin root directory.
- Symlinks, junctions, or relative paths escaping the plugin root (e.g. `../`) MUST be rejected by conformant clients.
- Symlinks pointing *inside* the plugin root are allowed.

## 2. Manifest (`plugin.json`) (§5)
- MUST exist at the plugin root: `plugin.json`.
- Closed schema: the only permitted top-level fields are `$schema`, `name`, `version`, `description`, `author`, `homepage`, `repository`, `license`, `keywords`, and `extensions`.
- `$schema` MUST be `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`.
- `name` MUST match `^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$` (1-64 chars, lowercase alphanumeric, hyphens, periods).
- Unknown top-level fields are reported and ignored by clients (non-fatal schema exception). Any other schema violation is fatal.

## 3. Fixed Component Discovery (§6, §7)
- **Skills Location:** `skills/<skill-name>/SKILL.md` (immediate children of `skills/` directory only; deep recursion is not performed).
- **MCP Location:** `mcp.json` at the plugin root only.
- Missing component locations (e.g. no `mcp.json` or no `skills/` dir) are non-fatal.

## 4. MCP Server Configuration (`mcp.json`) (§7.2, §9)
- `$schema` MUST be `https://agent-plugins.org/schemas/1.0.0/mcp.schema.json` (MUST match the version of `plugin.json`).
- `mcpServers` object contains server definitions (`type`: `"stdio"`, `"streamable-http"`, or `"sse"`).
- **Subprocess Environment Variables (§9.1):**
  - Clients set `PLUGIN_ROOT` (absolute path to plugin root) and `PLUGIN_DATA` (absolute path to client-managed persistent writable directory).
  - Server configuration `env` MUST NOT contain entries named `PLUGIN_ROOT` or `PLUGIN_DATA`.
- **Placeholder Expansion (§9.2):**
  - Text placeholders `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` are expanded in `args`, `env` values, and `cwd`.
  - Expansion does NOT apply to `command`, `env` keys, or fixed locations.

## 5. Agent Skills Frontmatter (§7.1, Agent Skills Spec)
- `SKILL.md` MUST begin with `---` YAML frontmatter.
- Required: `name` (1-64 chars, lowercase alphanumeric and hyphens; MUST match directory name), `description` (1-1024 chars).
- Optional: `license`, `compatibility` (1-500 chars), `metadata` (mapping), `allowed-tools`.
- Non-standard top-level fields (like top-level `version:`) MUST be nested under `metadata:`.
