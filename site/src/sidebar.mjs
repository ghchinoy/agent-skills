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
// ── Why skill entries carry an EXPLICIT `label` (EM ruling, fix round) ───────
//
// A Starlight entry with a `slug` and no `label` inherits the page's title.
// Skill pages are titled with the body H1 the author wrote ("Author an OKF
// v0.2 bundle"), so an unlabelled entry would put THAT in the nav. Proposal
// §6.3 requires the declared `name` there instead, and gives a load-bearing
// reason: `name` is the identifier a user types into
// `npx skills add … --skill <name>`. The nav is where you go to copy it.
//
// So the two strings go in two slots and neither is discarded:
//
//   sidebar label  = the declared `name`      (the install identifier, §6.3)
//   page title/H1  = the body H1, `name` as fallback where no H1 exists
//
// That title choice is a DELIBERATE, EM-accepted deviation from §6.4's
// "Title (H1) = name" table row. Rationale, recorded here so it is not
// re-litigated when the catalog fans out in Phase 3:
//
//  - §6.3's sidebar rule exists for the install identifier, and an explicit
//    label satisfies it exactly.
//  - Titling the page by `name` would throw away the authored H1 for nothing.
//    Both strings are declared; rendering both, each in its own slot, loses
//    neither.
//  - Taking the source H1 verbatim also aligns site A with site B's §7.2
//    policy.
//
// The deviation is scoped to the page title. It is not licence to deviate
// elsewhere. `tests/sidebar.test.mjs` pins the label of every skill entry to
// the declared `name`, and pins group and within-group order to
// marketplace.json.
//
// The label is read from the SKILL.md frontmatter, NOT from the directory
// name. The spec requires the two to match, but the site renders what is
// declared and reports a mismatch (NAME-DIR-SKEW) rather than papering over
// it — so if they ever diverge, the nav shows the name the CLI actually takes.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { enumerate, nodeFs } from "./loaders/enumerate.mjs";
import { splitFrontmatter } from "./loaders/frontmatter.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

export async function buildSidebar(onlyPlugins) {
  const { plugins } = await enumerate({ repoRoot, fs: nodeFs, onlyPlugins });
  const displayNames = await readDisplayNames(repoRoot);

  const groups = [];
  for (const plugin of plugins) {
    const items = [
      // The plugin overview page keeps its inherited title, which is the
      // README display name — the same string as the group label, and the
      // only title that page has.
      { slug: `plugins/${plugin.name}` },
    ];
    for (const s of plugin.skills) {
      items.push({
        slug: `plugins/${plugin.name}/${s.name}`,
        label: await declaredName(s),
      });
    }
    groups.push({
      // The group label is the ONE string Starlight cannot take from a page,
      // because a group is not a page. It is lifted from README.md's own
      // heading for this plugin, falling back to the slug when the README does
      // not name it — never to an invented prettification.
      label: displayNames.get(plugin.name) ?? plugin.name,
      items,
    });
  }
  return groups;
}

/**
 * The declared `name` of one skill, read from its SKILL.md frontmatter.
 *
 * Not the directory name: the directory name is where the file was found, the
 * frontmatter `name` is what the author declared and what the CLI takes. A
 * missing or empty `name` is a build error here for the same reason it is one
 * in `analyzeDeclared()` — there is no honest label to render, and inventing
 * one from the directory would be the site asserting something the source does
 * not say.
 */
async function declaredName(skill) {
  const raw = await readFile(skill.skillMdPath, "utf8");
  const { data } = splitFrontmatter(raw, skill.repoPath);
  const name = data?.name;
  if (typeof name !== "string" || name.trim() === "") {
    throw new Error(
      `sidebar: ${skill.repoPath} declares no non-empty \`name\`, so there is ` +
        `no identifier to put in the navigation. Agent Skills requires it.`,
    );
  }
  return name;
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
