# Agent Skills

Welcome to the `agent-skills` repository. This repository contains a collection of specialized expertise, procedural workflows, and task-specific capabilities formatted according to the [Agent Skills](https://agentskills.io) open standard.

Agent Skills provide **on-demand expertise** without cluttering an AI model's immediate context window. When an agent identifies a task that matches a skill's description, it can autonomously load the detailed instructions and resources from the `SKILL.md` file.

## Available Skills

### 🥩 Grill with Beads (`grill-with-beads`)
Grilling session that challenges your plan, sharpens the work breakdown, and updates the beads (bd) issue tracker inline as decisions crystallise. Use when you want to stress-test a plan and translate it directly into actionable, tracked bd tasks and dependencies. Based off of Matt Pocock's [grill-with-docs](https://github.com/mattpocock/skills) to use Steve Yegge's [beads](https://github.com/gastownhall/beads).

### 🩺 bd / Dolt Troubleshooter (`bd-dolt-troubleshooter`)
Diagnose and repair [beads (`bd`)](https://github.com/gastownhall/beads) issue-tracker problems caused by its Dolt backend — including engine-mode mismatches (embedded vs server), DATABASE MISMATCH repo-ID errors, database name incompatibilities, and the "auto-backup failed / table file not found" corruption that silently reverts writes. Use when `bd` won't start, a `daemon-error` file is present, updates don't persist, or you see Dolt backup/sync errors.

### 🔄 Repository Change Recap (`repository-change-recap`)
Generates a structured weekly or custom timeframe commit recap for a repository. Looks for repository-specific categorization rules in `.gemini/recap-rules.md` or `GEMINI.md` before fetching git logs via `git log --stat` to accurately organize changes (e.g., core vs experiments). Supports optional audio generation.

### 📜 Changelog Manager (`changelog-manager`)
Generates, updates, and curates a `CHANGELOG.md` file adhering to Keep a Changelog v1.1.0 and Common Changelog specifications by analyzing `bd` issue history and `git` commit history.

### 🖥️ Agent-Aware CLI Design (`agent-aware-cli`)
Guide for designing and implementing command-line interfaces (CLIs) that are equally usable by human developers and automated coding agents. Covers idiomatic Go with Cobra and Viper, machine-readable output, structured error codes, and flag conventions that agents can reliably parse. Use when building or refactoring a CLI.

### 🛡️ MCP Security Auditor (`mcp-auditor`)
Audits local Model Context Protocol (MCP) server configurations (e.g., Gemini CLI, Claude Desktop, Cursor) and custom-built MCP servers for Remote Command Execution (RCE) and supply chain vulnerabilities. It focuses on identifying dangerous STDIO transport injections and malicious prompt injections as detailed in the [OX Security Advisory](https://www.ox.security/blog/mcp-supply-chain-advisory-rce-vulnerabilities-across-the-ai-ecosystem/).

*(Note: See the `sample-reports/` directory for an example of the security audit report this skill can produce.)*

### 🖥️ macOS HIG: Layout & Window Management (`macos-hig-layout`)
Guidelines and assistance for creating macOS applications compliant with Apple's Human Interface Guidelines. Focuses on proper usage of large displays, ergonomics, multiple window states, and idiomatic SwiftUI `.windowResizability` limits.

### ⌨️ macOS HIG: Interaction & System Features (`macos-hig-interaction`)
Guidelines for integrating deeply with macOS system features. Focuses on comprehensive Menu Bar implementations (via SwiftUI `.commands`), Dock context menus, and handling high-precision inputs like `.onHover` and `.onContinuousHover`.

### 🔎 macOS HIG: Compliance Reviewer (`macos-hig-reviewer`)
A comprehensive macOS code and design reviewer that analyzes a project against Apple's Human Interface Guidelines. Evaluates ergonomics, window behavior, system integration, and accessibility. Also includes custom `SwiftLint` rules to enforce idiomatic macOS architectures and flags unsupported iOS-only patterns.

### 🎤 AI Pop: Producer (Primary Orchestrator) (`ai-pop-producer`)
Primary orchestrator skill for creating concept-driven AI Pop Artists. Coordinates sub-skills to generate artist profiles, album narratives, lyrics, cover art, track compositions, and local web-player dashboards.

### 📝 AI Pop: Concept Planner (`ai-pop-concept-planner`)
Drafts virtual artist backstories, mini-albums, theme-based color palettes, track metadata, and lyrics.

### 🎹 AI Pop: Audio Synthesizer (`ai-pop-audio-synthesizer`)
Composes high-fidelity music tracks via Google DeepMind Lyria and performs stream container format verification.

### 🎨 AI Pop: Visual Designer (`ai-pop-visual-designer`)
Generates cohesive album cover art and individual track illustrations using NanoBanana.

### ⚙️ AI Pop: Compiler (`ai-pop-compiler`)
Validates the artist.json metadata contract, copies files, compiles TypeScript/Vite templates, and verifies static client builds using an embedded Go CLI scaffolder.

### ✍️ Technical Post Editorial (`technical-post-editorial`)
Edit technical blog posts to remove AI writing patterns and preserve human voice. Targets developer-facing posts, migration guides, and engineering write-ups — tightening structure, eliminating hedging language, and keeping the author's original tone intact. Use when reviewing or polishing a technical blog post draft.

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

## Using with Antigravity CLI (`agy`)

These skills are fully compatible with the official [Antigravity CLI](https://antigravity.google/docs/skills). They can be loaded into your interactive terminal sessions to equip your assistant with specialized capabilities.

### 1. Install the Antigravity CLI

If you don't have the CLI (`agy`) installed yet, run the appropriate command for your platform:

*   **macOS / Linux:**
    ```bash
    curl -fsSL https://antigravity.google/cli/install.sh | bash
    ```
*   **Windows (PowerShell):**
    ```powershell
    irm https://antigravity.google/cli/install.ps1 | iex
    ```

Ensure that `agy` is in your shell's `PATH`.

### 2. Add Skills to your Environment

You can install these skills at either the global level or project level:

#### Option A: Global Scope (Available in All Workspaces)
To make these skills available everywhere, copy the skill directories into your global Antigravity configuration folder:

```bash
# Create the global skills folder if it doesn't exist
mkdir -p ~/.gemini/antigravity-cli/skills/

# Copy the skills into the global folder
cp -R /path/to/agent-skills/ai-pop-* ~/.gemini/antigravity-cli/skills/
```

#### Option B: Project-Level Scope (Available in Current Workspace)
To use these skills only inside a specific project, copy them into the `.agents/skills/` directory of your project workspace:

```bash
# Navigate to your target project folder
cd /path/to/your/project

# Create the project-level agents/skills directory
mkdir -p .agents/skills/

# Copy the skills into your project
cp -R /path/to/agent-skills/ai-pop-* .agents/skills/
```

### 3. Verify Installed Skills

To verify that your skills have been correctly loaded and recognized by the CLI, run:

```bash
agy inspect
```

This will display a list of all discovered and active skills, plugins, and hooks.

### 4. Interactive Usage

Once loaded, the skills are active in your interactive sessions. If you ask the agent a question or assign a task that matches a skill's description (for example, "scaffold a new virtual artist profile"), the agent will automatically activate the relevant skill.

For more details on skill authoring, configuration, and advanced commands, refer to the official [Antigravity Documentation](https://antigravity.google/docs/skills).

