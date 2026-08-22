// fields.test.mjs — acceptance criteria 3 and 8, across all 58 pages.
//
// Both are ABSENCE claims, and they fail in the two ways an absence claim can.
//
// AC3 — "the 7 metadata-less skills render no version row" — is asserted by the
// ABSENCE OF THE LABEL, never by the absence of a number. The distinction is
// the whole criterion: a page rendering `Version: n/a`, `Version: —` or an
// empty `Version:` row has no version number on it and has still invented a
// field. Almost a third of this catalog declares no `metadata` at all, entirely
// legitimately — the Agent Skills spec makes it optional — so the honest
// rendering is no row.
//
// AC8 — "no top-level frontmatter key outside the spec's six appears as a
// rendered field label" — is asserted in the OPPOSITE DIRECTION from the way it
// is written, and this is deliberate.
//
//   THE FORWARD FORM IS VACUOUS TODAY. Derive the population it quantifies
//   over — top-level keys in this repository's SKILL.md files that are not one
//   of the spec's six — and it is EMPTY. All 23 skills declare only `name`,
//   `description`, `license`, `compatibility` and `metadata`. A test that
//   iterated that set and asserted each member is unrendered would iterate zero
//   times, pass, and go on passing on the day somebody adds a seventh key.
//   That is the "correct about the instance, silent about the class" failure
//   with the instance count at zero.
//
//   SO THE PRIMARY ASSERTION RUNS BACKWARDS: over every `data-field-label` the
//   build actually rendered, on all 58 pages, each must trace to the spec's six,
//   the closed `plugin.json` vocabulary, a `metadata.*` key its own SKILL.md
//   declares, or a row explicitly marked derived. Nothing else may be on the
//   page. That is a check over a population that is not empty — it is every
//   label the site emits — and a seventh top-level key rendering as a row
//   fails it on the day it appears.
//
// The emptiness of the forward population is MEASURED below rather than
// assumed, because the reasoning above is only sound while it holds.

import { test } from "node:test";
import assert from "node:assert/strict";

import { ALLOWED_FIELDS, analyzeDeclared } from "../src/loaders/frontmatter.mjs";
import { MANIFEST_FIELDS } from "../src/loaders/enumerate.mjs";

import {
  SITE_ROUTES,
  SPEC_TOP_LEVEL_FIELDS,
  declaredSkills,
  distContentPages,
  fieldRows,
  mainOf,
  pageAt,
  toText,
} from "./_helpers.mjs";

/** Case-folded label, punctuation-free, for a comparison a reader would make. */
const norm = (label) => label.trim().toLowerCase();

// ── AC3 ─────────────────────────────────────────────────────────────────────

