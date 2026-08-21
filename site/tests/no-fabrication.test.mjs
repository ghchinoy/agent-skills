// no-fabrication.test.mjs — the gate. Acceptance criteria 8 and 9, plus the
// round-trip that makes them mean something.
//
// The rule this suite enforces: the site renders ONLY what the repo declares
// plus facts the build computed and labels as computed. Missing metadata is
// absent — the whole row omitted — never "n/a", never an empty label, never a
// default.
//
// Two properties are checked in both directions, because either alone is weak:
//   forwards  — every declared field appears on the page, byte-identically;
//   backwards — every rendered field traces back to a declared one.
// A site that dropped half its data passes the second; a site that invented a
// "Category" row passes the first.
//
// Everything expected here is parsed from the source files by this file. It
// never asks the loader what the data was. (EM ruling, 2026-08-21.)

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { parse as parseYaml } from "yaml";

import {
  PLUGIN,
  decodeEntities,
  distContentPages,
  elementsWithAttr,
  repoRoot,
  siteRoot,
  toText,
} from "./_helpers.mjs";

const run = promisify(execFile);
const SKILLS = ["okf-author", "okf-validate"];
const SKILL_MD = (s) => join(repoRoot, "plugins", PLUGIN, "skills", s, "SKILL.md");

async function declaredOf(skill) {
  const raw = await readFile(SKILL_MD(skill), "utf8");
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  assert.ok(m, `${skill}: no frontmatter`);
  return parseYaml(m[1]);
}

const pageFor = (pages, route) => {
  const p = pages.find((x) => x.route === route);
  assert.ok(p, `no page at ${route}`);
  return p;
};

