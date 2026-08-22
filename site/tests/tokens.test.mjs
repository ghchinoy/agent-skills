// tokens.test.mjs — Phase 5 AC6.
//
// AC6: "`src/styles/tokens.css` exists and is the file site B will copy."
//
// ── HALF OF THIS CRITERION IS NOT A GATE, AND SAYING SO IS THE POINT ────────
//
// "is the file site B will copy" IS NOT TESTABLE FROM THIS REPOSITORY. Site B
// does not exist here, has no commit to pin, and nothing in this checkout can
// observe whether anyone copies anything. Any assertion written for that clause
// would be an assertion about this repository wearing the words of a claim
// about another one, and it would pass forever regardless of what site B does.
// THE STANDING QUESTION — ask what result would have counted as a failure —
// has no answer for that clause, so it is reported as NOT A GATE rather than
// as a pass. A future phase that actually creates site B can bind it; until
// then the honest status is unverified, not green.
//
// ── WHAT IS TESTABLE IS THE PROPERTY THAT MAKES COPYING SAFE ────────────────
//
// The file carries its own declaration, in its own header:
//
//   "Every value below is a presentation choice. Nothing here encodes a fact
//    about the catalog."
//
// That is the substance of "site B will copy it". A stylesheet that encoded a
// fact about THIS catalog — a count, a plugin name, a skill name, this
// repository's slug — could not be copied to another site without carrying a
// falsehood into it, and the copy would be wrong the moment it landed rather
// than drifting wrong later. So the declaration is the criterion's real
// content, and the control below is built FROM THE DECLARATION rather than
// from the stylesheet: E-4's ladder, rung one.
//
// The declaration also carries an EXAMPLE ("a palette, a type scale and two
// accents"). Per the EM's ruling on declarations that carry examples, the
// samples below are drawn from the GENERAL CLAIM — any catalog fact — and the
// examples are used only as a negative check: if every sample resembled a
// palette entry, the control would have re-derived the implementation through
// the docstring and proven nothing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { repoRoot, siteRoot, walk } from "./_helpers.mjs";

const TOKENS = join(siteRoot, "src/styles/tokens.css");

/** Facts about THIS catalog, read from the catalog rather than typed here. */
async function catalogFacts() {
  const marketplace = JSON.parse(
    await readFile(join(repoRoot, ".claude-plugin/marketplace.json"), "utf8"),
  );
  const pluginNames = marketplace.plugins.map((p) => p.name).filter(Boolean);
  const skillNames = [];
  for (const plugin of marketplace.plugins) {
    const dir = join(repoRoot, plugin.source.replace(/^\.\//, ""), "skills");
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        await stat(join(dir, entry.name, "SKILL.md"));
        skillNames.push(entry.name);
      } catch {
        /* not a skill */
      }
    }
  }
  return {
    pluginNames,
    skillNames,
    counts: [String(pluginNames.length), String(skillNames.length)],
    slug: "ghchinoy/agent-skills",
  };
}

/** Catalog facts appearing in `text`, as `kind:value`. */
function catalogFactsIn(text, facts) {
  const found = [];
  const lower = text.toLowerCase();
  for (const name of facts.pluginNames) {
    if (name.length >= 4 && lower.includes(name.toLowerCase())) found.push(`plugin:${name}`);
  }
  for (const name of facts.skillNames) {
    if (name.length >= 4 && lower.includes(name.toLowerCase())) found.push(`skill:${name}`);
  }
  // Counts are matched as standalone numbers: a colour like #101010 and a
  // z-index of 10 are not the plugin count, and a scan that said they were
  // would be deleted within a day.
  for (const n of facts.counts) {
    if (new RegExp(`(?<![\\w.#-])${n}(?![\\w.%-])`).test(text)) found.push(`count:${n}`);
  }
  if (lower.includes(facts.slug.toLowerCase())) found.push(`slug:${facts.slug}`);
  return found;
}