test("AC3: the skills that declare no version render no Version LABEL", async () => {
  // The population is derived, and both halves of it are reported: a claim
  // about "the 7 metadata-less skills" is only checkable if the 7 came from the
  // data rather than from the brief.
  const skills = await declaredSkills();
  const without = skills.filter((s) => s.declared.metadata?.version === undefined);
  const with_ = skills.filter((s) => s.declared.metadata?.version !== undefined);

  assert.equal(
    without.length + with_.length,
    skills.length,
    "the partition does not cover the population",
  );
  assert.ok(
    without.length > 0,
    `every one of the ${skills.length} skills declares a version, so this criterion has ` +
      `no population left and the absence below would be vacuous`,
  );

  const pages = await distContentPages();
  const offenders = [];
  let rowsSeen = 0;
  for (const s of without) {
    const rows = fieldRows(mainOf(pageAt(pages, s.route).html));
    rowsSeen += rows.length;
    // ABSENCE OF THE LABEL. Not "the page has no number", not "the value is
    // not n/a" — the row must not exist.
    for (const r of rows) {
      if (norm(r.label) === "version") offenders.push(`${s.route}: ${r.label} = ${toText(r.dd)}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `a version row was rendered for a skill that declares none:\n${offenders.join("\n")}`,
  );

  // NON-VACUITY. Those pages DO render field rows — they are not blank pages
  // on which every label is absent — so the absence above is about `version`
  // and not about the extractor.
  assert.ok(
    rowsSeen >= without.length * 2,
    `only ${rowsSeen} field rows across ${without.length} pages: these pages are not ` +
      `rendering the metadata they do declare, so this absence proves nothing`,
  );
});

test("AC3: the absence is a property of the DATA, not of the template", async () => {
  // The other half, and without it the test above is satisfied by a site that
  // never renders a version row at all. Every skill that DOES declare a version
  // must show the label.
  const skills = await declaredSkills();
  const with_ = skills.filter((s) => s.declared.metadata?.version !== undefined);
  assert.ok(with_.length > 0, "nothing declares a version — the template is untested");

  const pages = await distContentPages();
  const missing = [];
  for (const s of with_) {
    const rows = fieldRows(mainOf(pageAt(pages, s.route).html));
    if (!rows.some((r) => norm(r.label) === "version")) missing.push(s.route);
  }
  assert.deepEqual(
    missing,
    [],
    `these skills declare metadata.version and render no version row:\n${missing.join("\n")}`,
  );
});

test("AC3: no absent field is rendered as a placeholder on ANY page", async () => {
  // The failure mode the label-absence phrasing exists to catch, stated
  // directly. A row whose value is a dash, an "n/a" or nothing at all is a
  // fabricated field with the fabrication hidden in the value slot.
  //
  // (`no-fabrication.test.mjs` checks the value side of this over the same
  // pages. This checks the LABEL side: the six spec names and the manifest
  // vocabulary are the only field names that may appear at all, so an
  // undeclared one cannot be present-but-empty either.)
  const pages = await distContentPages();
  const bad = [];
  for (const p of pages) {
    for (const r of fieldRows(mainOf(p.html))) {
      if (toText(r.dd).trim() === "") bad.push(`${p.route}: ${r.label}`);
    }
  }
  assert.deepEqual(bad, [], `field labels rendered with an empty value:\n${bad.join("\n")}`);
});

test("AC3 control: the label scanner sees a Version label when there is one", async () => {
  // POSITIVE control, and it is aimed at the exact wording of the criterion:
  // the row it must catch has a LABEL and a placeholder VALUE, which is the
  // shape a "helpful" default produces.
  for (const value of ["1.0.0", "n/a", "—", ""]) {
    const planted = `<main><dl><div class="field-row">
      <dt data-field-label data-field-source="skill-frontmatter">Version <span class="src">from this skill's SKILL.md</span></dt>
      <dd>${value}</dd>
    </div></dl></main>`;
    const rows = fieldRows(mainOf(planted));
    assert.equal(rows.length, 1, `the extractor found no row for value ${JSON.stringify(value)}`);
    assert.equal(
      norm(rows[0].label),
      "version",
      "the scanner does not recognise a Version label",
    );
  }
  // NEGATIVE: a page with no version row produces no match, so the scanner is
  // not simply answering yes.
  const clean = `<main><dl><div class="field-row">
    <dt data-field-label data-field-source="skill-frontmatter">license <span class="src">from this skill's SKILL.md</span></dt>
    <dd>Apache-2.0</dd>
  </div></dl></main>`;
  assert.deepEqual(
    fieldRows(mainOf(clean)).filter((r) => norm(r.label) === "version"),
    [],
  );
});

// ── AC8 ─────────────────────────────────────────────────────────────────────

test("AC8: the forward population is EMPTY, which is why the gate runs backwards", async () => {
  // MEASURED, not assumed. The reasoning in this file's header depends on this
  // being true today, and it says so; the moment a seventh key appears here,
  // this fails and whoever added it reads the header.
  const skills = await declaredSkills();
  const nonSpec = [];
  for (const s of skills) {
    for (const key of Object.keys(s.declared)) {
      if (!SPEC_TOP_LEVEL_FIELDS.includes(key)) nonSpec.push(`${s.route}: ${key}`);
    }
  }
  assert.deepEqual(
    nonSpec,
    [],
    `the repository now declares top-level keys outside the spec's six:\n${nonSpec.join("\n")}\n` +
      `That is not a failure of the site — it is the forward population becoming ` +
      `non-empty. Read this file's header: the backwards gate below already covers ` +
      `them, and this assertion should become a check that each is unrendered.`,
  );
  // With its denominator, and with the keys that ARE declared, so the figure is
  // a measurement rather than an empty array nobody can size.
  const declaredKeys = new Set(skills.flatMap((s) => Object.keys(s.declared)));
  assert.ok(skills.length > 0 && declaredKeys.size > 0);
  assert.ok(
    [...declaredKeys].every((k) => SPEC_TOP_LEVEL_FIELDS.includes(k)),
    "the set difference above and this containment disagree",
  );
});

test("AC8: the spec vocabulary this suite checks against is the one the loader enforces", async () => {
  // The six names are written out in _helpers.mjs rather than imported, so that
  // "every label is a spec field" cannot degrade into "every label is whatever
  // the loader allows". This is the comparison that makes the duplication
  // deliberate instead of accidental.
  assert.deepEqual(
    [...ALLOWED_FIELDS].sort(),
    [...SPEC_TOP_LEVEL_FIELDS].sort(),
    "the loader's closed vocabulary and the specification's six no longer agree",
  );
  assert.equal(SPEC_TOP_LEVEL_FIELDS.length, 6, "the spec vocabulary is closed at six names");
});

test("AC8: every rendered field label on all 58 pages traces to a declared key", async () => {
  // THE GATE. Runs over every label the build emitted, on every page it built.
  const skills = await declaredSkills();
  const bySkillRoute = new Map(skills.map((s) => [s.route, s]));
  const manifests = new Map(skills.map((s) => [s.plugin, s.manifest]));
  const pages = await distContentPages();

  const untraceable = [];
  let checked = 0;
  const byKind = { "skill-frontmatter": 0, "plugin-manifest": 0, derived: 0 };

  for (const p of pages) {
    const parts = p.route.split("/");
    const plugin = parts[0] === "plugins" ? parts[1] : null;
    const skill = bySkillRoute.get(p.route) ?? null;
    // Every key the manifest declares, plus the closed vocabulary the standard
    // fixes — a manifest-sourced label must be a real key of the real file.
    const manifestKeys = plugin && manifests.has(plugin) ? Object.keys(manifests.get(plugin)) : [];

    for (const r of fieldRows(mainOf(p.html))) {
      checked += 1;
      const label = r.label.trim();
      const where = `${p.route}: "${label}" (source=${r.source})`;

      if (r.source === "derived") {
        byKind.derived += 1;
        // A derived row must SAY it is derived, in words. Otherwise "derived"
        // is a hiding place: any invented field could claim it.
        if (!/derived/i.test(r.note)) untraceable.push(`${where} — not marked derived to a reader`);
        continue;
      }
      if (r.source === "plugin-manifest") {
        byKind["plugin-manifest"] += 1;
        if (!manifestKeys.includes(label)) untraceable.push(`${where} — not a key of plugin.json`);
        if (!MANIFEST_FIELDS.includes(label)) {
          untraceable.push(`${where} — outside the closed Agent Plugins §5.1 vocabulary`);
        }
        if (!/from plugin\.json/.test(r.note)) untraceable.push(`${where} — unattributed`);
        continue;
      }
      if (r.source === "skill-frontmatter") {
        byKind["skill-frontmatter"] += 1;
        if (!skill) {
          untraceable.push(`${where} — a skill-frontmatter row on a page that is not a skill`);
          continue;
        }
        const declaredHere = [
          ...SPEC_TOP_LEVEL_FIELDS,
          ...Object.keys(skill.declared.metadata ?? {}),
        ];
        if (!declaredHere.includes(label)) {
          untraceable.push(`${where} — neither a spec field nor a metadata key this skill declares`);
        }
        // …and it must be a key this skill ACTUALLY declares, not merely a
        // spec-legal name. `metadata` itself never renders as a row; its
        // members do.
        const actuallyDeclared =
          skill.declared[label] !== undefined ||
          (skill.declared.metadata ?? {})[label] !== undefined;
        if (!actuallyDeclared) untraceable.push(`${where} — the skill declares no such key`);
        if (!/from this skill's SKILL\.md/.test(r.note)) untraceable.push(`${where} — unattributed`);
        continue;
      }
      untraceable.push(`${where} — no source attribution at all`);
    }
  }

  assert.deepEqual(untraceable, [], `untraceable field labels:\n${untraceable.join("\n")}`);

  // POPULATION, and every branch non-empty. A sweep in which one branch never
  // ran is a sweep that has not tested that branch, and reporting the totals is
  // what makes the green result readable as evidence rather than as silence.
  assert.equal(pages.length, 58, `swept ${pages.length} pages, not 58`);
  assert.ok(checked > pages.length, `only ${checked} labels across ${pages.length} pages`);
  for (const [kind, n] of Object.entries(byKind)) {
    assert.ok(n > 0, `no ${kind} row was seen anywhere — that branch of the gate is untested`);
  }
});

test("AC8: no site page renders a field label at all except its own provenance", async () => {
  // The five pages ABOUT the catalog declare nothing, so there is nothing for
  // them to render but the derived source of the bytes they lift. A field row
  // here would be pure invention: there is no document behind it.
  const pages = await distContentPages();
  const wrong = [];
  for (const route of SITE_ROUTES) {
    for (const r of fieldRows(mainOf(pageAt(pages, route).html))) {
      if (r.source !== "derived" || r.label.trim() !== "source") {
        wrong.push(`${route}: ${r.label} (source=${r.source})`);
      }
    }
  }
  assert.deepEqual(wrong, [], `a site page rendered a field it cannot have:\n${wrong.join("\n")}`);
});

test("AC8 control: the backwards gate fires on a label that traces to nothing", () => {
  // POSITIVE control for the scanner. The gate above is a set of containments
  // that currently hold; this shows each rejection branch can reject.
  const cases = [
    {
      what: "an invented label claiming to come from the skill",
      html: `<dt data-field-label data-field-source="skill-frontmatter">difficulty <span class="src">from this skill's SKILL.md</span></dt><dd>hard</dd>`,
      expect: (r, declared) => !declared.includes(r.label.trim()),
    },
    {
      what: "a manifest-sourced label that is not a manifest key",
      html: `<dt data-field-label data-field-source="plugin-manifest">downloads <span class="src">from plugin.json</span></dt><dd>1200</dd>`,
      expect: (r) => !MANIFEST_FIELDS.includes(r.label.trim()),
    },
    {
      what: "a derived row that does not say so to a reader",
      html: `<dt data-field-label data-field-source="derived">popularity</dt><dd>high</dd>`,
      expect: (r) => !/derived/i.test(r.note),
    },
    {
      what: "a row with no source attribution",
      html: `<dt data-field-label>rating</dt><dd>5</dd>`,
      expect: (r) => r.source === null,
    },
  ];
  const declared = [...SPEC_TOP_LEVEL_FIELDS, "version", "sources", "author", "trigger", "framework"];
  for (const c of cases) {
    const rows = fieldRows(`<main><dl><div class="field-row">${c.html}</div></dl></main>`);
    assert.equal(rows.length, 1, `the extractor found no row for: ${c.what}`);
    assert.ok(c.expect(rows[0], declared), `the gate would ACCEPT ${c.what}`);
  }
  // NEGATIVE: a well-formed row of each kind must be accepted, or the gate is
  // a detector for the existence of rows.
  const ok = fieldRows(
    `<main><dl><div class="field-row">` +
      `<dt data-field-label data-field-source="plugin-manifest">version <span class="src">from plugin.json</span></dt><dd>1.0.0</dd>` +
      `</div></dl></main>`,
  );
  assert.equal(ok.length, 1);
  assert.ok(MANIFEST_FIELDS.includes(ok[0].label.trim()));
  assert.match(ok[0].note, /from plugin\.json/);
});

test("AC8 control: the closed-vocabulary branch is live — a seventh key is dropped, with an advisory", () => {
  // The empty-set branch, driven. `analyzeDeclared` is the one place a
  // top-level key is either accepted into the data the templates see or turned
  // into an advisory, and the repository currently gives it nothing to reject.
  // So give it something.
  const fmText = "name: x\ndescription: y\ncategory: planted\n";
  const { declared, advisories } = analyzeDeclared(
    { name: "x", description: "y", category: "planted" },
    { file: "plugins/p/skills/s/SKILL.md", fmText, fmFirstLine: 2, expectedName: "x" },
  );
  assert.equal(
    declared.category,
    undefined,
    "an unknown top-level key reached the data the templates render from",
  );
  const unknown = advisories.filter((a) => a.code === "UNKNOWN-FIELD");
  assert.equal(unknown.length, 1, "no UNKNOWN-FIELD advisory was raised for the planted key");
  assert.match(unknown[0].message, /"category"/, "the advisory does not name the key");
  assert.equal(unknown[0].line, 4, "the advisory does not point at the key's own line");

  // NEGATIVE: each of the six is accepted, so the allowlist is not simply
  // rejecting everything.
  for (const key of SPEC_TOP_LEVEL_FIELDS) {
    const { declared: d, advisories: a } = analyzeDeclared(
      { name: "x", description: "y", [key]: key === "metadata" ? { version: "1" } : "v" },
      { file: "f", fmText: "name: x\n", fmFirstLine: 2, expectedName: "x" },
    );
    assert.notEqual(d[key], undefined, `the spec field "${key}" was rejected`);
    assert.deepEqual(
      a.filter((x) => x.code === "UNKNOWN-FIELD"),
      [],
      `the spec field "${key}" raised an unknown-field advisory`,
    );
  }

  // The END-TO-END half of this control is in build-e2e.test.mjs: `category`
  // is planted into a real SKILL.md, a real build is run, and the advisory is
  // asserted in the build log while the key is asserted absent from the page.
  // A unit control alone would prove the function rejects the key and say
  // nothing about whether the build calls it.
});
