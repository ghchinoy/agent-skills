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
  fieldRows,
  mainOf,
  rel,
  repoRoot,
  siteRoot,
  toText,
  walk,
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

/**
 * Every string the REPOSITORY declares that the build legitimately injects
 * into page chrome: skill names and body H1s (which become <title>, sidebar
 * labels and breadcrumbs), and the plugin manifest's own prose.
 *
 * Read from the source files here, never from the loader. Longest first, so a
 * subtraction cannot leave a fragment of a longer string behind.
 */
async function declaredStrings() {
  const out = [];
  for (const skill of SKILLS) {
    const raw = await readFile(SKILL_MD(skill), "utf8");
    const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
    const data = parseYaml(fm[1]);
    out.push(data.name, data.description);
    const h1 = raw.slice(fm[0].length).match(/^#\s+(.+?)\s*$/m);
    if (h1) out.push(h1[1]);
  }
  const manifest = JSON.parse(
    await readFile(join(repoRoot, "plugins", PLUGIN, "plugin.json"), "utf8"),
  );
  out.push(manifest.name, manifest.description, ...(manifest.keywords ?? []));
  const readme = await readFile(join(repoRoot, "README.md"), "utf8");
  for (const m of readme.matchAll(/^#{2,4}\s*\d+\.\s*(.+?)\s*\(`plugins\/([a-z0-9._-]+)`\)\s*$/gm)) {
    out.push(m[1].replace(/^[^\p{L}\p{N}]+/u, "").trim());
  }
  return out
    .filter((s) => typeof s === "string" && s.trim() !== "")
    .sort((a, b) => b.length - a.length);
}

const pageFor = (pages, route) => {
  const p = pages.find((x) => x.route === route);
  assert.ok(p, `no page at ${route}`);
  return p;
};

// `fieldRows` used to live here. It is in _helpers.mjs as of Phase 3, because
// four suites now scan labels and they must all scan them the same way.

// ── AC8 ─────────────────────────────────────────────────────────────────────

test("AC8: sources moved to SKILL.md body and render verbatim in main markdown", async () => {
  const pages = await distContentPages();
  const EXPECTED_SOURCE =
    "Open Knowledge Format (OKF) SPEC.md v0.2 — GoogleCloudPlatform/knowledge-catalog, okf/SPEC.md";
  for (const skill of SKILLS) {
    const declared = await declaredOf(skill);
    assert.equal(declared.metadata?.sources, undefined, `${skill}: metadata.sources still in frontmatter`);

    const html = pageFor(pages, `plugins/${PLUGIN}/${skill}`).html;
    const rows = fieldRows(html);
    const row = rows.find((r) => r.label === "sources");
    assert.equal(row, undefined, `${skill}: unexpected "sources" metadata row was rendered`);

    // Renders verbatim in the markdown body under Sources
    const main = mainOf(html);
    assert.ok(toText(main).includes(EXPECTED_SOURCE), `${skill}: body missing source citation`);
  }
});

test("AC8: absent metadata.sources emits no field row", async () => {
  const pages = await distContentPages();
  for (const skill of SKILLS) {
    const html = pageFor(pages, `plugins/${PLUGIN}/${skill}`).html;
    const rows = fieldRows(html);
    assert.ok(!rows.some((r) => r.label === "sources"), `${skill}: sources rendered as metadata field`);
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

test("AC8 control: D1 advisory fires on planted frontmatter sequence", async () => {
  const { analyzeDeclared } = await import("../src/loaders/frontmatter.mjs");
  const plantedData = {
    name: "okf-author",
    description: "test description",
    metadata: {
      sources: ["planted source entry"],
    },
  };
  const { advisories } = analyzeDeclared(plantedData, {
    file: "plugins/okf-authoring/skills/okf-author/SKILL.md",
    fmText: "name: okf-author\ndescription: test\nmetadata:\n  sources:\n    - planted source entry\n",
    fmFirstLine: 2,
    expectedName: "okf-author",
  });
  const d1 = advisories.find((a) => a.code === "D1");
  assert.ok(d1, "analyzeDeclared did not emit D1 for planted sequence");
  assert.match(d1.message, /NOT stringified/);
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
  assert.ok(labels.includes("version"), `expected a version row; got ${JSON.stringify(labels)}`);
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

/** Phase 3 AC7's three names, plus the neighbouring inventions. */
const INVENTED_TAXONOMY = /^(tags?|category|categories|difficulty|rating|popularity)$/i;

test("AC7: no page renders Tags, Category or Categories as a metadata label", async () => {
  // ACROSS THE WHOLE SITE, and the denominator is stated because an absence
  // claim is only as wide as the population it swept. Phase 1 ran this over 5
  // pages; it now runs over every content page the build produced.
  const pages = await distContentPages();
  const bad = [];
  let scanned = 0;
  for (const p of pages) {
    for (const r of fieldRows(p.html)) {
      scanned += 1;
      if (INVENTED_TAXONOMY.test(r.label.trim())) bad.push(`${p.route}: ${r.label}`);
    }
  }
  assert.deepEqual(bad, [], `invented taxonomy rendered:\n${bad.join("\n")}`);
  // NON-VACUITY. "No offending label on 58 pages" and "no label found on 58
  // pages" produce the same empty array, and only one of them is the claim.
  assert.ok(
    scanned > pages.length,
    `only ${scanned} field labels found across ${pages.length} pages — fewer than ` +
      `one per page, so this sweep is not reading the rows it claims to check`,
  );
});

test("AC7 control: the taxonomy detector fires on each of the three names", async () => {
  // POSITIVE control, per name rather than per detector: a regexp that lost one
  // alternative would still fire on the other two and look alive.
  for (const name of ["Tags", "Category", "Categories"]) {
    const planted = `<dl><div class="field-row">
      <dt data-field-label data-field-source="derived">${name} <span class="src">derived</span></dt>
      <dd>workflow</dd>
    </div></dl>`;
    const rows = fieldRows(planted);
    assert.equal(rows.length, 1, `the extractor found no row in markup that has one (${name})`);
    assert.ok(
      INVENTED_TAXONOMY.test(rows[0].label.trim()),
      `the detector does not fire on a "${name}" label`,
    );
  }
  // NEGATIVE: it must not fire on the real labels this catalog does render, or
  // it is a detector for the letter T. `keywords` is the closest legitimate
  // neighbour — Agent Plugins §5.4 calls them "search and discovery tags".
  const pages = await distContentPages();
  const real = new Set();
  for (const p of pages) for (const r of fieldRows(p.html)) real.add(r.label.trim());
  assert.ok(real.has("keywords"), "the catalog no longer renders keywords — retune this control");
  for (const label of real) {
    assert.ok(!INVENTED_TAXONOMY.test(label), `the detector fires on the real label "${label}"`);
  }
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
//
// §12 asks for over-claim phrasing to be absent from `dist/`, "with positive
// and negative controls — the negative controls must include the legitimate
// phrase 'any skills-compatible agent', so the detector does not ban the
// accurate wording along with the inaccurate ones."
//
// The first version of this block got that backwards: it listed "any
// skills-compatible agent" as the FIRST BANNED pattern. §1.4 names that exact
// phrase as the one accurate hedge — "use it across any skills-compatible
// agent — not 'any agent'. That one word is the whole difference between
// accurate and overclaiming." A gate that banned it would have failed the
// build for using the correct wording and pushed the copy toward the
// inaccurate version, which inverts what the guardrail is for. It is now the
// mandated NEGATIVE control instead.
//
// The hedge is handled by NEUTRALISING it before the patterns run, rather than
// by lookaheads bolted onto each pattern. "Works with any skills-compatible
// agent" must not fire even though it contains "works with any"; "works with
// any agent" must still fire in the very same document. One exemption, written
// once, is easier to audit than seven.
//
// Every pattern below carries BOTH controls, and the negative control of each
// is a NEAR MISS: legitimate wording close enough to the pattern that it could
// plausibly trip it. A control that could never have fired proves nothing,
// which is the point §12 makes about detectors nobody has shown can fire.

// ── A KNOWN, DELIBERATE RESIDUAL (F3) ──────────────────────────────────────
//
// This detector does not catch a banned phrase whose head is separated from
// its quantifier by an intervening list item:
//
//   "It supports any skills-compatible agent, any agent, and every agent"
//
// The hedge is scrubbed first, which leaves "supports  , any agent, ..." —
// and "supports" is no longer adjacent to a quantifier, so nothing fires.
// The claim is real and the detector is silent on it.
//
// IT IS LEFT OPEN ON PURPOSE. The obvious closure — let the head match a
// quantifier anywhere later in the sentence, or treat commas as skippable —
// fires on honest prose that this project actively wants people to write:
//
//   "any agent that implements the spec"
//   "the loader supports the six declared fields, and any agent may read them"
//
// A detector that punishes accurate hedging is the R2 failure inverted: R2 was
// blocking precisely because the guardrail banned the one phrase §1.4 requires.
// Trading a contrived evasion for false positives on careful writing would
// reintroduce that defect from the other side, and the predictable result is
// that the next developer deletes the detector rather than fights it.
//
// BEFORE YOU "FIX" THIS, weigh:
//   1. Has this shape ever appeared in real copy here? It has not. The evasion
//      requires writing the hedge AND the unhedged claim in one sentence,
//      which is not what accidental over-claiming looks like.
//   2. Whatever you add, run it against every negative control below AND
//      against the repo's own SKILL.md prose. If it fires on any of them, the
//      cure is worse than the disease.
//   3. This gate is one of several. §12's rendered-chrome scan, the declared
//      round trip and human review all sit downstream of it.
//
// The behaviour is pinned by a test below so that closing it is a deliberate,
// visible act rather than a silent one.

/** The one accurate hedge (§1.4/§12). Exempt, and asserted exempt below. */
const HEDGE = /\bany skills-compatible agents?\b/gi;

// C1, verb shadowing: `works with any` was written as three literal words with
// literal single spaces, so "works SEAMLESSLY with any agent" walked straight
// past it. The gap below is deliberately NOT `\w+` — that would fire on "this
// works because it deals with any of the six fields", which is honest prose.
// It is adverbs only, which is what shadowing actually looks like in marketing
// copy, and at most two of them.
const ADV = String.raw`(?:\w+ly\s+){0,2}`;

const OVERCLAIM = [
  {
    id: "works-with-any",
    re: new RegExp(String.raw`\bworks\s+${ADV}with\s+${ADV}(any|all|every)\b`, "i"),
    fires: "This catalog works with any agent.",
    // Near miss: same three opening words, hedged correctly.
    nearMiss: "This catalog works with any skills-compatible agent.",
    // Shadowed positive: the evasion C1 identified.
    shadowed: "This catalog works seamlessly with any agent.",
  },
  {
    id: "compatible-with-any",
    re: new RegExp(String.raw`\bcompatible\s+${ADV}with\s+${ADV}(any|all|every)\b`, "i"),
    fires: "These skills are compatible with all agents.",
    nearMiss: "These skills are compatible with any skills-compatible agent.",
    shadowed: "These skills are compatible with virtually any agent.",
  },
  {
    id: "supports-any",
    re: new RegExp(String.raw`\bsupports?\s+${ADV}(any|all|every)\b`, "i"),
    fires: "The format supports every agent on the market.",
    // Near miss: "supports" immediately followed by a bounded noun, not a
    // universal quantifier. One word away from firing.
    nearMiss: "The loader supports the six fields the Agent Skills vocabulary defines.",
    shadowed: "The format supports essentially every agent on the market.",
  },
  {
    id: "agent-agnostic",
    re: /\bagent[- ]agnostic\b/i,
    fires: "An agent-agnostic bundle format.",
    // Near miss: contains both words, in that order, not adjacent.
    nearMiss: "The bundle format is agnostic about which agent reads it, within the spec.",
  },
  {
    id: "guaranteed",
    re: /\bguaranteed\b/i,
    fires: "Correct output is guaranteed.",
    // Near miss: same stem, and a sentence explicitly REFUSING the claim.
    nearMiss: "This build makes no guarantee about how any agent will behave.",
  },
  {
    id: "production-ready",
    re: /\bproduction[- ]ready\b/i,
    fires: "A production-ready plugin catalog.",
    // Near miss: both words present, separated.
    nearMiss: "Read it before you put any of this into production, then decide when it is ready.",
  },
  {
    id: "fully-tested",
    re: /\bfully (tested|validated|verified)\b/i,
    fires: "Every skill here is fully tested.",
    // Near miss: both words present, not adjacent — and the claim is scoped.
    nearMiss: "The eleven criteria are fully enumerated, and each one is tested.",
  },
];

/**
 * Flattens the text a claim could hide in the whitespace of.
 *
 * C1, line-wrap brittleness: every pattern here is a multi-word phrase, and in
 * a source file a multi-word phrase is exactly the thing that gets wrapped
 * across two lines by a formatter — usually with a comment leader glued to the
 * front of the second one. `// works with\n// any agent` matched nothing. That
 * is not a hypothetical evasion so much as the normal fate of a long sentence
 * in a comment block, which is where most of this site's prose lives.
 *
 * So: drop line-leading comment markers, then collapse all runs of whitespace
 * to one space, before any pattern runs.
 */
function flatten(text) {
  return text
    .replace(/\r\n?/g, "\n")
    // line-leading comment markers, so a wrapped comment reads as prose
    .replace(/^[ \t]*(?:\/\/+|\*+|#+|<!--)[ \t]?/gm, " ")
    // a hyphenated term broken AT the hyphen: "production-\nready"
    .replace(/-[ \t]*\n[ \t]*/g, "-")
    .replace(/\s+/g, " ");
}

/** Blanks the accurate hedge, then reports every banned pattern that matches. */
function overclaimHits(text) {
  const scrubbed = flatten(text).replace(HEDGE, " ");
  return OVERCLAIM.filter((p) => p.re.test(scrubbed)).map((p) => ({
    id: p.id,
    match: scrubbed.match(p.re)[0],
  }));
}

/**
 * Every file the site's own copy can come from, DISCOVERED rather than listed:
 * all of `src/`, everything shipped verbatim from `public/`, the root config,
 * and the site's README.
 *
 * C1: this was a hand-written list of six paths. A hardcoded list of the files
 * that existed the day the test was written is not a scan, it is a snapshot —
 * and it rots silently, which matters because Phase 3 adds files to `src/` and
 * Phase 5 builds directly on this detector. Walking the tree covers a new
 * template the moment it lands.
 *
 * A note on the count, because the review and I disagree about it and the
 * disagreement should be visible rather than smoothed over: the finding says
 * "6 of 15 template files". I scan 14, and `src/` contains 11 files, not 15.
 * I cannot reproduce 15 and I am not going to assert a number I cannot derive,
 * so this asserts the RULE — everything under src/ and public/, plus the two
 * root files — which is stronger than any count and cannot drift.
 */
async function siteSourceFiles() {
  const out = [];
  for (const dir of ["src", "public"]) {
    for (const f of await walk(join(siteRoot, dir))) out.push(rel(f, siteRoot));
  }
  return [...out.sort(), "astro.config.mjs", "README.md"];
}

test("the site's own copy makes no capability claim the repo does not support", async () => {
  // Scope, half one: the strings the SITE writes — its templates and config.
  const templates = await siteSourceFiles();
  const hits = [];
  for (const t of templates) {
    const text = await readFile(join(siteRoot, t), "utf8");
    for (const h of overclaimHits(text)) hits.push(`${t}: [${h.id}] ${h.match}`);
  }
  assert.deepEqual(hits, [], `the site's own copy over-claims:\n${hits.join("\n")}`);
});

test("over-claim scope control: the scan covers every source file, not a stale list", async () => {
  const scanned = await siteSourceFiles();
  // The six that used to be hardcoded must still be in there…
  for (const old of [
    "src/components/EntryMeta.astro",
    "src/components/MarkdownContent.astro",
    "src/sidebar.mjs",
    "src/site.config.mjs",
    "src/loaders/skills.ts",
    "astro.config.mjs",
  ]) {
    assert.ok(scanned.includes(old), `${old} dropped out of the over-claim scan`);
  }
  // …and so must every file the old list missed. Asserted as a SET against the
  // filesystem, not as a count, so adding a template cannot quietly shrink the
  // scan's coverage without failing here.
  const onDisk = [];
  for (const dir of ["src", "public"]) {
    for (const f of await walk(join(siteRoot, dir))) onDisk.push(rel(f, siteRoot));
  }
  for (const f of onDisk) {
    assert.ok(scanned.includes(f), `${f} is site source and is not being scanned`);
  }
  assert.ok(scanned.includes("README.md"), "the site's own README is not scanned");
  // The old list covered 6. Whatever the total is, it must be more than that,
  // and it must include the styles and the content config the old list missed.
  assert.ok(scanned.length > 6);
  assert.ok(scanned.includes("src/styles/tokens.css"));
  assert.ok(scanned.includes("src/content.config.ts"));
  // Negative: the scan must not wander outside the site's own source into the
  // repository's declared content, which it does not author and may not police.
  assert.ok(!scanned.some((f) => f.includes("..")), "the scan escaped site/src");
});

test("the site's own copy makes no capability claim in the RENDERED chrome either", async () => {
  // Scope, half two, and the one §12 actually names: `dist/`.
  //
  // Not the whole page. Declared prose is rendered verbatim inside <main>, and
  // a detector that policed it would be demanding the site edit the
  // repository's own SKILL.md files — the "suppress declared data to keep a
  // detector quiet" failure the brief forbids. So: everything OUTSIDE <main>,
  // which is the masthead, sidebar, breadcrumb, footer and <title> — the
  // strings the site is answerable for — MINUS the declared strings the build
  // legitimately injects there (page titles, skill names). Those are read from
  // the source files, not from the loader.
  const declared = await declaredStrings();
  const hits = [];
  for (const p of await distContentPages()) {
    let text = toText(p.html.replace(/<main\b[\s\S]*?<\/main>/gi, " "));
    for (const d of declared) text = text.split(d).join(" ");
    for (const h of overclaimHits(text)) hits.push(`${p.rel}: [${h.id}] ${h.match}`);
  }
  assert.deepEqual(hits, [], `rendered chrome over-claims:\n${hits.join("\n")}`);
});

test("over-claim controls: every pattern fires on a claim and holds on a near miss", () => {
  // The §12 requirement, pattern by pattern. Both halves are needed: without
  // the positive the detector might be dead, without the near-miss negative it
  // might be a detector for the English language.
  for (const p of OVERCLAIM) {
    assert.equal(
      overclaimHits(p.fires).map((h) => h.id).includes(p.id),
      true,
      `[${p.id}] cannot fire — it is not a gate. Sample: ${p.fires}`,
    );
    assert.deepEqual(
      overclaimHits(p.nearMiss),
      [],
      `[${p.id}] fires on legitimate near-miss wording: ${p.nearMiss}`,
    );
  }
});

test("over-claim control: an adverb between the words does not shadow the claim (C1)", () => {
  // Evasion 1. Every one of these is the same claim with a word wedged in.
  for (const p of OVERCLAIM.filter((x) => x.shadowed)) {
    assert.ok(
      overclaimHits(p.shadowed).map((h) => h.id).includes(p.id),
      `[${p.id}] is shadowed by an adverb: ${p.shadowed}`,
    );
  }
  // NEGATIVE, and the reason the gap is adverbs-only rather than `\w+`: honest
  // prose that happens to put "works" and "with any" in one sentence.
  assert.deepEqual(
    overclaimHits("This works because the loader deals with any of the six declared fields."),
    [],
    "the adverb gap is matching ordinary words and will fire on honest prose",
  );
  // NEGATIVE: an adverb AND the accurate hedge. Both mechanisms at once.
  assert.deepEqual(
    overclaimHits("This catalog works seamlessly with any skills-compatible agent."),
    [],
    "shadowing support broke the mandated hedge exemption",
  );
  // NEGATIVE: three adverbs is past the bound, and that is a deliberate limit
  // rather than an oversight — pinned so a widening is a visible choice.
  assert.deepEqual(
    overclaimHits("It works really truly seamlessly with any agent."),
    [],
    "the adverb bound has changed; update this control deliberately",
  );
});

test("over-claim: the comma-list residual is a documented, deliberate gap (F3)", () => {
  // NOT an endorsement — a pin. See the long note above HEDGE for why this is
  // left open. If you close it, this test fails, and that is the point: you
  // will have to come here and read the reasoning before overriding it.
  const evasion = "It supports any skills-compatible agent, any agent, and every agent.";
  assert.deepEqual(
    overclaimHits(evasion),
    [],
    "the comma-list residual is now closed — good, if and only if every " +
      "negative control below still passes and the honest-prose samples in " +
      "this test still do not fire. Read the note above HEDGE, then update " +
      "this test deliberately.",
  );

  // The prose the obvious fix would break. These must NEVER fire, whatever
  // anyone does to the detector — they are the reason the gap is tolerated.
  for (const honest of [
    "Build a skill once and use it across any skills-compatible agent.",
    "The format is readable by any agent that implements the spec.",
    "The loader supports the six declared fields, and any agent may read them.",
    "It is compatible with the spec, and any agent conforming to it can load the bundle.",
  ]) {
    assert.deepEqual(overclaimHits(honest), [], `honest prose must not fire: ${honest}`);
  }

  // And the gap is narrow: the same claim WITHOUT the intervening list item
  // still fires, so this is a residual and not a hole.
  assert.deepEqual(
    overclaimHits("It supports any agent.").map((h) => h.id),
    ["supports-any"],
  );
  assert.deepEqual(
    overclaimHits("It supports every agent, and any agent, too.").map((h) => h.id),
    ["supports-any"],
  );
});

test("over-claim control: a claim wrapped across lines still fires (C1)", () => {
  // Evasion 2, and the likelier one: nobody writes an evasion, a formatter
  // writes it for them. Every shape below is one banned phrase, wrapped the
  // way this codebase's own comment blocks wrap.
  const wrapped = [
    "This catalog works with\nany agent.",
    "// This catalog works with\n// any agent.",
    " * These skills are compatible with\n * every agent.",
    "The format\n  supports\n  every agent.",
    "Output is\n\tguaranteed.",
    "A production-\nready catalog.", // hyphen at the wrap point
  ];
  for (const w of wrapped) {
    assert.ok(
      overclaimHits(w).length > 0,
      `a line wrap hides this claim from the detector: ${JSON.stringify(w)}`,
    );
  }
  // NEGATIVE: flattening must not INVENT a claim by joining two unrelated
  // sentences across a paragraph break.
  assert.deepEqual(
    overclaimHits("The loader works.\n\nAny agent reading it must parse YAML."),
    [],
    "whitespace flattening manufactured a claim across a sentence boundary",
  );
});

test("over-claim control: the accurate hedge §12 mandates is permitted, in every pattern's way", () => {
  // The negative control §12 requires by name. This phrase must never fire.
  const spec14 = "Build a skill once and use it across any skills-compatible agent.";
  assert.deepEqual(overclaimHits(spec14), [], "the guardrail bans the accurate hedge");
  assert.deepEqual(overclaimHits("any skills-compatible agent"), []);
  assert.deepEqual(overclaimHits("Runs in any skills-compatible agents."), []);

  // …and the exemption is NARROW. Dropping the hedge's one load-bearing word
  // must bring the pattern straight back.
  assert.deepEqual(
    overclaimHits("Build a skill once and use it across any agent.").map((h) => h.id),
    [],
    "sanity: 'use it across any agent' is not one of the seven shapes",
  );
  assert.deepEqual(
    overclaimHits("It works with any compatible agent.").map((h) => h.id),
    ["works-with-any"],
    "'any compatible agent' is not the hedge — the hedge is 'any SKILLS-compatible agent'",
  );

  // …and neutralising the hedge does not blind the scan to a real claim
  // sitting in the same sentence.
  assert.deepEqual(
    overclaimHits("Use it in any skills-compatible agent; it works with any agent.").map((h) => h.id),
    ["works-with-any"],
    "the hedge exemption swallowed a genuine over-claim next to it",
  );
});

// ── REQUIRED 1 (Phase 3 review): the SmartyPants fix needs a DETECTION ────────
//
// `astro.config.mjs` sets `markdown: { smartypants: false }` because Astro's
// renderer was rewriting declared ASCII punctuation into typographic forms —
// 34 of 58 pages differed byte-for-byte. That fix is a PREVENTION, and the
// reviewer's mutation MC proved nothing defended it: flipping the flag back to
// `true` left all 239 tests green. A change that rewrites 59% of the site's
// rendered bytes was invisible to the suite, so the next config edit would
// revert it in silence.
//
// AC9 legitimately cannot catch it: SmartyPants does not touch fenced code, so
// the installer comparison is immune. The exposure is PROSE, and nothing
// asserted on prose bytes. This does.
//
// The gate is DERIVED, not a hand-picked canary page. For each typographic
// character, we ask the SOURCE whether it declares that character anywhere. A
// character the source never declares must never appear on a page — that is
// fabrication, the same defect this file exists to catch, arriving through the
// renderer instead of through the loader. Characters the source DOES declare
// (em dash, en dash, ellipsis — this repo writes all three deliberately) are
// excluded by measurement rather than by a list, so the gate cannot go stale
// when the corpus changes.

/** The transformations SmartyPants performs, as {rendered character → the
 *  ASCII the author actually typed}. Keys are what a page must not gain. */
const TYPOGRAPHIC = {
  "’": "'", // right single quote  ← apostrophe
  "‘": "'", // left single quote
  "“": '"', // left double quote
  "”": '"', // right double quote
  "–": "--", // en dash
  "—": "---", // em dash
  "…": "...", // ellipsis
};

const countOf = (haystack, needle) => haystack.split(needle).length - 1;

/** Every source file whose bytes can reach a rendered page. Markdown and JSON
 *  only: those are the declaring formats. Excludes `site/` — the site's own
 *  sources are not the catalog's declarations. */
async function sourceCorpus() {
  const files = (await walk(repoRoot)).filter((f) => {
    const r = rel(f);
    if (r.startsWith("site/") || r.startsWith(".git/") || r.includes("node_modules/")) return false;
    return r.endsWith(".md") || r.endsWith(".json");
  });
  const texts = await Promise.all(files.map((f) => readFile(f, "utf8")));
  return { text: texts.join("\n"), fileCount: files.length };
}

test("REQUIRED 1: no page renders a typographic character the source never declares", async () => {
  const { text: corpus, fileCount } = await sourceCorpus();
  assert.ok(fileCount > 20, `only ${fileCount} source files found — the corpus is too small to be the corpus`);

  // DERIVE which characters are gated. A character the repo writes on purpose
  // is not evidence of a transformation and is excluded here, by measurement.
  const gated = Object.keys(TYPOGRAPHIC).filter((ch) => countOf(corpus, ch) === 0);
  const declared = Object.keys(TYPOGRAPHIC).filter((ch) => countOf(corpus, ch) > 0);

  assert.ok(
    gated.length > 0,
    "the source now declares every typographic character, so this gate covers nothing — re-derive it",
  );

  // NON-VACUITY, and it is the part that matters. A gate over characters that
  // could never have appeared is worthless. Require that the ASCII the
  // renderer would have transformed is actually PRESENT in the source in
  // quantity, so there is real material for SmartyPants to act on.
  const transformable = gated.reduce((n, ch) => n + countOf(corpus, TYPOGRAPHIC[ch]), 0);
  assert.ok(
    transformable > 100,
    `only ${transformable} transformable ASCII sequences in the source — too few for the absence below to mean anything`,
  );

  const pages = await distContentPages();
  assert.equal(pages.length, 59, `swept ${pages.length} pages, not 59`);

  const found = [];
  let renderedTransformable = 0;
  for (const p of pages) {
    const text = toText(mainOf(p.html));
    for (const ch of gated) {
      const n = countOf(text, ch);
      if (n > 0) found.push(`${p.route || "(landing)"}: ${n}× U+${ch.codePointAt(0).toString(16).toUpperCase()}`);
      renderedTransformable += countOf(text, TYPOGRAPHIC[ch]);
    }
  }

  // Second non-vacuity check, this one on the ARTIFACT rather than the source:
  // the pages must actually carry the untransformed ASCII. If they carried
  // none, the absence of the smart form would prove only that the prose never
  // reached the page.
  assert.ok(
    renderedTransformable > 100,
    `the pages render only ${renderedTransformable} of the ASCII forms — the absence above is not evidence`,
  );

  assert.deepEqual(
    found,
    [],
    `pages render typographic characters absent from every source file — SmartyPants (or an equivalent) is on:\n${found.join("\n")}\n` +
      `gated: ${gated.join(" ")} | excluded because the source declares them: ${declared.join(" ") || "(none)"}`,
  );
});

test("REQUIRED 1 control: the typographic detector fires on transformed prose", async () => {
  // The gate above reports an ABSENCE. Standard 19: show the path is live.
  // This drives the same two primitives over a page-shaped string that HAS
  // been through SmartyPants, and requires each transformation to be caught.
  const { text: corpus } = await sourceCorpus();
  const gated = Object.keys(TYPOGRAPHIC).filter((ch) => countOf(corpus, ch) === 0);

  const straight = `<main><p>the model's window, "quoted", done.</p></main>`;
  const curled = `<main><p>the model’s window, “quoted”, done.</p></main>`;

  const hits = (html) => {
    const text = toText(mainOf(html));
    return gated.filter((ch) => countOf(text, ch) > 0);
  };

  assert.deepEqual(hits(straight), [], "the detector fires on prose that was never transformed");
  const caught = hits(curled);
  assert.ok(caught.includes("’"), "the detector missed a curled apostrophe");
  assert.ok(caught.includes("“") && caught.includes("”"), "the detector missed curled double quotes");

  // And the derivation itself must be live: if the corpus stopped excluding
  // the em dash the gate would start firing on legitimate declared text.
  assert.ok(
    !gated.includes("—"),
    "the em dash is gated, but this repository writes em dashes on purpose — the exclusion is not being derived",
  );
});