test("AC6: tokens.css exists, is wired into the build, and its values reach the page", async () => {
  // EXISTS. Read rather than stat'd, because an empty file also exists.
  const css = await readFile(TOKENS, "utf8");
  assert.ok(css.length > 500, `tokens.css is ${css.length} bytes — that is not a brand seam`);

  const props = [...css.matchAll(/--sl-[\w-]+\s*:/g)].length;
  assert.ok(props >= 20, `tokens.css sets only ${props} Starlight custom properties`);

  // WIRED. A stylesheet nobody loads satisfies "exists" and changes nothing.
  const config = await readFile(join(siteRoot, "astro.config.mjs"), "utf8");
  assert.match(
    config,
    /customCss:\s*\[[^\]]*tokens\.css/,
    "tokens.css is not in Starlight's customCss — it exists and is dead",
  );

  // REACHES THE ARTIFACT. The two above are both satisfiable by a file that
  // Astro silently drops. This one reads the built CSS: pick a value the
  // stylesheet actually sets and require it in dist.
  const accent = /--sl-color-accent:\s*(#[0-9a-fA-F]{3,8})/.exec(css);
  assert.ok(accent, "tokens.css no longer sets --sl-color-accent; this check is stale");
  const built = await walk(join(siteRoot, "dist/_astro"));
  const cssFiles = built.filter((p) => p.endsWith(".css"));
  assert.ok(cssFiles.length > 0, "no built stylesheets were found");
  const bundled = (
    await Promise.all(cssFiles.map((p) => readFile(p, "utf8")))
  ).join("\n");
  assert.ok(
    bundled.toLowerCase().includes(accent[1].toLowerCase()),
    `the accent ${accent[1]} is declared in tokens.css and is in no built stylesheet`,
  );
});

test("AC6: tokens.css encodes NO fact about the catalog — the property that makes it copyable", async () => {
  const facts = await catalogFacts();
  const css = await readFile(TOKENS, "utf8");

  // UNIT: whole file. A catalog fact is a token, not a sentence, and there is
  // no prose here for a neighbour to clear.
  //
  // DENOMINATOR, named: 36 facts — 10 plugin names, 23 skill names, 2 counts
  // and the repository slug — all read from the catalog at test time rather
  // than typed here, so the set grows when the catalog does.
  //
  // The `length >= 4` guard in catalogFactsIn is the one place this population
  // could shrink without anyone noticing, so it is measured rather than
  // assumed: at the catalog as it stands it excludes ZERO of the 33 names.
  // The shortest plugin name is 6 characters (ai-pop) and the shortest skill
  // name is 10 (okf-author), both measured, neither estimated.
  // If a two-letter skill ever lands, the guard starts suppressing and this
  // assertion is what says so.
  assert.ok(facts.pluginNames.length >= 5, "too few plugin names derived to be searching for");
  assert.ok(facts.skillNames.length >= 10, "too few skill names derived to be searching for");
  const suppressed = [...facts.pluginNames, ...facts.skillNames].filter((n) => n.length < 4);
  assert.deepEqual(
    suppressed,
    [],
    `the short-name guard is silently dropping ${suppressed.length} name(s) from this scan's ` +
      "population, which makes the absence below easier to achieve than it looks",
  );

  assert.deepEqual(
    catalogFactsIn(css, facts),
    [],
    "tokens.css encodes a fact about this catalog. Its own header says it does " +
      "not, and that declaration is what makes it safe for another site to copy: " +
      "a copied stylesheet carrying this catalog's facts is wrong on arrival.",
  );
});

test("AC6 control: the catalog-fact scan fires on each kind of fact, and not on real CSS", async () => {
  const facts = await catalogFacts();

  // POSITIVE, built from the DECLARATION's general claim — "a fact about the
  // catalog" — with one sample per kind of fact rather than one per kind of
  // CSS. Deliberately NOT shaped like palette entries: if every sample looked
  // like a colour, this control would only prove the scan reads colours.
  const samples = {
    "a plugin name": `.plugin-${facts.pluginNames[0]} { color: red; }`,
    "a skill name": `/* generated for ${facts.skillNames[0]} */`,
    "a count": `:root { --catalog-plugins: ${facts.counts[0]}; }`,
    "the repository slug": `:root { --repo: "${facts.slug}"; }`,
  };
  for (const [what, sample] of Object.entries(samples)) {
    assert.ok(
      catalogFactsIn(sample, facts).length > 0,
      `the scan does not detect ${what}, so its silence on the real file means nothing`,
    );
  }

  // NEGATIVE. Real declarations from real stylesheets, each containing digits
  // or words that a careless matcher would read as a catalog fact.
  for (const benign of [
    ":root { --sl-color-accent: #4f5bd5; }",
    ":root { --sl-text-sm: 0.875rem; line-height: 1.5; }",
    ".sl-markdown-content { max-width: 100%; z-index: 10px; }",
    "@media (min-width: 1023px) { :root { --sl-content-width: 45rem; } }",
    "/* Accent — a deep indigo, distinct from Starlight's stock purple. */",
  ]) {
    assert.deepEqual(
      catalogFactsIn(benign, facts),
      [],
      `the scan flags ordinary CSS and would be deleted for noise: ${benign}`,
    );
  }
});

test("AC6: the size figure is REPORTED and deliberately NOT gated", async () => {
  // The design says "about a hundred lines". The file is 83 lines with 29
  // `--sl-` declarations. A TILDE IS NOT A FIGURE: "about a hundred" does not
  // license an assertion, and writing `assert(lines > 90)` would convert a
  // loose intention into a hard constraint that some future honest edit trips
  // over. Checked, recorded on the defect list as CHECKED-AND-NOT-A-DEFECT,
  // and not gated.
  //
  // What IS asserted is only that the file has not been emptied or exploded —
  // a range so wide it can only catch an accident, which is all that is
  // warranted here.
  const css = await readFile(TOKENS, "utf8");
  const lines = css.split("\n").length;
  assert.ok(
    lines > 20 && lines < 400,
    `tokens.css is ${lines} lines, which is outside the range an accident explains`,
  );
});
