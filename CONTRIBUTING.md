# Contributing to Agent Skills & Plugins

Thank you for contributing! This repository is organized as a collection of **Agent Plugins** conforming to the [Agent Plugins Specification v1.0.0](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json) and housing **Agent Skills** conforming to the [Agent Skills Specification](https://agentskills.io).

## Repository Architecture

```text
agent-skills/
├── plugins/
│   └── <plugin-name>/
│       ├── plugin.json               # Required plugin manifest
│       ├── mcp.json                  # Optional MCP server definitions
│       └── skills/
│           └── <skill-name>/
│               ├── SKILL.md          # Required skill metadata & instructions
│               ├── scripts/          # Optional executable helper scripts
│               ├── references/       # Optional documentation & guides
│               └── assets/           # Optional templates and static assets
├── .claude-plugin/
│   └── marketplace.json             # Discovery index for Claude Code / npx skills
└── scripts/
    └── validate-plugins.sh           # Local & CI validation script
```

## Creating a New Plugin or Skill

1. **New Plugin:**
   - Create `plugins/<plugin-name>/plugin.json` targeting `$schema`: `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`.
   - Ensure `name` matches the directory name `<plugin-name>`.

2. **New Skill:**
   - Place your skill in `plugins/<plugin-name>/skills/<skill-name>/SKILL.md`.
   - Ensure the YAML frontmatter includes `name` (matching `<skill-name>`), `description` (under 1024 characters), `license: Apache-2.0`, and `metadata.version`.
   - Any helper scripts in `scripts/` must be executable (`chmod +x`).

3. **Validation:**
   Run the validation script locally before submitting a pull request:
   ```bash
   ./scripts/validate-plugins.sh
   ```
