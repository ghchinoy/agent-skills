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

// Phase 1 shipped one plugin behind a `PHASE_1_PLUGINS` constant, whose comment
// promised that "deleting this constant renders all ten declared plugins — the
// loader has no other phase-specific behaviour". Phase 3 deleted it, and the
// promise held: the loader's `plugins` scope option is now simply not passed,
// so `enumerate()` returns every plugin `marketplace.json` declares. The option
// itself is kept — it narrows WHICH declared plugins are built and never
// changes HOW they are discovered — because tests use it to build a scoped
// fixture, and because the next repo to adopt this loader may want it.
