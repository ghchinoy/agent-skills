// site.config.mjs — the few site-wide constants that BOTH astro.config.mjs and
// the content config need, written once so they cannot drift apart.
//
// `BASE` in particular: project GitHub Pages serve from a sub-path, so every
// hand-built URL the loader emits must carry the prefix. Astro and Starlight
// make their own links base-aware given `base`; the loader's rewrites are the
// only URLs built by hand, and they take this value as an option rather than
// repeating the literal (proposal §10.4).

/** Origin for the built site. */
export const SITE = "https://ghchinoy.github.io";

/** The project-Pages sub-path. Written HERE and nowhere else. */
export const BASE = "/agent-skills";

/** Canonical repository, for GitHub blob/tree links to unrouted resources. */
export const REPO_URL = "https://github.com/ghchinoy/agent-skills";

/** The ref those blob/tree links point at. */
export const REPO_REF = "main";

/**
 * Phase 1 scope: the ONE plugin this slice renders (proposal §13 Phase 1).
 *
 * `okf-authoring` was chosen as the hardest plugin in the repository, not the
 * easiest: it is the only one with a plugin-level `references/` directory and
 * links that escape the skill root (D3); it carries the
 * `assets/example-bundle/` glob trap of 11 markdown files (I5); its two skill
 * descriptions are the longest in the repo at 755 and 790 characters (I9);
 * both its skills declare a sequence-valued `metadata.sources` (D1); and its
 * `SKILL.md` puts H1 headings inside fenced code blocks (I7).
 *
 * Deleting this constant renders all ten declared plugins — the loader has no
 * other phase-specific behaviour.
 */
export const PHASE_1_PLUGINS = ["okf-authoring"];
