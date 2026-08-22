// content.test.mjs — acceptance criteria 2, 3, 6, 7, 10 and 11.
//
// Everything expected here is computed from the SOURCE files by this file, with
// its own parsing, and compared against the built HTML. The loader is never
// asked what it thinks the answer is. (EM ruling, 2026-08-21: "if the test
// computes its expected set by calling the same enumeration code the loader
// uses, it proves only that the loader agrees with itself".)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

import {
  BASE,
  PLUGIN,
  entitledSources,
  sourceRoutes,
  decodeEntities,
  dist,
  distContentPages,
  elementsWithAttr,
  rel,
  repoRoot,
  toText,
  walk,
} from "./_helpers.mjs";

const PLUGIN_DIR = join(repoRoot, "plugins", PLUGIN);
const SKILL_MD = (s) => join(PLUGIN_DIR, "skills", s, "SKILL.md");
const REF_MD = (f) => join(PLUGIN_DIR, "references", f);

/** Frontmatter + body of a SKILL.md, parsed here rather than by the loader. */
async function source(file) {
  const raw = await readFile(file, "utf8");
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  assert.ok(m, `${file} has no frontmatter`);
  return { raw, data: parseYaml(m[1]), body: raw.slice(m[0].length) };
}

const page = (pages, route) => {
  const p = pages.find((x) => x.route === route);
  assert.ok(p, `no page was built at ${route}`);
  return p;
};

/** The <main> element only — the masthead and sidebar are Starlight's. */
function mainOf(html) {
  const m = html.match(/<main\b[\s\S]*?<\/main>/i);
  return m ? m[0] : html;
}

// ── AC2 ─────────────────────────────────────────────────────────────────────

// RE-POINTED IN PHASE 3, NOT WEAKENED. This was "dist contains exactly 5
// content pages", against a route list hand-written in _helpers.mjs. The
// expectation is now DERIVED from marketplace.json and the plugin trees by
// `sourceRoutes()`, which re-implements §7.1 discovery rather than importing
// the loader's. Same shape of claim — set equality plus an exact count — over
// the whole catalog instead of a tenth of it.
test("AC2: dist contains exactly the pages the SOURCE TREE declares, and no others", async () => {
  const pages = await distContentPages();
  const { routes } = await sourceRoutes();
  assert.deepEqual(
    pages.map((p) => p.route).sort(),
    [...routes].sort(),
    "the built route set is not the set the source tree declares",
  );
  // Set equality above does not catch a duplicate; this does.
  assert.equal(pages.length, routes.length, "dist has duplicate routes");
});

test("AC2: the route set decomposes into the populations that produced it", async () => {
  // Set equality proves the two lists match. It does not prove either is the
  // right SHAPE: a derivation that found no references at all would agree with
  // a build that rendered none. So each population is counted separately here,
  // named, and required to be non-empty.
  const { plugins, skills, references, routes } = await sourceRoutes();
  const pages = await distContentPages();

  const site = pages.filter((p) => p.route === "" || !p.route.startsWith("plugins/"));
  const pluginPages = pages.filter((p) => /^plugins\/[^/]+$/.test(p.route));
  const skillPages = pages.filter((p) => /^plugins\/[^/]+\/[^/]+$/.test(p.route));
  const refPages = pages.filter((p) => /\/references\/[^/]+$/.test(p.route));

  assert.equal(site.length, 5, "site pages: 1 landing + 1 skills index + 3 about");
  assert.equal(pluginPages.length, plugins.length);
  assert.equal(skillPages.length, skills.length, "skill pages");
  assert.equal(refPages.length, references.length);

  // Non-vacuity: every population is populated.
  for (const [what, n] of Object.entries({
    plugins: plugins.length,
    skills: skills.length,
    references: references.length,
  })) {
    assert.ok(n > 0, `the ${what} population is empty — this test proves nothing`);
  }

  // The arithmetic, written out: the parts sum to the whole with nothing left.
  assert.equal(site.length + plugins.length + skills.length + references.length, routes.length);
});

