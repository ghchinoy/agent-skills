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
  EXPECTED_ROUTES,
  PLUGIN,
  decodeEntities,
  distContentPages,
  elementsWithAttr,
  repoRoot,
  toText,
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

test("AC2: dist contains exactly 5 content pages — 1 plugin, 2 skills, 2 references", async () => {
  const pages = await distContentPages();
  assert.deepEqual(
    pages.map((p) => p.route).sort(),
    [...EXPECTED_ROUTES].sort(),
    "the built route set is not the five pages the slice declares",
  );
  assert.equal(pages.length, 5);

  // And the five are what they claim to be, not five copies of one thing.
  const kinds = pages.map((p) => p.route.replace(`plugins/${PLUGIN}`, "") || "(plugin)");
  assert.deepEqual(kinds.sort(), [
    "(plugin)",
    "/okf-author",
    "/okf-validate",
    "/references/okf-v0.2-spec-summary",
    "/references/trust-vocabulary",
  ]);
});

test("AC2: the expected route set matches what the SOURCE TREE independently declares", async () => {
  // Recomputed here from marketplace.json and the directory listing, so the
  // route list in _helpers.mjs is itself under test rather than taken on faith.
  const market = JSON.parse(
    await readFile(join(repoRoot, ".claude-plugin", "marketplace.json"), "utf8"),
  );
  const entry = market.plugins.find((p) => p.name === PLUGIN);
  assert.ok(entry, `${PLUGIN} is not listed in marketplace.json`);

  const skillDirs = (await readdir(join(PLUGIN_DIR, "skills"), { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const refFiles = (await readdir(join(PLUGIN_DIR, "references"), { withFileTypes: true }))
    .filter((d) => d.isFile() && d.name.endsWith(".md"))
    .map((d) => d.name.replace(/\.md$/, ""));

  const expected = [
    `plugins/${PLUGIN}`,
    ...skillDirs.map((s) => `plugins/${PLUGIN}/${s}`),
    ...refFiles.map((r) => `plugins/${PLUGIN}/references/${r}`),
  ].sort();
  assert.deepEqual(expected, [...EXPECTED_ROUTES].sort());
});

// ── AC3 ─────────────────────────────────────────────────────────────────────

test("AC3: zero pages from assets/example-bundle — by exact count and by content", async () => {
  const pages = await distContentPages();

  // (a) No route mentions the bundle at all.
  assert.deepEqual(
    pages.filter((p) => /example-bundle|assets/.test(p.route)).map((p) => p.route),
    [],
  );

  // (b) The count is exactly 5. There are 8 markdown files under
  // assets/example-bundle/ plus assets/README.md; a `**/*.md` glob would have
  // produced 14 pages here, so the count alone is a real discriminator.
  assert.equal(pages.length, 5);
  const bundleMd = await walkMd(join(PLUGIN_DIR, "skills", "okf-author", "assets"));
  assert.ok(bundleMd.length >= 8, "the glob trap is gone from the repo — retune this test");

  // (c) okf_version: computed, not assumed. Which ROUTED sources quote it is
  // read out of the source files right here; the proposal's "two bodies" is a
  // known erratum (three routed sources quote it, not two — see the report).
  const routed = {
    [`plugins/${PLUGIN}/okf-author`]: SKILL_MD("okf-author"),
    [`plugins/${PLUGIN}/okf-validate`]: SKILL_MD("okf-validate"),
    [`plugins/${PLUGIN}/references/okf-v0.2-spec-summary`]: REF_MD("okf-v0.2-spec-summary.md"),
    [`plugins/${PLUGIN}/references/trust-vocabulary`]: REF_MD("trust-vocabulary.md"),
  };
  const legitimate = [];
  for (const [route, file] of Object.entries(routed)) {
    if ((await readFile(file, "utf8")).includes("okf_version")) legitimate.push(route);
  }
  // The plugin page carries its skills' descriptions verbatim, so it inherits
  // the token from them. Derived here from the frontmatter rather than
  // hardcoded, so the entitlement is earned by the data, not asserted.
  const inherited = [];
  for (const skill of ["okf-author", "okf-validate"]) {
    const { data } = await source(SKILL_MD(skill));
    if (data.description.includes("okf_version")) inherited.push(skill);
  }
  if (inherited.length > 0) legitimate.push(`plugins/${PLUGIN}`);

  assert.deepEqual(
    legitimate.sort(),
    [
      `plugins/${PLUGIN}`,
      `plugins/${PLUGIN}/okf-author`,
      `plugins/${PLUGIN}/okf-validate`,
      `plugins/${PLUGIN}/references/okf-v0.2-spec-summary`,
    ],
    "the set of pages entitled to the okf_version token changed",
  );
  // trust-vocabulary quotes it nowhere, so the check below has a page that
  // MUST NOT contain the token — the assertion is not "every page is allowed".
  assert.ok(!legitimate.includes(`plugins/${PLUGIN}/references/trust-vocabulary`));

  const rendered = pages
    .filter((p) => decodeEntities(mainOf(p.html)).includes("okf_version"))
    .map((p) => p.route)
    .sort();
  assert.deepEqual(
    rendered,
    legitimate.sort(),
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
