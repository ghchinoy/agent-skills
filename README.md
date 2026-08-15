# Agent Skills & Plugins

Welcome to the `agent-skills` repository. This repository packages specialized expertise, procedural workflows, and task-specific capabilities according to two open standards:
- **[Agent Plugins Specification v1.0.0](https://agent-plugins.org)** — Distributable plugin packages bundled under `plugins/`.
- **[Agent Skills Specification](https://agentskills.io)** — Modular `SKILL.md` instruction sets providing on-demand expertise without polluting the model's immediate context window.

---

## Available Plugins & Skills

The repository is organized into 7 thematic plugins under `plugins/`:

### 1. 🎤 AI Pop (`plugins/ai-pop`)
*Virtual music artist production suite: lore planning, audio synthesis, visual design, and web player compilation.*
- **`ai-pop-producer`** (Primary Orchestrator): Coordinates sub-skills to generate artist profiles, album narratives, lyrics, cover art, track compositions, and web players.
- **`ai-pop-concept-planner`**: Drafts virtual artist backstories, mini-albums, theme-based color palettes, track metadata, and lyrics.
- **`ai-pop-audio-synthesizer`**: Composes high-fidelity music tracks via Google DeepMind Lyria.
- **`ai-pop-visual-designer`**: Generates cohesive album cover art and individual track illustrations using NanoBanana.
- **`ai-pop-compiler`**: Validates `artist.json` metadata, compiles TypeScript/Vite templates, and verifies static client builds using an embedded Go CLI scaffolder.

### 2. 🖥️ macOS HIG (`plugins/macos-hig`)
*macOS Human Interface Guidelines assistance and code reviewers.*
- **`macos-hig-layout`**: Guidelines for displays, ergonomics, multiple window states, and idiomatic SwiftUI `.windowResizability` limits.
- **`macos-hig-interaction`**: Guidelines for Menu Bar implementations (via SwiftUI `.commands`), Dock context menus, and high-precision inputs like `.onHover`.
- **`macos-hig-reviewer`**: Analyzes projects against Apple's Human Interface Guidelines, including custom `SwiftLint` rules to enforce macOS architectures.

### 3. 🩺 Beads Workflow (`plugins/beads-workflow`)
*Tools and workflows for the beads (`bd`) Dolt-powered issue tracking ecosystem.*
- **`bd-dolt-troubleshooter`**: Diagnoses and repairs `bd` issue-tracker problems (engine-mode mismatches, repo-ID errors, corrupt auto-backups, lock contention, hook-timeout stash-wipes, and schema version skew). Includes diagnostic and repair scripts.
- **`grill-with-beads`**: Grilling session that challenges your plan, sharpens work breakdown, and updates the `bd` issue tracker inline as decisions crystallise.

### 4. 📚 Repository Authoring (`plugins/repo-authoring`)
*Repository management skills for technical writing, README generation, changelogs, and commit recaps.*
- **`make-readme`**: Creates, assesses, and improves `README.md` files against a weighted quality rubric or strict `standard-readme` spec compliance.
- **`technical-post-editorial`**: Edits technical blog posts to remove AI writing patterns while preserving the author's human voice.
- **`repository-change-recap`**: Generates structured weekly or custom timeframe commit recaps using `git log --stat` and per-repo categorization rules (`.gemini/recap-rules.md`).
- **`changelog-manager`**: Generates, updates, and curates `CHANGELOG.md` files adhering to Keep a Changelog v1.1.0 and Common Changelog specs.

### 5. 🛡️ MCP Security (`plugins/mcp-security`)
*Model Context Protocol (MCP) security auditing for RCE, STDIO injection, and supply chain vulnerabilities.*
- **`mcp-auditor`**: Audits local MCP server configurations (Gemini CLI, Claude Desktop, Cursor) and custom-built MCP servers for Remote Command Execution (RCE) and STDIO transport injection as detailed in the OX Security Advisory. *(Includes sample reports in `references/`)*.

### 6. ⚙️ Agent-Aware CLI (`plugins/agent-aware-cli`)
*Best practices for CLI tools optimized for both human users and AI agents.*
- **`agent-aware-cli`**: Architecture guide covering Cobra/Viper in Go, machine-readable output formats, structured error codes, and flag conventions that AI agents can parse reliably.

### 7. 🔌 Agent Plugin Authoring (`plugins/agent-plugin-authoring`)
*Authoring, migration, and linting tools for packaging Agent Skills into Agent Plugins v1.0.0 specification packages.*
- **`skills-to-plugins`**: Audits flat skills repositories for conformance debt, groups co-dependent skills, generates `plugin.json` and `.claude-plugin/marketplace.json` manifests, and enforces spec containment rules. Includes audit, validation, and template assets.

### 8. 📖 OKF Authoring (`plugins/okf-authoring`)
*Tool-agnostic authoring and validation for conformant Open Knowledge Format (OKF) v0.2 knowledge bundles, including the v0.2 provenance, trust, and lifecycle vocabulary.*
- **`okf-author`**: Authors a conformant OKF v0.2 bundle by hand or from a description — one concept per markdown file with a required non-empty `type`, a root `index.md` declaring `okf_version`, bundle-relative links as relationship edges, and correct trust frontmatter (derives trust tiers, never stores a credibility score). Includes a complete example bundle.
- **`okf-validate`**: Checks §11 conformance and trust-signal well-formedness, reporting everything as advisories and never rejecting a bundle for optional, unknown, or broken content. Works fully by hand; opportunistically shells to `okfcli`/`binder`/`factile`/`openknowledge` when installed.

---

## Installation & Usage

### Installing via Open Agent Skills CLI (`npx skills`)

The [Open Agent Skills CLI](https://github.com/vercel-labs/skills) works natively with this repository via `.claude-plugin/marketplace.json`:

```bash
# List available skills in the repository
npx skills add ghchinoy/agent-skills --list

# Install a specific skill (e.g., mcp-auditor)
npx skills add ghchinoy/agent-skills --skill mcp-auditor

# Install all skills to your project
npx skills add ghchinoy/agent-skills --all
```

### Using via Gemini CLI

```bash
# Install a specific skill directly from GitHub
gemini skills install ghchinoy/agent-skills --path plugins/beads-workflow/skills/bd-dolt-troubleshooter

# Clone and link locally
git clone https://github.com/ghchinoy/agent-skills.git
gemini skills link ./agent-skills/plugins/beads-workflow/skills/bd-dolt-troubleshooter
```

### Using via Antigravity CLI (`agy`)

Copy or link the desired plugin or skill directory into your workspace:
```bash
# Global scope
cp -R plugins/ai-pop/skills/* ~/.gemini/antigravity/skills/

# Project scope
cp -R plugins/ai-pop/skills/* .agents/skills/
```

---

## Repository Validation

To run local validation across all plugin manifests (`plugin.json`), skill frontmatter (`SKILL.md`), executable script bits, and marketplace indexing:

```bash
./scripts/validate-plugins.sh
```

---

## License

This repository is licensed under the [Apache License 2.0](LICENSE).
