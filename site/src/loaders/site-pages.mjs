// site-pages.mjs — the five pages that are ABOUT the catalog rather than in it.
//
//   /                     landing
//   /skills/              flat index of every skill
//   /about/install/       the repository README's install instructions, verbatim
//   /about/standards/     what the two specs are, and links out
//   /about/contributing/  CONTRIBUTING.md
//
// Three of the five are LIFTS. `/about/install/` and `/about/contributing/`
// reproduce bytes from `README.md` and `CONTRIBUTING.md`; the landing page
// opens with the README's own lead paragraph. Lifting is not the same as
// copying: the bytes are extracted at build time from the file that owns them,
// so the repo stays the single source and the site cannot drift from it. There
// is no second copy of the install commands in this tree, and `assertLift()`
// below makes a lift that finds nothing a build error rather than an empty
// section.
//
// The other two are SITE-AUTHORED, and their content is bounded on purpose:
//
//  - `/skills/` writes no prose about any skill. Every string it shows about a
//    skill is that skill's own declared `name`, `title` and `description`, and
//    they travel as DATA (see `lists` below) rather than as generated markdown,
//    for the reason MarkdownContent.astro gives about string templating: a
//    description spliced into markdown would have its backticks and asterisks
//    reinterpreted, and the page would then show something the author did not
//    write.
//  - `/about/standards/` is deliberately thin (proposal §6.3): what the two
//    standards are, in a few sentences, with links out. It does NOT restate
//    normative text — the specifications are the normative documents and a
//    paraphrase of a MUST is a second, worse copy of it. Its own numbers are
//    measured by this build, not typed.
//
// NOTHING HERE HAND-TYPES A COUNT. "10 plugins", "23 skills", "0 MCP servers"
// are all `.length` of something the build enumerated, which is the whole point
// of proposal §11's "hand-type '10 plugins, 23 skills' on a landing page: No."

import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Reads `file` from the repository root, failing with the path rather than an
 * ENOENT nobody can place.
 */
async function repoDoc(repoRoot, file) {
  try {
    return await readFile(join(repoRoot, file), "utf8");
  } catch (err) {
    throw new Error(
      `site-pages: ${file} is not readable, and a page of this site is a LIFT ` +
        `of its bytes rather than a copy kept under site/. ${err.message}`,
    );
  }
}

/**
 * A lift that found nothing is a build error, never an empty section.
 *
 * The failure mode this exists for: somebody retitles a README heading, the
 * extraction silently matches nothing, and `/about/install/` ships with no
 * install instructions and a green build. Same class as `plantOrThrow()` in the
 * test helpers, and for the same reason.
 */
function assertLift(value, what, source) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(
      `site-pages: could not lift ${what} from ${source}. The structure this ` +
        `extraction depends on is no longer in the file, so the page was about ` +
        `to render an empty section instead of the source's own words.`,
    );
  }
  return value;
}

/** Everything between the document's H1 and its first `---` or `##`. */
function leadParagraphs(markdown, source) {
  const afterH1 = markdown.replace(/^\s*#[^\n]*\n/, "");
  const cut = afterH1.search(/^(?:---\s*$|##\s)/m);
  return assertLift(
    (cut === -1 ? afterH1 : afterH1.slice(0, cut)).trim(),
    "the lead paragraphs",
    source,
  );
}

/** The body of the `## <heading>` section, exclusive of the heading itself. */
function section(markdown, heading, source) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start === -1) {
    throw new Error(
      `site-pages: ${source} has no "## ${heading}" section. A page of this ` +
        `site lifts it verbatim, so a rename here is a build error rather ` +
        `than a page that quietly loses its content.`,
    );
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^## \S/.test(lines[i])) {
      end = i;
      break;
    }
  }
  // A horizontal rule between sections belongs to neither; drop only a trailing
  // one, and only when it is the last non-blank line.
  const body = lines.slice(start + 1, end).join("\n").replace(/\n+---\s*$/, "");
  return assertLift(body.trim(), `the "${heading}" section`, source);
}