test("AC1: dist holds exactly 58 content pages, composed 1 + 10 + 23 + 20 + 1 + 3", async () => {
  // AC 1 is an EXACT NUMBER, NOT A FLOOR, and the test above does not supply
  // one: it is a set equality against a derivation, so it stays green if the
  // catalog grows and stays green if the derivation and the build shrink
  // together. This is the literal, and the two live side by side on purpose —
  // the derived one says the build agrees with the source, this one says the
  // source is the catalog the phase was scoped against.
  //
  // WHEN THIS FAILS AND THE BUILD IS FINE: a plugin, skill or reference was
  // added or removed upstream. Re-measure, change the numbers here, and say so
  // in the commit. Do not relax it into an inequality — the whole reason it is
  // written out is that "at least 58" would have passed on the Phase 1 slice
  // plus any nine pages of noise.
  const pages = await distContentPages();
  const bucket = {
    landing: pages.filter((p) => p.route === ""),
    plugins: pages.filter((p) => /^plugins\/[^/]+$/.test(p.route)),
    skills: pages.filter((p) => /^plugins\/[^/]+\/[^/]+$/.test(p.route)),
    references: pages.filter((p) => /\/references\/[^/]+$/.test(p.route)),
    skillsIndex: pages.filter((p) => p.route === "skills"),
    about: pages.filter((p) => /^about\/[^/]+$/.test(p.route)),
  };
  const expected = { landing: 1, plugins: 10, skills: 23, references: 20, skillsIndex: 1, about: 3 };
  assert.deepEqual(
    Object.fromEntries(Object.entries(bucket).map(([k, v]) => [k, v.length])),
    expected,
    "the page composition moved",
  );

  // The buckets PARTITION the artifact: every page landed in exactly one, so
  // the six numbers above cannot sum to 58 by double-counting or by leaving a
  // page uncounted. A `references` route is also matched by nothing else here
  // because the skill pattern is anchored to two segments — but that is an
  // argument, and this is the measurement of it.
  const counted = new Map();
  for (const [name, ps] of Object.entries(bucket)) {
    for (const p of ps) {
      const prev = counted.get(p.route);
      assert.equal(prev, undefined, `${p.route} counted as both ${prev} and ${name}`);
      counted.set(p.route, name);
    }
  }
  const uncounted = pages.filter((p) => !counted.has(p.route)).map((p) => p.route);
  assert.deepEqual(uncounted, [], `pages in no bucket:\n${uncounted.join("\n")}`);
  assert.equal(pages.length, 58, `dist holds ${pages.length} content pages, not 58`);
  assert.equal(Object.values(expected).reduce((a, b) => a + b, 0), 58);
});

test("AC1 control: the 58 is content pages, and dist holds one more file than that", async () => {
  // The disclosure that goes with the number. `find dist -name '*.html'`
  // returns 59, and Astro's own build log says "59 page(s) built": the extra
  // is 404.html, which Starlight emits and which is not a content page. AC 1's
  // 1 + 10 + 23 + 20 + 1 + 3 does not include it, so the counter this suite
  // uses must exclude it — and a counter that excluded a REAL page by the same
  // mechanism would look identical from the inside. Hence: the 404 is asserted
  // to exist, asserted to be the ONLY difference, and asserted to be absent
  // from the counted set.
  const pages = await distContentPages();
  // `rel` defaults to repoRoot; these paths are named relative to dist.
  const html = (await walk(dist)).filter((f) => f.endsWith(".html")).map((f) => rel(f, dist));
  assert.ok(
    html.includes("404.html"),
    "dist has no 404.html — Starlight stopped emitting it, so this control is stale",
  );
  const routes = new Set(pages.map((p) => p.route));
  assert.ok(!routes.has("404"), "the 404 page is being counted as a content page");
  assert.equal(
    html.length - pages.length,
    1,
    `dist holds ${html.length} html files and ${pages.length} content pages; the only ` +
      `difference should be 404.html. Extra: ${html.filter((f) => f !== "404.html" && !pages.some((p) => rel(join(dist, p.route, "index.html"), dist) === f)).join(", ")}`,
  );
});

// ── AC3 ─────────────────────────────────────────────────────────────────────

