---
name: ai-pop-audio-synthesizer
description: Sub-skill for composing high-fidelity music tracks via Google DeepMind Lyria and verifying container formats.
license: Apache-2.0
---

# AI Pop Audio Synthesizer

This skill handles the synthesis and verification of music audio assets.

## Instructions

1. **Invoke Lyria 3 Pro:**
   * Call `lyria_generate_music` with the target prompt, setting the output directory and naming scheme (`track[N].wav`).
   * **Robust Model Fallback:** If `lyria-3-pro-preview` encounters API response issues or rate limits, immediately fallback and retry using `lyria-3-clip-preview` or `lyria-002` to ensure consistent and uninterrupted synthesis.
2. **Verify Stream Container:**
   * Run the shell `file` command to check the underlying container encoding (e.g. `file track1.wav`).
   * **CRITICAL:** If the tool reports that the file contains an MPEG layer III (MP3) stream, **rename the file extension to `.mp3`** (e.g. `track1.mp3`) instead of saving it as a `.wav`. This ensures browser decoding compatibility.
3. **Format Check:**
   * Verify the file exists, has a non-zero size, and matches the configuration expected by the Go compiler.
