// Shared helpers for the guardrail suites. NOT a test file — the Node test
// runner only picks up `*.test.mjs`, so this never runs on its own.
//
// A note on why the element helpers below exist rather than a `class="..."`
// regex: Astro appends a scoped hash class to every element it renders
// (`class="entry-description astro-omx3yuj2"`), so a test that pins an exact
// class attribute breaks on a build-hash change while proving nothing extra.
// The site's markup therefore carries stable `data-*` hooks, and the tests
// address those.

import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

export const here = dirname(fileURLToPath(import.meta.url));
export const siteRoot = join(here, "..");
export const repoRoot = join(siteRoot, "..");
export const dist = join(siteRoot, "dist");

/** The Astro `base`. Duplicated here on purpose: a test that imported the
 *  site's own constant could not catch the site changing it. */
export const BASE = "/agent-skills";

/**
 * The origin the built artifact hard-codes into canonical tags and any other
 * absolute self-reference. Duplicated for the same reason as BASE.
 *
 * A LOCAL FIXTURE THAT SUBSTITUTES THE ORIGIN CANNOT TEST SAME-ORIGIN ABSOLUTE
 * URLS. This is worth stating flatly because it cost this phase a whole class
 * of coverage: a checker that classifies references by comparing their origin
 * to the site's origin will file every absolute self-reference as "off-site,
 * skip" when the fixture answers on 127.0.0.1. The fixture then looks like a
 * model of production and is a strictly weaker crawl, silently dropping exactly
 * the class the classifier exists to catch. Phase 6's Site B has the same shape
 * with a different base path, so the rule outlives this phase.
 */
export const ORIGIN = "https://ghchinoy.github.io";

/**
 * The plugin the WORKED-EXAMPLE tests use.
 *
 * Phase 1 rendered exactly this plugin and nothing else, so `PLUGIN` was the
 * catalog. Phase 3 renders all ten, and the constant survives with a smaller
 * job: several checks are about a specific known property of a specific source
 * file — I1's two competing descriptions, I9's 755- and 790-character
 * descriptions, the `# Concepts` line inside a fence at okf-author/SKILL.md:71 —
 * and those are claims about an instance, correctly written against the
 * instance.
 *
 * IT IS NOT A SAMPLE STANDING IN FOR THE CATALOG. A check about a CLASS
 * ("no page renders a Tags label", "every rendered field label traces to a
 * declared key") must run over the population, and the populations below are
 * what it runs over. A class check narrowed to `PLUGIN` would be two skills of
 * twenty-three and would report itself green.
 */
export const PLUGIN = "okf-authoring";

/**
 * The five pages that are ABOUT the catalog rather than in it, as routes.
 *
 * Hand-written here on purpose, and it is the one route list that is. These
 * five are a decision this site made, not a fact about the source repository,
 * so there is nothing to derive them FROM: a test that asked site-pages.mjs how
 * many pages site-pages.mjs emits would assert only that the module agrees with
 * itself. `""` is the site root.
 */
export const SITE_ROUTES = ["", "skills", "about/install", "about/standards", "about/contributing"];

/**
 * Every route the built site must contain, DERIVED from the source tree by this
 * file's own parsing — marketplace.json for which plugins exist and in what
 * order, and `readdir` for what is inside each of them. The loader is never
 * asked. (EM ruling, 2026-08-21: "if the test computes its expected set by
 * calling the same enumeration code the loader uses, it proves only that the
 * loader agrees with itself".)
 *
 * The rules re-implemented here are Agent Plugins §7.1 discovery plus this
 * site's routing decisions, and they are re-implemented rather than imported:
 *
 *   plugins/<p>                              one per marketplace.json entry
 *   plugins/<p>/<skill>                      one per skills/<skill>/SKILL.md
 *   plugins/<p>/references/<slug>            plugin-level references/*.md
 *   plugins/<p>/<skill>/references/<slug>    skill-level references/*.md
 *
 * Non-markdown references, scripts and assets are NOT routes: they are listed
 * on their owning page and linked to GitHub. Discovery does not recurse below
 * the directories named above, which is what keeps the eight markdown files in
 * okf-author's `assets/example-bundle/` out of the site.
 *
 * @returns {Promise<{plugins: string[], skills: {plugin: string, skill: string, route: string, skillMd: string}[], references: string[], routes: string[]}>}
 */
