# Agent Skills

Welcome to the `agent-skills` repository. This repository contains a collection of specialized expertise, procedural workflows, and task-specific capabilities formatted according to the [Agent Skills](https://agentskills.io) open standard.

Agent Skills provide **on-demand expertise** without cluttering an AI model's immediate context window. When an agent identifies a task that matches a skill's description, it can autonomously load the detailed instructions and resources from the `SKILL.md` file.

## Available Skills

### 🔄 Repository Change Recap (`repository-change-recap`)
Generates a structured weekly or custom timeframe commit recap for a repository. Looks for repository-specific categorization rules in `.gemini/recap-rules.md` or `GEMINI.md` before fetching git logs via `git log --stat` to accurately organize changes (e.g., core vs experiments). Supports optional audio generation.

### 🛡️ MCP Security Auditor (`mcp-auditor`)
Audits local Model Context Protocol (MCP) server configurations (e.g., Gemini CLI, Claude Desktop, Cursor) and custom-built MCP servers for Remote Command Execution (RCE) and supply chain vulnerabilities. It focuses on identifying dangerous STDIO transport injections and malicious prompt injections as detailed in the [OX Security Advisory](https://www.ox.security/blog/mcp-supply-chain-advisory-rce-vulnerabilities-across-the-ai-ecosystem/).

*(Note: See the `sample-reports/` directory for an example of the security audit report this skill can produce.)*

---

## How to Get these Skills via Gemini CLI

Gemini CLI makes it easy to discover and activate skills. You can install individual skills directly from this repository or link your local clone of this repository.

### 1. Install a Specific Skill Directly from GitHub

You can use the `gemini skills install` command to pull a specific skill without cloning the entire repository. This will install it into your global user scope (`~/.gemini/skills` or `~/.agents/skills`) so it is available across all workspaces:

```bash
gemini skills install https://github.com/ghchinoy/agent-skills.git --path mcp-auditor
```

### 2. Clone and Link the Entire Repository

If you prefer to have the repository available locally and link all skills at once, you can clone it and use `gemini skills link`:

```bash
# Clone the repository
git clone https://github.com/ghchinoy/agent-skills.git
cd agent-skills

# Link the skills to your personal user scope (available everywhere)
gemini skills link .

# OR link to the current workspace scope only (.gemini/skills)
gemini skills link . --scope workspace
```

### 3. Managing Skills

You can manage your discovered skills either from the terminal or inside an interactive Gemini CLI session.

**From the Terminal:**
```bash
# List all discovered skills across User, Workspace, and Extension tiers
gemini skills list

# Disable a specific skill
gemini skills disable mcp-auditor

# Enable a specific skill
gemini skills enable mcp-auditor

# Uninstall a skill
gemini skills uninstall mcp-auditor
```

**During an Interactive Gemini CLI Session:**
Use the `/skills` slash command to view and manage available expertise:
- `/skills list` : Shows all discovered skills and their status.
- `/skills reload` : Refreshes the list of discovered skills from all tiers.
- `/skills disable <name>` : Prevents a specific skill from being used.
- `/skills enable <name>` : Re-enables a disabled skill.

## How it Works
1. **Discovery:** When you start a Gemini CLI session, the CLI scans the discovery tiers and injects only the name and description of enabled skills into its system prompt.
2. **Activation:** If Gemini identifies a task that matches the skill's description (e.g., you ask to "audit my MCP configurations"), it calls the `activate_skill` tool.
3. **Consent:** You will see a confirmation prompt in the UI detailing the skill's purpose.
4. **Execution:** Upon your approval, the `SKILL.md` body is added to the conversation history, and the agent proceeds with the specialized expertise active!
