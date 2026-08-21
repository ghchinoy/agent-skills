// Shared helpers for the guardrail suites. NOT a test file — the Node test
// runner only picks up `*.test.mjs`, so this never runs on its own.
//
// A note on why the element helpers below exist rather than a `class="..."`
// regex: Astro appends a scoped hash class to every element it renders
// (`class="entry-description astro-omx3yuj2"`), so a test that pins an exact
// class attribute breaks on a build-hash change while proving nothing extra.
// The site's markup therefore carries stable `data-*` hooks, and the tests
// address those.

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

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

/** The one plugin Phase 1 renders, and the five routes it must produce. */
export const PLUGIN = "okf-authoring";
export const EXPECTED_ROUTES = [
  "plugins/okf-authoring",
  "plugins/okf-authoring/okf-author",
  "plugins/okf-authoring/okf-validate",
  "plugins/okf-authoring/references/okf-v0.2-spec-summary",
  "plugins/okf-authoring/references/trust-vocabulary",
];

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