export async function sourceRoutes() {
  const market = JSON.parse(
    await readFile(join(repoRoot, ".claude-plugin", "marketplace.json"), "utf8"),
  );
  const names = market.plugins.map((p) => p.name);
  if (names.length === 0) throw new Error("marketplace.json declares no plugins");

  const skills = [];
  const references = [];
  for (const name of names) {
    const dir = join(repoRoot, "plugins", name);
    for (const skill of await subdirs(join(dir, "skills"))) {
      const skillMd = join(dir, "skills", skill, "SKILL.md");
      // §7.1: a directory under skills/ is a skill only if it holds a SKILL.md.
      if (!(await isFile(skillMd))) continue;
      skills.push({ plugin: name, skill, route: `plugins/${name}/${skill}`, skillMd });
      for (const md of await markdownFiles(join(dir, "skills", skill, "references"))) {
        references.push(`plugins/${name}/${skill}/references/${md.replace(/\.md$/i, "")}`);
      }
    }
    for (const md of await markdownFiles(join(dir, "references"))) {
      references.push(`plugins/${name}/references/${md.replace(/\.md$/i, "")}`);
    }
  }

  return {
    plugins: names,
    skills,
    references,
    routes: [
      ...SITE_ROUTES,
      ...names.map((n) => `plugins/${n}`),
      ...skills.map((s) => s.route),
      ...references,
    ],
  };
}

/** Immediate subdirectories of `dir`, or `[]` if `dir` does not exist. */
async function subdirs(dir) {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/** Immediate `*.md` files of `dir`, or `[]` if `dir` does not exist. */
async function markdownFiles(dir) {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((d) => d.isFile() && /\.md$/i.test(d.name))
      .map((d) => d.name);
  } catch {
    return [];
  }
}

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * The source strings a given ROUTE is entitled to quote.
 *
 * A model of the site's routing written here rather than imported, so that a
 * page rendering something none of its own sources say is a failure rather
 * than a redefinition. Deliberately TIGHT: a skill page gets its SKILL.md and
 * not its plugin's manifest, an about page gets the one document it lifts, and
 * `/about/standards/` gets nothing at all because it is site-authored. Widening
 * any of these to make a check pass would be exactly the move the check exists
 * to catch.
 */
export async function entitledSources(route) {
  const { plugins, skills } = await sourceRoutes();
  const pluginJson = (p) => readFile(join(repoRoot, "plugins", p, "plugin.json"), "utf8");

  if (route === "") {
    // The landing page: the README's LEAD — not the whole README, because the
    // whole README is not what it lifts — plus every plugin's manifest
    // description, which its plugin list renders verbatim.
    return [
      readmeLead(await readFile(join(repoRoot, "README.md"), "utf8")),
      ...(await Promise.all(plugins.map(pluginJson))),
    ];
  }
  if (route === "skills") {
    // The flat index: every skill's declared name, title and description.
    return await Promise.all(skills.map((s) => readFile(s.skillMd, "utf8")));
  }
  if (route === "about/install") {
    return [readmeSection(await readFile(join(repoRoot, "README.md"), "utf8"), "Installation & Usage")];
  }
  if (route === "about/contributing") {
    return [await readFile(join(repoRoot, "CONTRIBUTING.md"), "utf8")];
  }
  if (route === "about/standards") return [];

  const parts = route.split("/");
  const plugin = parts[1];
  if (parts.length === 2) {
    // A plugin page: its manifest, and its skills' descriptions, which it
    // lists verbatim.
    return [
      await pluginJson(plugin),
      ...(await Promise.all(
        skills.filter((s) => s.plugin === plugin).map((s) => readFile(s.skillMd, "utf8")),
      )),
    ];
  }
  if (parts.length === 3) {
    return [await readFile(join(repoRoot, "plugins", plugin, "skills", parts[2], "SKILL.md"), "utf8")];
  }
  if (parts.length === 4 && parts[2] === "references") {
    return [await readFile(join(repoRoot, "plugins", plugin, "references", `${parts[3]}.md`), "utf8")];
  }
  if (parts.length === 5 && parts[3] === "references") {
    return [
      await readFile(
        join(repoRoot, "plugins", plugin, "skills", parts[2], "references", `${parts[4]}.md`),
        "utf8",
      ),
    ];
  }
  throw new Error(`entitledSources: no rule for route "${route}" — the route shapes changed`);
}