/** The rendered field rows of a page: label -> the <dd> HTML. */
function fieldRows(html) {
  const rows = [];
  for (const dt of elementsWithAttr(html, "data-field-label")) {
    rows.push({
      // The provenance note ("from plugin.json", "derived") is a sibling span
      // inside the <dt>; it is attribution, not part of the field name. Matched
      // loosely on the class because Astro appends a scoped hash to it.
      label: toText(dt.inner.replace(/<span[^>]*\bclass="[^"]*\bsrc\b[^"]*"[^>]*>[\s\S]*?<\/span>/g, "")),
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

// ── AC8 ─────────────────────────────────────────────────────────────────────

test("AC8: metadata.sources renders as a list of the exact declared strings", async () => {
  const pages = await distContentPages();
  for (const skill of SKILLS) {
    const declared = await declaredOf(skill);
    const sources = declared.metadata.sources;
    assert.ok(Array.isArray(sources), `${skill}: metadata.sources is not a sequence any more`);

    const html = pageFor(pages, `plugins/${PLUGIN}/${skill}`).html;
    const rows = fieldRows(html);
    const row = rows.find((r) => r.label === "sources");
    assert.ok(row, `${skill}: no "sources" row was rendered`);

    // A real list element, one <li> per declared item, each byte-identical.
    const lists = elementsWithAttr(row.dd, "data-value-list");
    assert.equal(lists.length, 1, `${skill}: sources is not rendered as a value list`);
    const items = [...lists[0].inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((m) =>
      decodeEntities(m[1].replace(/<[^>]+>/g, "")).trim(),
    );
    assert.deepEqual(items, sources, `${skill}: rendered items are not the declared strings`);

    // …including the em dash, at codepoint level.
    assert.deepEqual(
      [...items[0]].map((c) => c.codePointAt(0)),
      [...sources[0]].map((c) => c.codePointAt(0)),
    );
  }
});

test("AC8: sources is NOT stringified — the array's toString forms appear nowhere", async () => {
  const pages = await distContentPages();
  for (const skill of SKILLS) {
    const declared = await declaredOf(skill);
    const sources = declared.metadata.sources;
    const text = decodeEntities(pageFor(pages, `plugins/${PLUGIN}/${skill}`).html);

    // The ways a sequence gets flattened by accident. Array.prototype.toString
    // is only a DISTINGUISHABLE form when there is more than one item —
    // String(["a"]) === "a" — so applying it to a one-item sequence would fail
    // on correct output. The structural check in the previous test is what
    // covers the single-item case, and it is the stronger of the two.
    const wrong = [JSON.stringify(sources), "[object Object]"];
    if (sources.length > 1) wrong.push(String(sources));
    for (const w of wrong) {
      assert.ok(!text.includes(w), `${skill}: sources was rendered as ${w.slice(0, 40)}…`);
    }
  }
});

test("AC8 control: the stringify detector fires on a stringified sequence", async () => {
  // Single-item sequences are the dangerous case: String(["a"]) === "a", which
  // looks correct. So the control uses a two-item array, where the flattened
  // form is visibly different, and proves each detector string can match.
  const sample = ["one", "two"];
  const flattened = `<dd>${String(sample)}</dd>`;
  assert.ok(flattened.includes(String(sample)), "the toString detector cannot fire");
  const jsonified = `<dd>${JSON.stringify(sample)}</dd>`;
  assert.ok(jsonified.includes(JSON.stringify(sample)), "the JSON detector cannot fire");
});

test("AC8: the build log carries the D1 advisory naming BOTH skills", async () => {
  // Built into a throwaway outDir so this cannot race the other suites, which
  // read the real dist/.
  const out = await mkdtemp(join(tmpdir(), "skills-d1-"));
  try {
    const { stdout, stderr } = await run(
      process.execPath,
      ["./node_modules/astro/bin/astro.mjs", "build", "--outDir", out],
      { cwd: siteRoot, maxBuffer: 32 * 1024 * 1024 },
    );
    const log = `${stdout}\n${stderr}`;
    for (const skill of SKILLS) {
      const line = log
        .split("\n")
        .find((l) => l.includes("[D1]") && l.includes(`skills/${skill}/SKILL.md`));
      assert.ok(line, `no D1 advisory in the build log for ${skill}`);
      assert.match(line, /metadata\.sources/);
      // The advisory says what the site DID about it, not just that it noticed.
      assert.match(line, /NOT stringified/);
      // And it points at a line, so a reader can go and look.
      assert.match(line, /SKILL\.md:\d+/);
    }
    // Advisories are reported, not repaired: the build still succeeds.
    assert.match(log, /Complete!/);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

// ── AC9 ─────────────────────────────────────────────────────────────────────
//
// The criterion as written — "neither page contains the strings Compatibility,
// Author, Framework or Trigger" — is unsatisfiable against this data and
// collides with AC7: okf-author's 755-character declared description literally
// begins with the word "Author", the plugin's display name is "OKF Authoring",
// and plugin.json declares an `author` object that Agent Plugins §5.4 expressly
// permits. Suppressing any of those would be letting a string detector edit the
// repo's own content, which is the inverse of the anti-fabrication rule.
//
// Ruled by the EM on 2026-08-21: scan rendered metadata LABELS on SKILL pages.
// What the criterion is actually guarding against is invented FIELDS — a
// "Compatibility: …" row for a skill that declares no compatibility, a
// "Framework" or "Trigger" taxonomy this repo does not have. That is exactly
// what a label scan catches, and it is what these tests do.

const FORBIDDEN_LABELS = ["compatibility", "author", "framework", "trigger"];

test("AC9: no skill page renders a Compatibility, Author, Framework or Trigger label", async () => {
  const pages = await distContentPages();
  for (const skill of SKILLS) {
    const declared = await declaredOf(skill);
    // Precondition: these skills genuinely declare none of them, so a rendered
    // label for any would have been invented rather than read.
    for (const f of FORBIDDEN_LABELS) {
      assert.equal(declared[f], undefined, `${skill} declares ${f} — retune this test`);
    }

    const rows = fieldRows(pageFor(pages, `plugins/${PLUGIN}/${skill}`).html);
    const offending = rows
      .map((r) => r.label.toLowerCase().replace(/[^a-z-]/g, ""))
      .filter((l) => FORBIDDEN_LABELS.includes(l));
    assert.deepEqual(offending, [], `${skill}: fabricated field label(s) ${offending.join(", ")}`);
  }
});

test("AC9 control: the label detector fires on a fabricated Compatibility row", () => {
  // POSITIVE control. Without this, "no offending labels" could just mean the
  // extractor found no labels at all.
  const fabricated = `
    <dl><div class="field-row">
      <dt data-field-label data-field-source="skill-frontmatter">compatibility</dt>
      <dd>any skills-compatible agent</dd>
    </div></dl>`;
  const rows = fieldRows(fabricated);
  assert.equal(rows.length, 1, "the row extractor found nothing in a page that has a row");
  assert.ok(FORBIDDEN_LABELS.includes(rows[0].label.toLowerCase()));
});

test("AC9 control: the extractor really does find the labels the real pages carry", async () => {
  // The other half of the same worry, on real output.
  const pages = await distContentPages();
  const rows = fieldRows(pageFor(pages, `plugins/${PLUGIN}/okf-author`).html);
  assert.ok(rows.length >= 4, `only ${rows.length} field rows found — extractor is not working`);
  const labels = rows.map((r) => r.label);
  assert.ok(labels.includes("name"), `expected a name row; got ${JSON.stringify(labels)}`);
  assert.ok(labels.includes("sources"), `expected a sources row; got ${JSON.stringify(labels)}`);
});

test("AC9 scope: the word Author DOES appear in prose, and that is correct", async () => {
  // NEGATIVE control for the scoping decision, and the evidence for the ruling.
  // A whole-page string scan would fire here — on the author's own declared
  // description and H1. The label scan does not. If this test ever stops
  // finding the word in prose, the scoping was unnecessary and should be
  // revisited rather than kept out of habit.
  const pages = await distContentPages();
  const skillHtml = pageFor(pages, `plugins/${PLUGIN}/okf-author`).html;
  const declared = await declaredOf("okf-author");

  assert.ok(declared.description.startsWith("Author"), "the description no longer begins with Author");
  assert.ok(toText(skillHtml).includes("Author"), "the declared word was suppressed from the page");

  // The plugin page renders plugin.json's declared author object, labelled as
  // coming from the manifest — declared data, on the page that declares it.
  const manifest = JSON.parse(
    await readFile(join(repoRoot, "plugins", PLUGIN, "plugin.json"), "utf8"),
  );
  assert.ok(manifest.author, "plugin.json no longer declares an author");
  const pluginRows = fieldRows(pageFor(pages, `plugins/${PLUGIN}`).html);
  const authorRow = pluginRows.find((r) => r.label.toLowerCase() === "author");
  assert.ok(authorRow, "the declared plugin.json author was dropped from the plugin page");
  assert.equal(authorRow.source, "plugin-manifest", "the author row is not attributed to the manifest");
  assert.ok(
    toText(authorRow.dd).includes(manifest.author.name ?? manifest.author),
    "the rendered author is not the declared one",
  );
});

test("no taxonomy this repo does not have: no Tags or Category label anywhere", async () => {
  const pages = await distContentPages();
  const bad = [];
  for (const p of pages) {
    for (const r of fieldRows(p.html)) {
      if (/^(tags?|category|categories|difficulty|rating|popularity)$/i.test(r.label.trim())) {
        bad.push(`${p.route}: ${r.label}`);
      }
    }
  }
  assert.deepEqual(bad, [], `invented taxonomy rendered:\n${bad.join("\n")}`);
});

// ── The round trip ──────────────────────────────────────────────────────────

test("forwards: every declared frontmatter field appears on the skill page, byte-identically", async () => {
  const pages = await distContentPages();
  for (const skill of SKILLS) {
    const declared = await declaredOf(skill);
    const html = pageFor(pages, `plugins/${PLUGIN}/${skill}`).html;
    // <main> only. Starlight also writes the description into a <meta> tag in
    // the head, so a whole-document scan would report a clipped description as
    // present — the string is in the file, just not where a reader can see it.
    const main = html.match(/<main\b[\s\S]*?<\/main>/i)?.[0] ?? html;
    const text = decodeEntities(main).replace(/\s+/g, " ");

    for (const [key, value] of Object.entries(declared)) {
      const values =
        typeof value === "string"
          ? [value]
          : Array.isArray(value)
            ? value
            : Object.values(value).flatMap((v) => (Array.isArray(v) ? v : [v]));
      for (const v of values) {
        assert.ok(
          text.includes(String(v).replace(/\s+/g, " ")),
          `${skill}: declared ${key} value is missing from the page: ${String(v).slice(0, 60)}…`,
        );
      }
    }
  }
});

test("backwards: every rendered field label traces to a declared key or is marked derived", async () => {
  const pages = await distContentPages();
  const manifest = JSON.parse(
    await readFile(join(repoRoot, "plugins", PLUGIN, "plugin.json"), "utf8"),
  );

  for (const skill of SKILLS) {
    const declared = await declaredOf(skill);
    const allowed = new Set([
      ...Object.keys(declared),
      ...Object.keys(declared.metadata ?? {}),
    ]);
    for (const r of fieldRows(pageFor(pages, `plugins/${PLUGIN}/${skill}`).html)) {
      const label = r.label.trim();
      if (r.source === "derived") continue; // labelled as computed; checked below
      if (r.source === "plugin-manifest") {
        // A skill page may also show fields of the plugin that ships it — the
        // manifest's keywords, for instance. Those must be real manifest keys
        // AND must say on the page that they came from the manifest, so a
        // reader never has to guess which document a value belongs to.
        assert.ok(
          Object.keys(manifest).includes(label),
          `${skill}: manifest-sourced label "${label}" is not a key of plugin.json`,
        );
        assert.match(r.note, /from plugin\.json/, `"${label}" is not attributed on the page`);
        continue;
      }
      assert.ok(allowed.has(label), `${skill}: rendered label "${label}" is not a declared key`);
      assert.equal(r.source, "skill-frontmatter");
    }
  }

  for (const r of fieldRows(pageFor(pages, `plugins/${PLUGIN}`).html)) {
    if (r.source === "derived") continue;
    assert.ok(
      Object.keys(manifest).includes(r.label.trim()),
      `plugin page: rendered label "${r.label}" is not a key of plugin.json`,
    );
    assert.equal(r.source, "plugin-manifest");
    assert.match(r.note, /from plugin\.json/, `"${r.label}" is not attributed to its source`);
  }
});

test("derived values are labelled as derived, and there are some", async () => {
  const pages = await distContentPages();
  const derived = fieldRows(pageFor(pages, `plugins/${PLUGIN}/okf-author`).html).filter(
    (r) => r.source === "derived",
  );
  assert.ok(derived.length > 0, "nothing is marked derived — the attribution is not being emitted");
  for (const r of derived) {
    assert.match(
      r.open,
      /derived/,
      `derived row "${r.label}" does not say so where a reader can see it`,
    );
  }
});

// ── Absence ─────────────────────────────────────────────────────────────────

/** A value slot is a placeholder when the WHOLE slot is one of these. */
const PLACEHOLDER_VALUES = [
  "n/a",
  "N/A",
  "na",
  "not available",
  "unknown",
  "TBD",
  "tbd",
  "none",
  "none specified",
  "undefined",
  "null",
  "-",
  "—",
  "?",
  "[object Object]",
];

test("absent metadata is ABSENT: no value slot holds a placeholder", async () => {
  // Scoped to VALUE SLOTS — <dd> cells and their list items — not to page text.
  // Both skill descriptions legitimately contain the word "unknown" ("preserves
  // unknown keys for forward-compatibility"); that is the repo's prose and the
  // site renders it verbatim. What is forbidden is a value that IS a
  // placeholder, standing in for data the repo never declared.
  const pages = await distContentPages();
  const hits = [];
  for (const p of pages) {
    const slots = [];
    for (const m of p.html.matchAll(/<dd\b[^>]*>([\s\S]*?)<\/dd>/g)) {
      slots.push(m[1]);
      for (const li of m[1].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)) slots.push(li[1]);
    }
    for (const slot of slots) {
      const text = toText(slot);
      if (PLACEHOLDER_VALUES.some((v) => text.toLowerCase() === v.toLowerCase())) {
        hits.push(`${p.route}: "${text}"`);
      }
    }
  }
  assert.deepEqual(hits, [], `placeholder values rendered:\n${hits.join("\n")}`);
});

test("no stringified JS artefact reaches any page", async () => {
  // These have no legitimate reading anywhere on the page, in prose or in a
  // value, so they are checked against the full rendered text.
  const pages = await distContentPages();
  const hits = [];
  for (const p of pages) {
    const text = toText(p.html);
    for (const artefact of ["[object Object]", "undefined", "NaN"]) {
      if (text.includes(artefact)) hits.push(`${p.route}: ${artefact}`);
    }
  }
  assert.deepEqual(hits, [], `JS artefacts rendered:\n${hits.join("\n")}`);
});

test("absent metadata control: both detectors fire on output that has the fault", () => {
  const slotText = toText("<dd>n/a</dd>".match(/<dd\b[^>]*>([\s\S]*?)<\/dd>/)[1]);
  assert.ok(PLACEHOLDER_VALUES.some((v) => slotText.toLowerCase() === v.toLowerCase()));
  // …and does NOT fire on a legitimate value that merely contains the word.
  const prose = toText("<dd>preserves unknown keys for forward-compatibility</dd>");
  assert.ok(!PLACEHOLDER_VALUES.some((v) => prose.toLowerCase() === v.toLowerCase()));
  assert.ok(toText("<p>x [object Object] y</p>").includes("[object Object]"));
});

test("no empty rows: every rendered label has a non-empty value", async () => {
  const pages = await distContentPages();
  const empty = [];
  for (const p of pages) {
    for (const r of fieldRows(p.html)) {
      if (toText(r.dd) === "") empty.push(`${p.route}: ${r.label}`);
    }
  }
  assert.deepEqual(empty, [], `labels rendered with no value:\n${empty.join("\n")}`);
});

test("fields these skills do NOT declare are rendered nowhere", async () => {
  // The direct form of "missing metadata renders as absent — the whole row
  // omitted". Neither skill declares compatibility or allowed-tools, and the
  // spec's vocabulary is closed, so those two rows must simply not exist.
  const pages = await distContentPages();
  for (const skill of SKILLS) {
    const declared = await declaredOf(skill);
    const labels = fieldRows(pageFor(pages, `plugins/${PLUGIN}/${skill}`).html).map((r) =>
      r.label.trim(),
    );
    for (const field of ["compatibility", "allowed-tools"]) {
      assert.equal(declared[field], undefined, `${skill} now declares ${field} — retune`);
      assert.ok(!labels.includes(field), `${skill}: ${field} row exists but nothing declares it`);
    }
  }
});

// ── Over-claiming ───────────────────────────────────────────────────────────

test("the site's own copy makes no capability claim the repo does not support", async () => {
  // Scoped to the strings the SITE writes — its templates — not to the rendered
  // page. Declared prose belongs to the repo and is rendered verbatim; a
  // detector that policed it would be demanding the site edit its sources. What
  // the site is answerable for is its own chrome.
  const OVERCLAIM = [
    /any skills-compatible agent/i,
    /works with (any|all|every)\b/i,
    /compatible with (any|all|every)\b/i,
    /supports? (any|all|every)\b/i,
    /guaranteed/i,
    /production[- ]ready/i,
    /fully (tested|validated|verified)/i,
  ];
  const templates = [
    "src/components/EntryMeta.astro",
    "src/components/MarkdownContent.astro",
    "src/sidebar.mjs",
    "src/site.config.mjs",
    "astro.config.mjs",
  ];
  const hits = [];
  for (const t of templates) {
    const text = await readFile(join(siteRoot, t), "utf8");
    for (const re of OVERCLAIM) {
      const m = text.match(re);
      if (m) hits.push(`${t}: ${m[0]}`);
    }
  }
  assert.deepEqual(hits, [], `the site's own copy over-claims:\n${hits.join("\n")}`);
});

test("over-claim control: the detector fires on 'any skills-compatible agent'", () => {
  // The exact phrase a catalog like this is most tempted to write, and cannot
  // substantiate: nothing in this repo tests these skills against any agent.
  const sample = "These skills run in any skills-compatible agent.";
  assert.ok(/any skills-compatible agent/i.test(sample), "the over-claim detector cannot fire");
  assert.ok(!/any skills-compatible agent/i.test("Install with the CLI shown above."));
});
