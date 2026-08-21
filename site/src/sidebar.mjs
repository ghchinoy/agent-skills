// sidebar.mjs — the sidebar is DERIVED from the same discovery the loader uses,
// so adding a plugin or a skill is a `marketplace.json` edit and nothing under
// `site/`.
//
// Two deliberate choices, both from proposal §6.3:
//
//  - Group order follows `marketplace.json` EXACTLY, not alphabetically. That
//    is the owner's declared ordering, and the standard leaves ordering to the
//    distribution index, so honouring it is correct rather than merely polite.
//  - Reference pages are NOT in the sidebar. They live on their owning plugin's
//    page and in search; 18 more leaves at full fan-out would double the tree
//    for the least-navigated content in the catalog.
//
// Entries carry a `slug` and NO `label`, so every visible string is the page's
// own title — which is the plugin's README name or the skill's declared `name`.
// A label hand-typed here would be a second copy of a fact that already exists.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { enumerate, nodeFs } from "./loaders/enumerate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

export async function buildSidebar(onlyPlugins) {
  const { plugins } = await enumerate({ repoRoot, fs: nodeFs, onlyPlugins });
  const displayNames = await readDisplayNames(repoRoot);

  return plugins.map((plugin) => ({
    // The group label is the ONE string Starlight cannot take from a page,
    // because a group is not a page. It is lifted from README.md's own heading
    // for this plugin, falling back to the slug when the README does not name
    // it — never to an invented prettification.
    label: displayNames.get(plugin.name) ?? plugin.name,
    items: [
      { slug: `plugins/${plugin.name}` },
      ...plugin.skills.map((s) => ({ slug: `plugins/${plugin.name}/${s.name}` })),
    ],
  }));
}

async function readDisplayNames(root) {
  const out = new Map();
  let readme;
  try {
    readme = await readFile(join(root, "README.md"), "utf8");
  } catch {
    return out;
  }
  const re = /^#{2,4}\s*\d+\.\s*(.+?)\s*\(`plugins\/([a-z0-9._-]+)`\)\s*$/gm;
  for (const m of readme.matchAll(re)) {
    const name = m[1].replace(/^[^\p{L}\p{N}]+/u, "").trim();
    if (name) out.set(m[2], name);
  }
  return out;
}