/** The `### …` sub-headings of a section body, in document order. */
function subHeadings(sectionBody) {
  return [...sectionBody.matchAll(/^### (.+)$/gm)].map((m) => m[1].trim());
}

/**
 * Builds the five site pages.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @param {string} opts.base                Astro `base`, no trailing slash
 * @param {(repoPath: string) => string} opts.blobUrl
 * @param {any[]} opts.plugins              enumerate()'s output, in index order
 * @param {Map<string,string>} opts.displayNames
 * @param {{plugin: string, skill: string, name: string, title: string, description: string,
 *   href: string, pluginKeywords: string[]|null}[]} opts.skillIndex
 *   one entry per emitted skill page, in emission order
 * @param {number} opts.referencePages      routed reference pages, counted
 * @param {number} opts.unroutedResources   resource entries not routed
 */
export async function buildSitePages(opts) {
  const { repoRoot, base, blobUrl, plugins, displayNames, skillIndex } = opts;

  const readme = await repoDoc(repoRoot, "README.md");
  const contributing = await repoDoc(repoRoot, "CONTRIBUTING.md");

  const pluginList = plugins.map((p) => ({
    name: p.name,
    displayName: displayNames.get(p.name) ?? null,
    href: `${base}/plugins/${p.name}/`,
    description: p.manifest.description,
    skillCount: p.skills.length,
    referenceCount:
      p.references.length +
      p.skills.reduce(
        (n, s) =>
          n +
          (s.resources.references ?? []).filter(
            (r) => r.kind === "file" && /\.md$/i.test(r.name),
          ).length,
        0,
      ),
  }));

  // The counts, each one a measurement with its population written next to it.
  const counts = {
    plugins: plugins.length,
    skills: skillIndex.length,
    referencePages: opts.referencePages,
    unroutedResources: opts.unroutedResources,
    // Agent Plugins §6.1 fixes `mcp.json` inside a plugin root; enumerate()
    // stats it for every declared plugin. This is the count of plugins that
    // HAVE one, over a denominator of all of them.
    mcpPlugins: plugins.filter((p) => p.mcp.present).length,
    // …and the manifest's own extension point, checked over the same ten.
    extensionPlugins: plugins.filter((p) => p.manifest.extensions !== undefined).length,
  };

  const pages = [];

  /**
   * Every page is built through here, for two reasons.
   *
   * `sourceUrl` is DERIVED from `sourcePath` — once, in one place, so a page
   * cannot be pushed carrying a provenance link that points somewhere its own
   * `sourcePath` does not. It was previously patched on in a loop after the
   * fact, which worked and told a reader nothing about where the value came
   * from.
   *
   * And the defaults give the five pages ONE shape. A page that simply omits
   * the keys it does not use makes the array a union of five object types, and
   * then every consumer has to know which page it is holding before it can read
   * a field. Absence here is a key holding `undefined`, which is what the
   * schema's `.optional()` already means; this is an internal record, not a
   * rendered field, so the site's absence-is-absence rule is untouched.
   */
  const page = ({
    id,
    title,
    body,
    sourcePath = null,
    stripH1 = false,
    lists = undefined,
    installerCount = undefined,
  }) => ({
    id,
    title,
    body,
    sourcePath,
    sourceUrl: sourcePath === null ? null : blobUrl(sourcePath),
    stripH1,
    lists,
    installerCount,
  });

  // ── / ──────────────────────────────────────────────────────────────────────
  // Title and lead are the README's own. Everything below the lead is a count
  // or a name, per proposal §13 Phase 5's constraint on this page.
  const readmeH1 = assertLift(/^\s*#\s+(.+)$/m.exec(readme)?.[1]?.trim(), "the H1", "README.md");
  pages.push(page({
    id: "index",
    title: readmeH1,
    sourcePath: "README.md",
    body: [
      leadParagraphs(readme, "README.md"),
      "",
      "## What is in here",
      "",
      "Every number on this page is counted by the build that produced it, from",
      "`.claude-plugin/marketplace.json` and the plugin trees it names.",
      "",
      `- **${counts.plugins} plugins**, in the order the distribution index declares them.`,
      `- **${counts.skills} skills** — a \`SKILL.md\` at \`plugins/<plugin>/skills/<skill>/\`,` +
        " discovered without recursing below that directory, as Agent Plugins §7.1 requires.",
      `- **${counts.referencePages} reference documents**, rendered as pages of this site.`,
      `- **${counts.unroutedResources} further resource entries** — scripts, assets and` +
        " non-markdown references — listed by real filename and linked to GitHub rather than" +
        " rewritten into pages.",
      `- **${counts.mcpPlugins} MCP servers**: no plugin here declares the \`mcp.json\` fixed` +
        " location. See [the standards](" + base + "/about/standards/).",
      "",
      "## Where to go",
      "",
      `- [All ${counts.skills} skills](${base}/skills/) — the flat index, with plugin attribution.`,
      `- [Install and usage](${base}/about/install/) — reproduced from the repository README.`,
      `- [The standards](${base}/about/standards/) — what Agent Plugins and Agent Skills are.`,
      `- [Contributing](${base}/about/contributing/) — reproduced from CONTRIBUTING.md.`,
      "",
      "## The plugins",
      "",
    ].join("\n"),
    lists: { plugins: pluginList },
  }));

  // ── /skills/ ───────────────────────────────────────────────────────────────
  pages.push(page({
    id: "skills",
    title: `All ${counts.skills} skills`,
    sourcePath: null,
    body: [
      `Every skill in the catalog: ${counts.skills} of them, across` +
        ` ${counts.plugins} plugins.`,
      "",
      "The order is `.claude-plugin/marketplace.json`'s own — plugin by plugin in the",
      "order the index declares, and within each plugin in the order its `skills[]`",
      "array declares. Neither standard fixes an ordering; the distribution index does,",
      "and it is the owner's.",
      "",
      "Each entry shows the title the skill's `SKILL.md` gives itself, the `name` the",
      "spec defines and the CLI takes, the plugin that ships it, and the skill's own",
      "`description` — all verbatim, none summarised.",
      "",
      "**The filter is on plugin keywords, and a skill has none of its own.** Neither",
      "the Agent Skills spec nor this repository gives a skill tags, a category or any",
      "other facet; the only such field anywhere is `keywords` in a plugin's",
      "`plugin.json`, which Agent Plugins calls search and discovery tags. Filtering a",
      "skill by one selects it because of the plugin that ships it. Every skill in a",
      "plugin carries that plugin's whole keyword list, which is why two skills that do",
      "quite different jobs answer to the same keyword.",
    ].join("\n"),
    lists: { skills: skillIndex },
  }));

  // ── /about/install/ ────────────────────────────────────────────────────────
  // AC 9: the three installers, verbatim and in README order. "Three" is not
  // asserted here — it is COUNTED here and asserted in tests/site-pages.test.mjs
  // against the same file, so a fourth installer added to the README shows up on
  // this page instead of being silently dropped by a hardcoded slice.
  const installBody = section(readme, "Installation & Usage", "README.md");
  const installers = subHeadings(installBody);
  if (installers.length === 0) {
    throw new Error(
      `site-pages: README.md's "Installation & Usage" section has no "### " ` +
        `sub-headings, so there is nothing recognisable as an installer to ` +
        `reproduce. The lift matched a section but not its shape.`,
    );
  }
  pages.push(page({
    id: "about/install",
    title: "Installation & Usage",
    sourcePath: "README.md",
    // Verbatim, and in the README's order, because it IS the README's bytes:
    // nothing below reorders, reflows or re-words the section. The one added
    // line is the provenance note, which is about the page rather than in it.
    body: [
      `The ${installers.length} routes below are reproduced from the repository's` +
        " `README.md`, unchanged and in its order. The README is the source; if the two",
      "ever disagree, this page is the copy and the README is right.",
      "",
      installBody,
    ].join("\n"),
    installerCount: installers.length,
  }));

  // ── /about/standards/ ──────────────────────────────────────────────────────
  // Thin on purpose. Read the module header before adding to it.
  pages.push(page({
    id: "about/standards",
    title: "The standards this catalog targets",
    sourcePath: null,
    body: [
      "This repository packages its contents according to two open standards. They are",
      "published elsewhere, by other people, and this page is a pointer to them rather",
      "than a summary of them: the specifications are the normative documents, and a",
      "paraphrase of a requirement is a second and worse copy of it.",
      "",
      "- **[Agent Plugins](https://agent-plugins.org)** — how a distributable plugin",
      "  package is laid out. Each plugin here names the version it targets in its own",
      "  `plugin.json` `$schema` URL, and its plugin page renders that declaration",
      "  rather than this page asserting one.",
      "- **[Agent Skills](https://agentskills.io)** — the `SKILL.md` format every skill",
      "  in this catalog is written in.",
      "",
      "The two are separate standards with separate homes, and neither is published by",
      "this repository.",
      "",
      "## This catalog is skills-only",
      "",
      "Agent Plugins fixes two locations inside a plugin root: `skills/` and `mcp.json`.",
      `This build probed both for all ${counts.plugins} declared plugins and found`,
      `${counts.skills} skills and ${counts.mcpPlugins} MCP servers —`,
      `${counts.mcpPlugins} of the ${counts.plugins} plugins declare an \`mcp.json\`, and`,
      `${counts.extensionPlugins} of the ${counts.plugins} declare a manifest`,
      "`extensions` field. Those are counts from the build that produced this page, not",
      "a claim about what the repository will contain tomorrow.",
      "",
      "## What this site does with them",
      "",
      "It renders what the repository declares and nothing else. Every field on a skill",
      "or plugin page is labelled with where its value came from — the skill's own",
      "frontmatter, its plugin's manifest, or this build — and a value the source does",
      "not declare produces no row at all rather than a placeholder.",
    ].join("\n"),
  }));

  // ── /about/contributing/ ───────────────────────────────────────────────────
  pages.push(page({
    id: "about/contributing",
    title: assertLift(
      /^\s*#\s+(.+)$/m.exec(contributing)?.[1]?.trim(),
      "the H1",
      "CONTRIBUTING.md",
    ),
    sourcePath: "CONTRIBUTING.md",
    body: contributing,
    stripH1: true,
  }));

  return { pages, counts };
}
