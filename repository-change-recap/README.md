# Repository Change Recap Skill

The `repository-change-recap` skill enables Gemini CLI to generate structured, high-quality summaries of repository changes over a specified time window. 

## Features
- Fetches commits using `git log --stat` to analyze actual files changed.
- Groups changes logically based on repository-specific rules.
- Generates a Markdown recap file.
- Optionally generates an audio narration of the recap using TTS and FFmpeg tools.

## Per-Repository Rules (CRITICAL)
To customize how changes are categorized for a specific repository, create a `.gemini/recap-rules.md` file in the root of that target repository (or include a "Recap Instructions" section in its `GEMINI.md`). 

The skill is programmed to read this file *before* generating the recap to understand how to bucket the changes based on file paths.

### Example `.gemini/recap-rules.md`
```markdown
# Recap Rules

1. **Core Application**: Any changes outside of the `experiments/` directory. Look for version bumps in `pyproject.toml`.
2. **MCP Servers**: Changes within `experiments/mcp-genmedia/`. Check for Go module version bumps.
3. **Other Experiments**: Changes in `experiments/<name>/`.
```

## Usage
Once installed, ask Gemini CLI to:
> "Generate a repository change recap for the last week."
> "Create a repository change recap for the previous week with audio."

You can also update your `~/.gemini/commands/recap.toml` macro to utilize this skill:
```toml
description = "Generates a weekly commit recap"
prompt = "Generate a repository change recap for {{args}}. If --with-audio is provided, generate an audio narration."
```
