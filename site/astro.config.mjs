// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

import { BASE, REPO_URL, SITE } from "./src/site.config.mjs";
import { buildSidebar } from "./src/sidebar.mjs";

// Hosting: the project GitHub Pages site at
// https://ghchinoy.github.io/agent-skills/. Project Pages serve from a
// sub-path, so `site` is the origin and `base` is the "/agent-skills" prefix.
// Both come from src/site.config.mjs, which the content loader reads too — the
// base prefix is written in exactly one place (proposal §10.4).
export default defineConfig({
  site: SITE,
  base: BASE,
  // ── FOUND IN PHASE 3, AND IT IS OLDER THAN PHASE 3 ───────────────────────
  //
  // src/loaders/markdown.mjs opens by saying the body transformation is a
  // CLOSED list of exactly two operations — "No heading demotion, no
  // prettifier, no SMART QUOTES, no reflow" — and proposal §6.5 says the same.
  // That was true of the module. It was not true of the page, because Astro's
  // markdown renderer runs SmartyPants by default, downstream of everything
  // the loader does and outside the list the loader is describing. A comment
  // that is correct about its own file and wrong about the artifact is worse
  // than no comment: it is the reason nobody went looking.
  //
  // Measured on this branch before the flag was added: 34 of the 58 built
  // pages differed byte-for-byte with SmartyPants on versus off. The README's
  // own "the model's immediate context window" reached the landing page as
  // "model’s" — a character the repository does not contain, on a site whose
  // entire claim is that it renders what the source declares.
  //
  // Off. The declared bytes are the declared bytes, apostrophes included.
  markdown: { smartypants: false },

  // NO `redirects` HERE, AND THAT IS THE CHANGE. Phase 1 routed five content
  // pages and no landing page, so the site root was a redirect stub whose only
  // job was to stop the masthead link from 404ing. Phase 3 emits a real landing
  // page at `/` from the content loader, so the stub is gone rather than
  // pointing at a page that now has a peer. A redirect that shadows a real
  // route is a page nobody can reach.

  integrations: [
    starlight({
      // The SITE title — the masthead string and the suffix Starlight appends
      // to every <title>. Fixed by the owner as exactly "Agent Skills
      // Catalog"; tests/chrome.test.mjs pins it against the rendered
      // output so a later phase cannot drift it. This is the site's name and
      // has nothing to do with PAGE titles, which come from the source (see
      // src/loaders/skills.ts and src/sidebar.mjs).
      title: "Agent Skills Catalog",

      // The theme seam. One stylesheet maps Starlight's --sl-* variables so
      // the site is visibly this catalog's own. Site B later COPIES this file
      // rather than importing a published theme package (proposal §5).
      customCss: ["./src/styles/tokens.css"],

      // Search: ON — a deliberate divergence from binder, and for a reason
      // that transfers rather than a conclusion that does. binder disables
      // Pagefind because shipping a search box would assert a capability the
      // PRODUCT does not have. Here the searchable thing is the site's own
      // content and the index is built from the bytes on the page, so the box
      // asserts nothing that is not true. Left at Starlight's default (true).

      components: {
        // Renders the declared/derived field blocks above each page body. See
        // the component for why this is an override rather than markdown
        // templated into the body.
        MarkdownContent: "./src/components/MarkdownContent.astro",
      },

      // Derived from marketplace.json + the plugin trees, in the index's own
      // declared order. Adding a skill is a marketplace.json edit and nothing
      // here.
      sidebar: await buildSidebar(),

      // REPO_URL, not a literal. site.config.mjs calls itself the constants
      // "written once so they cannot drift apart" and exports REPO_URL as "the
      // canonical repository" — and this line held a fourth copy of it anyway,
      // in the production config, which is the one place a stale repo URL ships
      // to readers. Found by the mirrored-constant class sweep, not by being
      // named in a review: same class as F9, different instance.
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: REPO_URL,
        },
      ],
    }),
  ],
});
