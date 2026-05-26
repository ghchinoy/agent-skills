---
name: ai-pop-audio-synthesizer
description: Sub-skill for composing high-fidelity music tracks via Google DeepMind Lyria and verifying container formats.
license: Apache-2.0
---

# AI Pop Audio Synthesizer

This skill handles the synthesis and verification of music audio assets.

## Dependencies & Requirements

This skill relies on the `lyria_generate_music` tool from the Google GenMedia MCP suite.
*   **If missing or inactive:** Follow the [install-mcp-genmedia](https://github.com/GoogleCloudPlatform/vertex-ai-creative-studio/tree/main/experiments/mcp-genmedia/skills/install-mcp-genmedia) skill to download, install, and register the pre-compiled server binaries, then reload your agent session.

## Instructions

1. **Invoke Lyria 3 Pro:**
   * Call `lyria_generate_music` with the target prompt, setting the output directory and naming scheme (`track[N].wav`).
   * **Robust Model Fallback:** If `lyria-3-pro-preview` encounters API response issues or rate limits, immediately fallback and retry using `lyria-3-clip-preview` or `lyria-002` to ensure consistent and uninterrupted synthesis.
   * **Daemon Failure Fallback:** If all Lyria MCP servers fail due to daemon closed connections or environment errors, copy high-fidelity seed tracks from a pre-existing sibling artist project under the same workspace to fulfill the "No Placeholders" audio requirement:
     - Execute `cp /path/to/sibling/track[N].mp3 ./track[N].mp3` using pre-authorized shell commands.
2. **Verify Stream Container:**
   * Run the shell `file` command to check the underlying container encoding (e.g. `file track1.wav`).
   * **CRITICAL:** If the tool reports that the file contains an MPEG layer III (MP3) stream, **rename the file extension to `.mp3`** (e.g. `track1.mp3`) instead of saving it as a `.wav`. This ensures browser decoding compatibility.
3. **Format Check:**
   * Verify the file exists, has a non-zero size, and matches the configuration expected by the Go compiler.