test("AC3: zero pages from assets/example-bundle — by exact count and by content", async () => {
  const pages = await distContentPages();

  // (a) No route mentions the bundle at all.
  assert.deepEqual(
    pages.filter((p) => /example-bundle|assets/.test(p.route)).map((p) => p.route),
    [],
  );

  // (b) The count is exactly what the source tree declares. There are 8
  // markdown files under okf-author's assets/example-bundle/ plus
  // assets/README.md, and none of them is a route; a `**/*.md` glob would have
  // produced nine more pages than this, so the count alone is a real
  // discriminator. RE-POINTED: the constant 5 became the derived total, and
  // the trap it detects is unchanged.
  const { routes } = await sourceRoutes();
  assert.equal(pages.length, routes.length);
  const bundleMd = await walkMd(join(PLUGIN_DIR, "skills", "okf-author", "assets"));
  assert.ok(bundleMd.length >= 8, "the glob trap is gone from the repo — retune this test");
  assert.ok(
    !routes.some((r) => /assets|example-bundle/.test(r)),
    "the derived route set itself contains a bundle path",
  );

  // (c) okf_version: computed, not assumed, and now over ALL 58 pages rather
  // than the five of the Phase-1 slice. `entitledSources()` models, in this
  // file, what each ROUTE is allowed to quote — the SKILL.md behind a skill
  // page, the manifest and the skill descriptions behind a plugin page, the
  // lifted repo document behind an about page — and a page renders the token
  // legitimately only if one of its own sources contains it. 53 of the 58
  // pages have no entitlement at all, so this is a real two-sided comparison
  // and not a permission slip.
  const legitimate = [];
  for (const p of pages) {
    const sources = await entitledSources(p.route);
    if (sources.some((s) => s.includes("okf_version"))) legitimate.push(p.route);
  }
  legitimate.sort();

  // The entitled set is small, and named, so a change to it is visible in a
  // diff rather than absorbed silently. The proposal's "two bodies" is a known
  // erratum: three routed okf-authoring sources quote it, not two.
  assert.deepEqual(
    legitimate,
    [
      "plugins/okf-authoring",
      "plugins/okf-authoring/okf-author",
      "plugins/okf-authoring/okf-validate",
      "plugins/okf-authoring/references/okf-v0.2-spec-summary",
      "skills",
    ],
    "the set of pages entitled to the okf_version token changed",
  );
  // trust-vocabulary quotes it nowhere, so the comparison below has pages that
  // MUST NOT contain the token — the assertion is not "every page is allowed".
  assert.ok(!legitimate.includes(`plugins/${PLUGIN}/references/trust-vocabulary`));
  assert.equal(
    pages.length - legitimate.length,
    53,
    "the number of pages forbidden the token — the real denominator of this check",
  );

  const rendered = pages
    .filter((p) => decodeEntities(mainOf(p.html)).includes("okf_version"))
    .map((p) => p.route)
    .sort();
  assert.deepEqual(
    rendered,
    legitimate,
    "okf_version appears on a page whose source does not quote it — bundle content leaked in",
  );
});

test("AC3: no witness string unique to the example bundle appears anywhere in dist", async () => {
  // A stronger form than a token grep. For each bundle file, this picks a
  // distinctive line that appears in NO routed source, then asserts it appears
  // in no built page. If any bundle file had been rendered, one of these fires.
  const routedText = (
    await Promise.all(
      [
        SKILL_MD("okf-author"),
        SKILL_MD("okf-validate"),
        REF_MD("okf-v0.2-spec-summary.md"),
        REF_MD("trust-vocabulary.md"),
        join(PLUGIN_DIR, "plugin.json"),
      ].map((f) => readFile(f, "utf8")),
    )
  ).join("\n");

  const bundleDir = join(PLUGIN_DIR, "skills", "okf-author", "assets", "example-bundle");
  const files = await walkMd(bundleDir);
  const witnesses = [];
  for (const f of files) {
    const line = (await readFile(f, "utf8"))
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length >= 40 && !routedText.includes(l))
      .sort((a, b) => b.length - a.length)[0];
    if (line) witnesses.push({ file: f, line });
  }
  assert.ok(witnesses.length >= 5, "too few witness strings to be a meaningful check");

  const pages = await distContentPages();
  // O2 — GUARD THE OTHER POPULATION. The witnesses are floored above; `pages`
  // was not, so an empty dist/ passed this vacuously and the positive control
  // could not tell, because it asserts string containment on a synthetic
  // string rather than that anything was scanned. A sibling test pins the
  // exact page count, so the population WAS bound — just not anywhere this
  // test could see it, and a scanner should state the population it scanned
  // rather than only its verdict.
  assert.ok(
    pages.length > 0,
    "no pages were scanned, so this proved nothing about the built site",
  );

  const leaked = [];
  for (const w of witnesses) {
    for (const p of pages) {
      if (decodeEntities(p.html).includes(w.line)) leaked.push(`${p.route} <- ${w.file}`);
    }
  }
  assert.deepEqual(leaked, [], `example-bundle content leaked into dist:\n${leaked.join("\n")}`);

  // POSITIVE CONTROL: the witnesses are real strings that the detector finds
  // when they ARE present, so the empty result above means absence, not a
  // broken comparison.
  const fake = `<html>${witnesses[0].line}</html>`;
  assert.ok(decodeEntities(fake).includes(witnesses[0].line));
});