/**
 * The README's lead: after its H1, up to the first `---` or `##`. Re-derived
 * here rather than imported from site-pages.mjs, so the two agreeing means
 * something.
 */
function readmeLead(markdown) {
  const afterH1 = markdown.replace(/^\s*#[^\n]*\n/, "");
  const cut = afterH1.search(/^(?:---\s*$|##\s)/m);
  const lead = (cut === -1 ? afterH1 : afterH1.slice(0, cut)).trim();
  if (lead.length === 0) throw new Error("the README has no lead paragraph — this model is stale");
  return lead;
}

/** The body of one `## <heading>` section of a markdown document. */
function readmeSection(markdown, heading) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start === -1) {
    throw new Error(`the document has no "## ${heading}" section — this model is stale`);
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^## \S/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n");
}

/**
 * The Agent Skills closed top-level vocabulary, WRITTEN OUT HERE.
 *
 * This is the one list in the suite that is deliberately hand-typed, because it
 * is the specification and not a property of this code. Importing
 * `ALLOWED_FIELDS` from the loader would make "every rendered label is a spec
 * field" mean "every rendered label is whatever the loader currently allows",
 * which is the check agreeing with the thing it checks. A test below asserts
 * the loader's list equals this one, so the duplication is a comparison rather
 * than a copy.
 */
export const SPEC_TOP_LEVEL_FIELDS = [
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
];

/**
 * Every skill in the catalog with its frontmatter PARSED FROM SOURCE, plus its
 * plugin's manifest — the population almost every Phase 3 class check runs
 * over.
 *
 * Parsed here with `yaml`, from paths derived by `sourceRoutes()`. The loader
 * is never asked, so "the page shows what the file declares" is a comparison
 * between two independent readings of the file.
 *
 * @returns {Promise<{plugin: string, skill: string, route: string, skillMd: string,
 *   raw: string, declared: any, manifest: any}[]>}
 */
export async function declaredSkills() {
  const { skills } = await sourceRoutes();
  const manifests = new Map();
  const out = [];
  for (const s of skills) {
    if (!manifests.has(s.plugin)) {
      manifests.set(
        s.plugin,
        JSON.parse(await readFile(join(repoRoot, "plugins", s.plugin, "plugin.json"), "utf8")),
      );
    }
    const raw = await readFile(s.skillMd, "utf8");
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
    if (!m) throw new Error(`${s.route}: SKILL.md has no frontmatter`);
    out.push({ ...s, raw, declared: parseYaml(m[1]), manifest: manifests.get(s.plugin) });
  }
  if (out.length === 0) throw new Error("no skills were found — this population is empty");
  return out;
}

/** The <main> element only — the masthead, sidebar and footer are Starlight's. */
export function mainOf(html) {
  const m = html.match(/<main\b[\s\S]*?<\/main>/i);
  return m ? m[0] : html;
}

/** The page at `route`, or a failure naming the route rather than a TypeError. */
export function pageAt(pages, route) {
  const p = pages.find((x) => x.route === route);
  if (!p) {
    throw new Error(
      `no page was built at "${route}" — the site has ${pages.length} content pages`,
    );
  }
  return p;
}

/**
 * The rendered field rows of a page: `{ label, source, note, open, dd }`.
 *
 * MOVED HERE IN PHASE 3 from no-fabrication.test.mjs, where it was private.
 * Four suites now scan field labels across all 58 pages, and four copies of a
 * label extractor is four chances for one of them to quietly stop finding
 * anything and report an absence it never looked for. One extractor, and every
 * suite that uses it also asserts it found a non-zero number of rows.
 */
export function fieldRows(html) {
  const rows = [];
  for (const dt of elementsWithAttr(html, "data-field-label")) {
    rows.push({
      // The provenance note ("from plugin.json", "derived") is a sibling span
      // inside the <dt>; it is attribution, not part of the field name. Matched
      // loosely on the class because Astro appends a scoped hash to it.
      label: toText(
        dt.inner.replace(/<span[^>]*\bclass="[^"]*\bsrc\b[^"]*"[^>]*>[\s\S]*?<\/span>/g, ""),
      ),
      source: (dt.open.match(/data-field-source="([^"]+)"/) ?? [])[1] ?? null,
      // The whole visible label INCLUDING the provenance note, which is what a
      // reader actually sees and therefore what the attribution checks assert.
      note: toText(dt.inner),
      open: dt.open,
    });
  }
  // Pair each label with the <dd> that follows it.
  const dds = [...html.matchAll(/<dd\b[^>]*>([\s\S]*?)<\/dd>/g)].map((m) => m[1]);
  return rows.map((r, i) => ({ ...r, dd: dds[i] ?? "" }));
}

export async function walk(dir) {
  const out = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

export async function distHtmlFiles() {
  return (await walk(dist)).filter((f) => f.endsWith(".html"));
}

/**
 * The CONTENT pages: every built HTML document except Starlight's 404 and the
 * root redirect stub. A redirect stub is a `<meta http-equiv="refresh">` and
 * nothing else — it renders no content and asserts nothing — so counting it as
 * a content page would make acceptance criterion 2 mean something it does not.
 */
export async function distContentPages() {
  const out = [];
  for (const f of await distHtmlFiles()) {
    const rel = relative(dist, f).split("\\").join("/");
    if (rel === "404.html") continue;
    const html = await read(f);
    if (/<meta http-equiv="refresh"/i.test(html) && !/<main/i.test(html)) continue;
    out.push({ file: f, rel, route: rel.replace(/\/?index\.html$/, ""), html });
  }
  return out;
}

export function read(path) {
  return readFile(path, "utf8");
}

/** Repo-relative, forward-slashed. */
export function rel(p, from = repoRoot) {
  return relative(from, p).split("\\").join("/");
}

const VOID = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
  "param", "source", "track", "wbr",
]);

/**
 * Every element in `html` carrying the bare attribute `attr`, as
 * `{ tag, open, inner }`. Nesting of the SAME tag is handled by depth
 * counting; that is enough for the markup this site emits and is far less
 * machinery than a real parser for a test suite.
 */
export function elementsWithAttr(html, attr) {
  const out = [];
  const opener = new RegExp(`<([a-zA-Z][a-zA-Z0-9-]*)\\b[^>]*?\\s${attr}(?=[\\s=>])[^>]*>`, "g");
  for (const m of html.matchAll(opener)) {
    const tag = m[1].toLowerCase();
    const start = m.index + m[0].length;
    if (VOID.has(tag) || m[0].endsWith("/>")) {
      out.push({ tag, open: m[0], inner: "" });
      continue;
    }
    let depth = 1;
    let i = start;
    const scan = new RegExp(`<(/?)${tag}\\b`, "gi");
    scan.lastIndex = start;
    let hit;
    while ((hit = scan.exec(html)) !== null) {
      depth += hit[1] === "/" ? -1 : 1;
      if (depth === 0) {
        i = hit.index;
        break;
      }
    }
    out.push({ tag, open: m[0], inner: html.slice(start, i) });
  }
  return out;
}

/** Visible text of an HTML fragment, entities decoded, whitespace collapsed. */
export function toText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|\u00a0/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Same as toText but WITHOUT collapsing runs of whitespace to one space. */
export function decodeEntities(html) {
  return html
    .replace(/&nbsp;/g, "\u00a0")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * Apply a text rewrite, and FAIL LOUDLY if it rewrote nothing.
 *
 * SWEEP 3, and it is a class rather than a tidy-up. Every control in this suite
 * that plants a defect does it by string replacement against an anchor in a real
 * file, and when the anchor stops matching — Astro stops emitting `</head>`,
 * frontmatter gets reformatted, a manifest is pretty-printed differently — the
 * plant silently does nothing. The test then exercises an UNMODIFIED file. Both
 * outcomes are bad and you cannot predict which you get: if the control expects
 * a failure it goes green having proven nothing, and if it expects success it
 * goes red for a reason that has nothing to do with the code under test. This
 * phase has now seen both, in three different hands.
 *
 * The fix is not to be careful with anchors. It is that a rewrite which matches
 * nothing is a broken instrument and must say so where it happens, not later and
 * somewhere else.
 *
 * @param {string} source
 * @param {string|RegExp} find
 * @param {string} replaceWith
 * @param {string} what  named in the error, so the failure identifies the plant
 */
export function plantOrThrow(source, find, replaceWith, what) {
  const after = source.replace(find, replaceWith);
  if (after === source) {
    throw new Error(
      `could not plant ${what}: no match for ${find}. The anchor this control ` +
        `depends on is no longer in the file, so the control was about to run ` +
        `against unmodified input and prove nothing.`,
    );
  }
  return after;
}
