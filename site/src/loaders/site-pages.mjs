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

import { REPO_URL } from "../site.config.mjs";
import { loadSpecSource, pinSentence } from "./spec-source.mjs";

/**
 * `owner/repo`, derived from the one place repo identity is declared.
 *
 * The §2.1 disambiguation note names three repositories and one of them is
 * THIS one. Typing it out is what the mirrored-constant rule forbids, and both
 * halves of the suite proved the rule earns its keep here: writing the literal
 * turned RED in `pins.test.mjs` (a static scan for second copies) and again in
 * `build-e2e.test.mjs` (which rebuilds under a PERTURBED config and looks for
 * survivors of the real value). Two instruments, two methods, same defect.
 *
 * The other two names in that note are deliberately literal: they are OTHER
 * people's repositories, not this one, and there is no constant to derive them
 * from. Naming them is the entire point of the note.
 */
const REPO_SLUG = new URL(REPO_URL).pathname.replace(/^\/+|\/+$/g, "");

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

  // The pinned spec revisions (AC5). Read, never hardcoded: no version string
  // for either standard appears anywhere in `src/`, and
  // tests/spec-source.test.mjs grep-asserts that. A throw here is a build
  // failure on purpose — see spec-source.mjs on why nothing falls back.
  const specSource = await loadSpecSource();
  const specById = new Map(specSource.specifications.map((s) => [s.id, s]));
  const specOrThrow = (id) => {
    const spec = specById.get(id);
    if (spec === undefined) {
      throw new Error(
        `site-pages: specification-source.json pins no standard with id "${id}", ` +
          `but a page renders its revision. The page cannot invent one.`,
      );
    }
    return spec;
  };
  const agentPlugins = specOrThrow("agent-plugins");
  const agentSkills = specOrThrow("agent-skills");

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
      // Proposal §2.1, "A three-way naming collision", which AC2 names as the
      // ONE addition permitted on this page beyond counts, names and README
      // bytes. §2.1 asks for "a one-line 'not to be confused with' note on both
      // landing pages, linking agentskills.io and agent-plugins.org."
      //
      // WHAT §2.1 ALSO PROPOSES AND THIS DOES NOT DO. The same section suggests
      // the site title "Agent Skills Catalog (10 plugins, 23 skills, conformant
      // with the Agent Plugins spec)". Those are two hand-typed integers, and
      // AC1 forbids a catalog figure typed into source — they would be correct
      // today, silently wrong at the next merge, and invisible to every count
      // test because no count test reads a title. So this note takes the NAMING
      // half of §2.1 and leaves the figures to the computed counts below.
      "## Not to be confused with",
      "",
      "Three repositories sit one hyphen or one owner apart:",
      "",
      `- \`${REPO_SLUG}\` — this catalog. It is what these pages describe.`,
      "- `ghchinoy/agentskills` — the same owner's Go CLI, a different project.",
      "- `agentskills/agentskills` — the standard itself, published by a different",
      "  organisation that happens to share the second repository's name.",
      "",
      "Both standards this catalog targets are published elsewhere, by other people:",
      "[Agent Skills](https://agentskills.io) and [Agent Plugins](https://agent-plugins.org).",
      "",
      "## What is in here",
      "",
      "Every number on this page is counted by the build that produced it, from",
      "`.claude-plugin/marketplace.json` and the plugin trees it names.",
      "",
      `- **${counts.plugins} plugins**, in the order the distribution index declares them.`,
      // PHASE 5, AC2, AND IT IS A PARA-1 CATCH RATHER THAN A NEEDLE ONE.
      //
      // This line used to end "…discovered without recursing below that
      // directory, as Agent Plugins §7.1 requires." Every word of that was
      // TRUE. It is still a defect twice over:
      //
      //   1. It is a claim outside AC2's list — AC2 permits counts, names,
      //      README bytes and the §2.1 note, and a statement about what a
      //      standard requires is none of those.
      //   2. It is a PARAPHRASE OF A NORMATIVE REQUIREMENT. §7.1 says clients
      //      "MUST NOT recursively search deeper descendants"; the sentence
      //      above is that MUST, reworded. §12: "Restate normative spec text on
      //      our pages — No. Link out." A paraphrase of a requirement is a
      //      second and worse copy of it.
      //
      // WHY NO GATE CAUGHT IT, which is the part worth keeping. The suite's
      // RFC-2119 detector is real, it works, and it was pointed at
      // `/about/standards/` only — so on this page the search was never run.
      // And it would not have fired anyway: the detector looks for MUST, SHALL,
      // "is required to" and friends, and this sentence says "requires". A
      // needle matcher cannot see a rephrasing, and no number of additional
      // needles changes that. It was found by reading the page for the CLAIM
      // instead of for the STRING, which is the only method that has ever
      // worked on this class.
      //
      // The count and the path stay: those are data. The restatement goes, and
      // the rule it restated is now reached by a link, which is where it lives.
      `- **${counts.skills} skills**, each declared by a \`SKILL.md\` at` +
        " `plugins/<plugin>/skills/<skill>/`.",
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
      // ── AC5. THE POINT IS THE READ. ──────────────────────────────────────────
      // Every value below arrives from `site/specification-source.json` via
      // src/loaders/spec-source.mjs. Nothing here is a literal, which is what
      // makes a stale pin show up as a visibly stale PAGE rather than as an
      // unread file — a JSON file nobody parses is documentation, not a pin.
      //
      // The absence sentence is DERIVED from `declaredAbsent`, not written out.
      // If Agent Skills ever starts declaring a version and someone records it,
      // the bullet gains a version clause and this paragraph loses the word, in
      // the same build, with no prose to remember to update. A hand-written
      // "no version is available" would go stale silently and read identically.
      "## The revisions this page was built against",
      "",
      "This build reads these from `specification-source.json`; no page here carries a",
      "version string of its own.",
      "",
      `- **${agentPlugins.name}** — ${pinSentence(agentPlugins)}.`,
      `- **${agentSkills.name}** — ${pinSentence(agentSkills)}.`,
      "",
      ...[agentPlugins, agentSkills].flatMap((spec) => {
        const fields = Object.keys(spec.declaredAbsent);
        if (fields.length === 0) return [];
        const list =
          fields.length === 1
            ? fields[0]
            : `${fields.slice(0, -1).join(", ")} or ${fields[fields.length - 1]}`;
        return [
          `The ${spec.name} specification declares no ${list} of its own, so none is`,
          "shown above. That absence was measured, not inherited: the predicate and the",
          "positive control that shows the search could have found one sit beside the",
          "omission in `specification-source.json`.",
          "",
        ];
      }),
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