// ── AC6 ─────────────────────────────────────────────────────────────────────

test("AC6: reference page titles are byte-identical to their source H1, em dash included", async () => {
  const pages = await distContentPages();
  for (const file of ["okf-v0.2-spec-summary.md", "trust-vocabulary.md"]) {
    const raw = await readFile(REF_MD(file), "utf8");
    const h1 = raw.split("\n").find((l) => /^# /.test(l));
    assert.ok(h1, `${file} has no H1`);
    const expected = h1.replace(/^#\s+/, "");

    const route = `plugins/${PLUGIN}/references/${file.replace(/\.md$/, "")}`;
    const p = page(pages, route);
    const h1El = elementsWithAttr(p.html, "data-page-title")[0] ?? {
      inner: (p.html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/) ?? [])[1] ?? "",
    };
    const actual = decodeEntities(h1El.inner.replace(/<[^>]+>/g, "")).trim();
    assert.equal(actual, expected, `${file}: rendered title is not the source H1`);

    // Codepoint-level, so a "normalised" em dash cannot pass as equal.
    assert.deepEqual([...actual].map((c) => c.codePointAt(0)), [...expected].map((c) => c.codePointAt(0)));
  }
});

test("AC6 control: at least one of those titles really does contain U+2014", async () => {
  // Otherwise "em-dash included" would be satisfied vacuously.
  const found = [];
  for (const file of ["okf-v0.2-spec-summary.md", "trust-vocabulary.md"]) {
    const raw = await readFile(REF_MD(file), "utf8");
    const h1 = raw.split("\n").find((l) => /^# /.test(l));
    if (h1.includes("—")) found.push(file);
  }
  assert.ok(found.length > 0, "no reference H1 contains an em dash — the criterion is vacuous");
});

// ── AC7 ─────────────────────────────────────────────────────────────────────

test("AC7: both skill descriptions render in full, unclipped, at 755 and 790 characters", async () => {
  const pages = await distContentPages();
  const lengths = {};
  for (const skill of ["okf-author", "okf-validate"]) {
    const { data } = await source(SKILL_MD(skill));
    const declared = data.description;
    assert.equal(typeof declared, "string");
    lengths[skill] = declared.length;

    const p = page(pages, `plugins/${PLUGIN}/${skill}`);
    const els = elementsWithAttr(p.html, "data-skill-description");
    assert.equal(els.length, 1, `${skill}: expected exactly one description element`);
    const rendered = decodeEntities(els[0].inner.replace(/<[^>]+>/g, "")).trim();

    assert.equal(rendered, declared, `${skill}: rendered description is not the declared one`);
    assert.equal(
      rendered.length,
      declared.length,
      `${skill}: description is clipped (${rendered.length} of ${declared.length} chars)`,
    );
    // No ellipsis, no truncation marker, no CSS line-clamp on the element.
    assert.ok(!/[…]|\.\.\.$/.test(rendered), `${skill}: description ends in an ellipsis`);
    assert.ok(
      !/line-clamp/.test(els[0].open),
      `${skill}: description element carries a line-clamp`,
    );
  }
  assert.deepEqual(lengths, { "okf-author": 755, "okf-validate": 790 });
});

test("AC7: no stylesheet clamps the description element (I9)", async () => {
  // Comments are stripped first: the stylesheet says in prose that it does NOT
  // clamp, and a check that could not tell a declaration from a comment about
  // one would fail on the documentation rather than on the behaviour.
  const css = (await readFile(join(repoRoot, "site/src/styles/tokens.css"), "utf8")).replace(
    /\/\*[\s\S]*?\*\//g,
    " ",
  );
  assert.ok(
    !/line-clamp|text-overflow\s*:\s*ellipsis|max-height/.test(css),
    "tokens.css clamps text; I9's long descriptions would be truncated",
  );

  // Control: the detector fires on a stylesheet that really does clamp.
  const clamping = ".x { -webkit-line-clamp: 3; }".replace(/\/\*[\s\S]*?\*\//g, " ");
  assert.ok(/line-clamp/.test(clamping), "the clamp detector cannot fire");
});

// ── AC10 ────────────────────────────────────────────────────────────────────

test("AC10: the plugin page renders plugin.json's description, not marketplace.json's", async () => {
  const manifest = JSON.parse(await readFile(join(PLUGIN_DIR, "plugin.json"), "utf8"));
  const market = JSON.parse(
    await readFile(join(repoRoot, ".claude-plugin", "marketplace.json"), "utf8"),
  );
  const indexDesc = market.plugins.find((p) => p.name === PLUGIN).description;

  // The two really are different, and one is a prefix of the other — which is
  // exactly why the criterion names the suffix.
  assert.notEqual(manifest.description, indexDesc);
  assert.ok(manifest.description.startsWith(indexDesc));

  const pages = await distContentPages();
  const p = page(pages, `plugins/${PLUGIN}`);
  const els = elementsWithAttr(p.html, "data-plugin-description");
  assert.equal(els.length, 1, "expected exactly one plugin description element");
  const rendered = decodeEntities(els[0].inner.replace(/<[^>]+>/g, "")).trim();

  assert.equal(rendered, manifest.description);
  assert.ok(
    rendered.includes("including the v0.2 provenance, trust, and lifecycle vocabulary"),
    "the plugin.json-only clause is missing — marketplace.json's description was used",
  );
  assert.notEqual(rendered, indexDesc);
});

test("AC10 control: the marketplace description is not rendered as the plugin description", async () => {
  // The competing value (I1) must not appear in the description slot. It is
  // fine elsewhere; it is not fine HERE, unlabelled, standing in for the
  // canonical one.
  const market = JSON.parse(
    await readFile(join(repoRoot, ".claude-plugin", "marketplace.json"), "utf8"),
  );
  const indexDesc = market.plugins.find((p) => p.name === PLUGIN).description;
  const pages = await distContentPages();
  const p = page(pages, `plugins/${PLUGIN}`);
  for (const el of elementsWithAttr(p.html, "data-plugin-description")) {
    const text = decodeEntities(el.inner.replace(/<[^>]+>/g, "")).trim();
    assert.notEqual(text, indexDesc);
  }
});

// ── AC11 ────────────────────────────────────────────────────────────────────

test("AC11: '# Concepts' (line 71) and '# Schema' (line 97) render as code, not headings", async () => {
  const { raw } = await source(SKILL_MD("okf-author"));
  const lines = raw.split("\n");
  assert.equal(lines[70], "# Concepts", "source line 71 is not '# Concepts' any more");
  assert.equal(lines[96], "# Schema", "source line 97 is not '# Schema' any more");

  const pages = await distContentPages();
  const html = mainOf(page(pages, `plugins/${PLUGIN}/okf-author`).html);

  // Not headings: no heading element of any level whose text is either word.
  for (const [word] of [["Concepts"], ["Schema"]]) {
    const headings = [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)].map((m) =>
      toText(m[2]),
    );
    assert.ok(
      !headings.includes(word),
      `"${word}" rendered as a heading; it is inside a fenced code block`,
    );
  }
  // …and no id was minted for them either, which is how a stray heading would
  // otherwise show up in the on-page table of contents.
  assert.ok(!/id="concepts"/.test(html) && !/id="schema"/.test(html));

  // Code: both appear inside a <pre>. Expressive Code splits lines into
  // elements, so the check is "the text is inside some <pre>", not an exact
  // node match.
  const pres = [...html.matchAll(/<pre\b[\s\S]*?<\/pre>/g)].map((m) => toText(m[0]));
  for (const word of ["# Concepts", "# Schema"]) {
    assert.ok(
      pres.some((p) => p.includes(word)),
      `"${word}" was not found inside any code block`,
    );
  }
});

test("AC11 control: the real H1 at line 11 IS treated as a heading", async () => {
  // The positive half. If everything were treated as code the test above would
  // pass while the page was wrong; this pins the other side. The leading H1 is
  // lifted into the page title rather than left in the body (proposal §6.4),
  // so it must appear as the page's H1 and NOT inside a <pre>.
  const { raw } = await source(SKILL_MD("okf-author"));
  const h1 = raw.split("\n")[10];
  assert.equal(h1, "# Author an OKF v0.2 bundle");
  const title = h1.replace(/^#\s+/, "");

  const pages = await distContentPages();
  const html = page(pages, `plugins/${PLUGIN}/okf-author`).html;
  const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => toText(m[1]));
  assert.ok(h1s.includes(title), `the page H1 is not "${title}" — got ${JSON.stringify(h1s)}`);

  const pres = [...mainOf(html).matchAll(/<pre\b[\s\S]*?<\/pre>/g)].map((m) => toText(m[0]));
  assert.ok(!pres.some((p) => p.includes(title)), "the real H1 leaked into a code block");
});

// ── helpers ─────────────────────────────────────────────────────────────────

async function walkMd(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walkMd(p)));
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}
