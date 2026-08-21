// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

import { BASE, PHASE_1_PLUGINS, SITE } from "./src/site.config.mjs";
import { buildSidebar } from "./src/sidebar.mjs";

// Hosting: the project GitHub Pages site at
// https://ghchinoy.github.io/agent-skills/. Project Pages serve from a
// sub-path, so `site` is the origin and `base` is the "/agent-skills" prefix.
// Both come from src/site.config.mjs, which the content loader reads too — the
// base prefix is written in exactly one place (proposal §10.4).
export default defineConfig({
  site: SITE,
  base: BASE,

  // Phase 1 routes five content pages and no landing page, because §13's
  // acceptance criterion 2 enumerates the slice exhaustively: 1 plugin, 2
  // skills, 2 plugin-level references. Starlight's masthead still links home,
  // so the site root is a REDIRECT to the one overview page that exists in the
  // slice. A redirect stub asserts nothing and renders no content; it just
  // stops the masthead link and the deployed root from 404ing. The landing
  // page proper arrives with the fan-out, in Phase 3.
  // NOTE the explicit BASE on the destination: Astro base-prefixes the redirect
  // SOURCE route but emits the destination verbatim, so a bare
  // "/plugins/…" here would ship a link that leaves the project sub-path and
  // 404s on Pages. tests/links.test.mjs covers this file like any other.
  redirects: {
    "/": `${BASE}/plugins/${PHASE_1_PLUGINS[0]}/`,
  },

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
      sidebar: await buildSidebar(PHASE_1_PLUGINS),

      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/ghchinoy/agent-skills",
        },
      ],
    }),
  ],
});
