---
name: ai-pop-visual-designer
description: Sub-skill for generating cohesive album cover art and track illustrations using NanoBanana.
license: Apache-2.0
---

# AI Pop Visual Designer

This skill coordinates the generation of cohesive visual artwork.

## Instructions

1. **Formulate Imagery Parameters:**
   * Ensure prompts use detailed art styles (e.g., *"detailed lofi illustration, watercolor and ink, retro gradient, synthwave vibe"*) and embed the artist's primary and secondary color tokens.
2. **Generate Cover Art:**
   * Invoke `nanobanana_image_generation` with a `1:1` aspect ratio to produce `album_art.png`.
3. **Generate Track Illustrations:**
   * Generate an illustration for each track in the tracklist, saved as `track[N]_art.png`.
4. **Compression & Formatting:**
   * Verify that output files are standard PNG/JPG files and reside in the root of the project directory.
