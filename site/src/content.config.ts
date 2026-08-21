import { defineCollection } from "astro:content";
import { docsSchema } from "@astrojs/starlight/schema";
import { skillsLoader, skillsSchema } from "./loaders/skills";
import { BASE, REPO_URL, REPO_REF, PHASE_1_PLUGINS } from "./site.config.mjs";

// One collection, three entry kinds, distinguished by `_skill.kind`:
// `plugin`, `skill`, `reference`.
//
// `baseUrl` is passed in rather than hardcoded in the loader so the Astro
// `base` lives in exactly one place (proposal §10.4) — see src/site.config.mjs,
// which astro.config.mjs reads too.
export const collections = {
  docs: defineCollection({
    loader: skillsLoader({
      repoRoot: "..",
      baseUrl: BASE,
      repoUrl: REPO_URL,
      ref: REPO_REF,
      plugins: PHASE_1_PLUGINS,
    }),
    schema: docsSchema({ extend: skillsSchema }),
  }),
};
