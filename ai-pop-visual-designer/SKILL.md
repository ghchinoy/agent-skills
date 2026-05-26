---
name: ai-pop-visual-designer
description: Sub-skill for generating cohesive album cover art and track illustrations using NanoBanana.
license: Apache-2.0
---

# AI Pop Visual Designer

This skill coordinates the generation of cohesive visual artwork.

## Dependencies & Requirements

This skill relies on the `nanobanana_image_generation` tool from the Google GenMedia MCP suite.
*   **If missing or inactive:** Follow the [install-mcp-genmedia](https://github.com/GoogleCloudPlatform/vertex-ai-creative-studio/tree/main/experiments/mcp-genmedia/skills/install-mcp-genmedia) skill to download, install, and register the pre-compiled server binaries, then reload your agent session.

## Instructions

1. **Formulate Imagery Parameters:**
   * Ensure prompts use detailed art styles (e.g., *"detailed lofi illustration, watercolor and ink, retro gradient, synthwave vibe"*) and embed the artist's primary and secondary color tokens.
2. **Generate Cover Art:**
   * Invoke `nanobanana_image_generation` with a `1:1` aspect ratio to produce `album_art.png`.
   * **Multimodal Fallback:** If `nanobanana` tool calls fail due to daemon connection closed or invalid request errors, immediately fallback to the platform's native asset generation tool:
     - Invoke the `generate_image` tool, embedding the color palette hex tokens.
     - Copy the resulting image from the brain/artifacts directory into the artist root directory as `album_art.png`.
3. **Generate Track Illustrations:**
   * Generate an illustration for each track, saved as `track[N]_art.png`.
   * Use the same `generate_image` fallback if `nanobanana` is unavailable, copying the generated artifact to `track[N]_art.png`.
4. **Compression & Formatting:**
   * Verify that output files are standard PNG/JPG files and reside in the root of the project directory.
