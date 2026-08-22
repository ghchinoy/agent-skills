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

// THE ONE EXEMPTION, ITEMISED AND COUNTED, AND ITS REASON IS A MEASUREMENT
// (pre-registration §6.5). `description` is declared by 23 of 23 skills and is
// the only declared key that is not a labelled row: Starlight renders it as the
// page's lead paragraph, which is where a reader meets a description. It is
// exempted from the ROW requirement and then held to a stronger one at the call
// site — the full string must appear in the page text — so the exemption buys a
// change of location, not a licence to drop it.
const EXEMPT = ["description"];

/**
 * THE FORWARD PREDICATE, extracted in the Phase 3 fix round for the same reason
 * as `traceRow` below: so that its positive control drives THE REAL COMPARISON.
 *
 * The reviewer's Advisory 1 was exact. The old control built a label set by
 * FILTERING `license` OUT and then asserted the set did not contain `license` —
 * a tautology, true of any correct `Set` and no evidence whatsoever that the
 * suppression sweep can detect suppression. The plant was real; nothing was
 * ever fed to the detector.
 *
 * Given a skill and the lowercased labels its own page rendered from its own
 * frontmatter, returns the declared keys that never reach a reader, with the
 * two denominators that say whether the sweep was thin.
 */
function suppressedKeys(skill, ownLabels) {
  const suppressed = [];
  let exemptSeen = 0;
  let checked = 0;
  const declaredKeys = [
    ...Object.keys(skill.declared).filter((k) => k !== "metadata"),
    ...Object.keys(skill.declared.metadata ?? {}).map((k) => `metadata.${k}`),
  ];
  for (const key of declaredKeys) {
    const leaf = key.replace(/^metadata\./, "").toLowerCase();
    if (EXEMPT.includes(leaf)) {
      exemptSeen += 1;
      continue;
    }
    checked += 1;
    if (!ownLabels.has(leaf)) {
      suppressed.push(`${skill.route}: declares ${key}, renders no such row`);
    }
  }
  return { suppressed, exemptSeen, checked };
}

/** The lowercased labels a page renders from its own SKILL.md. */
const ownLabelsOf = (main) =>
  new Set(
    fieldRows(main)
      .filter((r) => r.source === "skill-frontmatter")
      .map((r) => r.label.toLowerCase()),
  );

test("AC8 forward: every key a skill declares reaches its page", async () => {
  // THE OTHER DIRECTION, and it catches the other failure. The gate below asks
  // "is every rendered label traceable to a declared key" — that is INVENTION.
  // This asks "does every declared key reach the reader" — that is SUPPRESSION.
  // A build that dropped `license` from every page passes the backwards gate
  // perfectly, because the labels it does render all trace.
  //
  // Scoped to the skill's OWN declarations against its OWN page, which is the
  // EM's Option A stated as a test: a value renders on the page of the entity
  // that declared it.
  const skills = await declaredSkills();
  const pages = await distContentPages();

  const suppressed = [];
  let checked = 0;
  let exemptSeen = 0;
  for (const s of skills) {
    const main = mainOf(pageAt(pages, s.route).html);
    const r = suppressedKeys(s, ownLabelsOf(main));
    suppressed.push(...r.suppressed);
    checked += r.checked;
    exemptSeen += r.exemptSeen;

    // The stronger requirement the exemption is priced at, once per exempt key.
    for (let i = 0; i < r.exemptSeen; i += 1) {
      const text = toText(main).replace(/\s+/g, " ");
      const want = String(s.declared.description).replace(/\s+/g, " ").trim();
      assert.ok(
        text.includes(want),
        `${s.route}: the declared description is exempt from the row requirement and ` +
          `does not appear in the page text either`,
      );
    }
  }
  assert.deepEqual(suppressed, [], `declared keys that never reach a reader:\n${suppressed.join("\n")}`);

  // DENOMINATORS. 23 skills; the exemption fires once per skill and no more,
  // so it is 23 of 23 and cannot have quietly widened to cover a second key.
  assert.equal(skills.length, 23, `swept ${skills.length} skills, not 23`);
  assert.equal(
    exemptSeen,
    skills.length,
    `the description exemption fired ${exemptSeen} times across ${skills.length} skills; ` +
      `it is supposed to fire exactly once per skill`,
  );
  assert.ok(
    checked > skills.length,
    `only ${checked} non-exempt declared keys across ${skills.length} skills — the forward ` +
      `sweep is too thin to mean anything`,
  );
});

test("AC8 forward control: the suppression detector's OWN PREDICATE fires on a hidden key", async () => {
  // Without this, the empty `suppressed` array above is equally consistent with
  // a detector that reads no rows. The plant is on the RENDERED side — a page's
  // rows are taken away — because that is the failure being detected.
  //
  // What this used to do, and why it was worthless: it removed `license` from a
  // Set and then asserted the Set no longer contained `license`. That is true of
  // every correct Set implementation and says nothing about `suppressedKeys`.
  // The plant never reached a detector (review, Advisory 1). It now runs through
  // the same function the sweep above calls, on real page bytes.
  const skills = await declaredSkills();
  const victim = skills.find((s) => typeof s.declared.license === "string");
  assert.ok(victim, "no skill declares a license, so this control has nothing to hide");

  const pages = await distContentPages();
  const main = mainOf(pageAt(pages, victim.route).html);
  const own = ownLabelsOf(main);
  assert.ok(
    own.has("license"),
    "the baseline reading already has no license row — the sweep above is vacuous",
  );

  // BASELINE through the real predicate: this skill's page is clean today.
  const before = suppressedKeys(victim, own);
  assert.deepEqual(
    before.suppressed,
    [],
    `${victim.route} is already suppressing a declared key, so a plant proves nothing here`,
  );
  assert.ok(before.checked > 0, "the predicate examined no keys at all on the victim page");

  // PLANT: take the license row away from what the page reports, exactly as a
  // template that stopped emitting it would, and feed that to the predicate.
  const hidden = new Set([...own].filter((l) => l !== "license"));
  const after = suppressedKeys(victim, hidden);
  assert.deepEqual(
    after.suppressed,
    [`${victim.route}: declares license, renders no such row`],
    `THE SUPPRESSION DETECTOR DID NOT FIRE on a page with the license row removed — ` +
      `every green it reports above is compatible with it reading nothing`,
  );

  // …and it fired for the plant alone, not by collapsing into a detector that
  // complains about everything the moment one row moves.
  assert.equal(
    after.checked,
    before.checked,
    "the plant changed the size of the population, so the two runs are not comparable",
  );

  // NEGATIVE, on the OTHER side of the exemption: hiding `description` must NOT
  // fire, because it is exempt from the row requirement by design. A detector
  // that fires on it too would be reporting the exemption as a defect.
  const noDescription = new Set([...own].filter((l) => l !== "description"));
  assert.deepEqual(
    suppressedKeys(victim, noDescription).suppressed,
    [],
    "the exempt key was reported as suppressed, so the exemption is not actually live",
  );
  assert.equal(suppressedKeys(victim, own).exemptSeen, 1, "the exemption did not fire exactly once");
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

/**
 * THE BACKWARDS PREDICATE, extracted in the Phase 3 fix round so that its
 * positive control invokes THE GATE ITSELF rather than a re-expression of it.
 *
 * The reviewer's Advisory 2 was exact: the control below used to re-state each
 * rejection branch as its own `expect` callback against a hand-written
 * `declared` array, and never called the gate body. A control that tests a
 * COPY of the predicate proves the copy is live. If the two ever drifted, the
 * control would go on passing while the gate rotted — which is the same defect
 * as a unit test that confirms a false claim forever, arriving from the other
 * direction.
 *
 * Returns the complaints a row earns. Empty means the row traces.
 */
function traceRow(r, { where, manifestKeys, skill }) {
  const out = [];
  const label = r.label.trim();

  if (r.source === "derived") {
    // A derived row must SAY it is derived, in words. Otherwise "derived" is a
    // hiding place: any invented field could claim it.
    if (!/derived/i.test(r.note)) out.push(`${where} — not marked derived to a reader`);
    return out;
  }
  if (r.source === "plugin-manifest") {
    if (!manifestKeys.includes(label)) out.push(`${where} — not a key of plugin.json`);
    if (!MANIFEST_FIELDS.includes(label)) {
      out.push(`${where} — outside the closed Agent Plugins §5.1 vocabulary`);
    }
    if (!/from plugin\.json/.test(r.note)) out.push(`${where} — unattributed`);
    return out;
  }
  if (r.source === "skill-frontmatter") {
    if (!skill) {
      out.push(`${where} — a skill-frontmatter row on a page that is not a skill`);
      return out;
    }
    const declaredHere = [...SPEC_TOP_LEVEL_FIELDS, ...Object.keys(skill.declared.metadata ?? {})];
    if (!declaredHere.includes(label)) {
      out.push(`${where} — neither a spec field nor a metadata key this skill declares`);
    }
    // …and it must be a key this skill ACTUALLY declares, not merely a
    // spec-legal name. `metadata` itself never renders as a row; its members do.
    const actuallyDeclared =
      skill.declared[label] !== undefined || (skill.declared.metadata ?? {})[label] !== undefined;
    if (!actuallyDeclared) out.push(`${where} — the skill declares no such key`);
    if (!/from this skill's SKILL\.md/.test(r.note)) out.push(`${where} — unattributed`);
    return out;
  }
  out.push(`${where} — no source attribution at all`);
  return out;
}

/**
 * THE GATE ITSELF, as a function over page bytes, so that the end-to-end
 * control below can hand it a CORRUPTED artifact and require it to object.
 * `pages` is whatever `distContentPages()` shape the caller supplies — real, or
 * real-with-one-row-planted.
 */
function scanPages(pages, skills) {
  const bySkillRoute = new Map(skills.map((s) => [s.route, s]));
  const manifests = new Map(skills.map((s) => [s.plugin, s.manifest]));

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
      const where = `${p.route}: "${r.label.trim()}" (source=${r.source})`;
      if (r.source !== null && byKind[r.source] !== undefined) byKind[r.source] += 1;
      untraceable.push(...traceRow(r, { where, manifestKeys, skill }));
    }
  }
  return { untraceable, checked, byKind };
}

test("AC8: every rendered field label on all 58 pages traces to a declared key", async () => {
  // THE GATE. Runs over every label the build emitted, on every page it built.
  const skills = await declaredSkills();
  const pages = await distContentPages();
  const { untraceable, checked, byKind } = scanPages(pages, skills);

  assert.deepEqual(untraceable, [], `untraceable field labels:\n${untraceable.join("\n")}`);

  // POPULATION, and every branch non-empty. A sweep in which one branch never
  // ran is a sweep that has not tested that branch, and reporting the totals is
  // what makes the green result readable as evidence rather than as silence.
  assert.equal(pages.length, 59, `swept ${pages.length} pages, not 59`);
  assert.ok(checked > pages.length, `only ${checked} labels across ${pages.length} pages`);
  for (const [kind, n] of Object.entries(byKind)) {
    assert.ok(n > 0, `no ${kind} row was seen anywhere — that branch of the gate is untested`);
  }
});

test("AC8 control: the WHOLE GATE, run on real built bytes with one row planted", async () => {
  // THE DEMONSTRATION PRE-REGISTRATION §6.4 PROMISED, rebuilt to be buildable.
  //
  // §6.4 said: add a SKILL.md frontmatter key outside the six, rebuild, require
  // the assertion to go red. The reviewer showed that control was never built,
  // and it is also a planned-vs-executed gap report §12.3 does not list. Both
  // are correct. But the promise could not have been kept as written, and the
  // reason is worth more than the promise was:
  //
  //   A PLANTED FRONTMATTER KEY CAN NEVER REACH A PAGE. A top-level one is
  //   dropped by `analyzeDeclared` before rendering (the control below this
  //   one drives that). A `metadata.*` one DOES render — and traces correctly,
  //   because metadata is an OPEN vocabulary and the gate's rule for it is
  //   "a key this skill declares", which a planted key is. So no change to the
  //   DATA can make this gate fire. Only a change to the RENDERER can, which is
  //   what the reviewer's MA did and what the gate exists to catch.
  //
  // So the plant goes where invention actually happens — in the emitted HTML —
  // and it is planted into the REAL artifact, then fed to the REAL gate.
  const skills = await declaredSkills();
  const real = await distContentPages();

  // Baseline on the untouched artifact, through the same function.
  const before = scanPages(real, skills);
  assert.deepEqual(before.untraceable, [], "the artifact is not clean, so a plant proves nothing");
  assert.ok(before.checked > 100, `the gate examined only ${before.checked} rows`);

  const victim = skills[0].route;
  const PLANT = `<div class="field-row"><dt data-field-label data-field-source="skill-frontmatter">difficulty <span class="src">from this skill's SKILL.md</span></dt><dd>hard</dd></div>`;
  const corrupted = real.map((p) =>
    p.route === victim ? { ...p, html: p.html.replace("</main>", `${PLANT}</main>`) } : p,
  );
  assert.notEqual(
    corrupted.find((p) => p.route === victim).html.length,
    real.find((p) => p.route === victim).html.length,
    "the plant did not change the page bytes — the corruption never happened",
  );

  const after = scanPages(corrupted, skills);
  // BOTH skill-frontmatter branches fire on an invented label, and the pair is
  // asserted exactly rather than by `length > 0`: the gate must object for the
  // right reasons, and it must object about the right page.
  assert.deepEqual(
    after.untraceable,
    [
      `${victim}: "difficulty" (source=skill-frontmatter) — neither a spec field nor a metadata key this skill declares`,
      `${victim}: "difficulty" (source=skill-frontmatter) — the skill declares no such key`,
    ],
    `THE GATE DID NOT CATCH AN INVENTED ROW planted into the real artifact:\n` +
      `${after.untraceable.join("\n")}`,
  );
  // It caught the plant and nothing else — one extra row seen, one complaint.
  assert.equal(after.checked, before.checked + 1, "the plant changed the population by more than one row");
});

test("AC8: exactly ONE field label in the renderer is data-driven, and it is the metadata loop", async () => {
  // The measurement the control above rests on, so that "no data plant can
  // reach a page" is a fact this suite CHECKS rather than a claim its comments
  // make. Every `data-field-label` in the renderer is a hardcoded literal but
  // one; the exception iterates `metadata`, whose vocabulary the Agent Skills
  // spec leaves open.
  //
  // On the day a second interpolated label appears, this fails — and that is
  // the day a planted key could reach a page, the day the forward form of AC8
  // stops being vacuous, and the day this file's header needs rereading.
  // THE POPULATION IS DERIVED FROM THE DIRECTORY, NOT NAMED.
  //
  // Round 2, Advisory 1: this read exactly one path,
  // `../src/components/EntryMeta.astro`. Planting a second data-driven
  // `<dt data-field-label>` into the OTHER rendering component,
  // SiteIndex.astro, left this test green while its stated claim — "exactly
  // ONE field label in THE RENDERER is data-driven" — became false. "The
  // renderer" was never one file; naming the file is what made the population
  // unable to grow. Another gate caught that particular plant, so this was a
  // scoping defect in one test rather than a hole in the suite, and it is
  // standard 31 in a test file: a population bounded by a name instead of by a
  // measurement.
  //
  // Now every component that EMITS a field label is scanned, so the day a
  // second emitter appears this test sees it instead of being aimed away.
  const { readdir, readFile } = await import("node:fs/promises");
  const dir = new URL("../src/components/", import.meta.url);
  const components = (await readdir(dir)).filter((f) => f.endsWith(".astro")).sort();
  assert.ok(
    components.length >= 3,
    `only ${components.length} .astro components found — the directory scan is not reaching them`,
  );

  const sources = new Map();
  for (const f of components) sources.set(f, await readFile(new URL(f, dir), "utf8"));

  // The emitter set, derived. Non-emitting components are not silently dropped:
  // they are the complement, and the split is asserted to be non-degenerate in
  // both directions so this cannot pass by scanning nothing.
  const emitters = components.filter((f) => sources.get(f).includes("<dt data-field-label"));
  assert.ok(emitters.length > 0, "no component emits a field label at all — nothing is being checked");
  assert.ok(
    emitters.includes("EntryMeta.astro"),
    `the metadata renderer is no longer among the field-label emitters: ${emitters.join(", ")}`,
  );

  // Scoped to real `<dt>` ELEMENTS. An earlier draft of this matched the
  // attribute name anywhere and swallowed the comment on line 20 that merely
  // mentions it — the test caught my own instrument before it could report on
  // anything else, which is the order these things are supposed to happen in.
  const labels = [];
  let declaredSites = 0;
  for (const f of emitters) {
    const src = sources.get(f);
    for (const m of src.matchAll(/<dt data-field-label[^>]*>\s*([^<]*?)\s*</g)) {
      labels.push({ file: f, label: m[1].trim() });
    }
    declaredSites += (src.match(/<dt data-field-label/g) ?? []).length;
  }
  assert.equal(
    labels.length,
    declaredSites,
    `the extractor read ${labels.length} of the ${declaredSites} label sites across ` +
      `${emitters.join(", ")}`,
  );
  assert.ok(labels.length >= 13, `found only ${labels.length} label sites across the renderers`);

  // The set is PRINTED with the file each member came from, so a second
  // data-driven label names its own emitter instead of arriving as a total.
  const interpolated = labels.filter((l) => l.label.includes("{"));
  assert.deepEqual(
    interpolated.map((l) => `${l.file} ${l.label}`),
    ["EntryMeta.astro {key}"],
    `the data-driven field labels are no longer just the metadata loop:\n` +
      `${interpolated.map((l) => `${l.file} ${l.label}`).join("\n")}\n` +
      `All label sites: ${labels.map((l) => `${l.file} ${l.label}`).join(" | ")}`,
  );
  // …and that one is inside the metadata iteration, not somewhere else. The
  // file is taken from the derived set rather than written down again.
  assert.match(
    sources.get(interpolated[0].file),
    /Object\.entries\(metadata\)\.map\(\(\[key, value\]\)/,
    `${interpolated[0].file}'s interpolated label no longer comes from Object.entries(metadata)`,
  );
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

test("AC8 control: the backwards gate's OWN PREDICATE rejects a label that traces to nothing", () => {
  // POSITIVE control for the scanner. Every case below is driven through
  // `traceRow` — the same function the gate above calls on all 327 real rows —
  // so a drift between gate and control is now impossible by construction.
  // Before the Phase 3 fix round this control re-expressed each rejection
  // branch as its own callback and never invoked the gate (review, Advisory 2).
  //
  // The context a skill page supplies: one skill declaring `name` and one
  // metadata key, and a manifest whose keys are the real closed vocabulary.
  const skill = { declared: { name: "okf-author", metadata: { version: "1.0.0" } } };
  const ctx = { where: "TEST", manifestKeys: [...MANIFEST_FIELDS], skill };

  const cases = [
    {
      what: "an invented label claiming to come from the skill",
      html: `<dt data-field-label data-field-source="skill-frontmatter">difficulty <span class="src">from this skill's SKILL.md</span></dt><dd>hard</dd>`,
      because: /neither a spec field nor a metadata key/,
    },
    {
      what: "a spec-legal name the skill does not actually declare",
      html: `<dt data-field-label data-field-source="skill-frontmatter">license <span class="src">from this skill's SKILL.md</span></dt><dd>MIT</dd>`,
      because: /declares no such key/,
    },
    {
      what: "a manifest-sourced label that is not a manifest key",
      html: `<dt data-field-label data-field-source="plugin-manifest">downloads <span class="src">from plugin.json</span></dt><dd>1200</dd>`,
      because: /not a key of plugin\.json/,
    },
    {
      what: "a derived row that does not say so to a reader",
      html: `<dt data-field-label data-field-source="derived">popularity</dt><dd>high</dd>`,
      because: /not marked derived to a reader/,
    },
    {
      what: "a row with no source attribution",
      html: `<dt data-field-label>rating</dt><dd>5</dd>`,
      because: /no source attribution at all/,
    },
    {
      what: "a skill-frontmatter row on a page that is not a skill",
      html: `<dt data-field-label data-field-source="skill-frontmatter">name <span class="src">from this skill's SKILL.md</span></dt><dd>x</dd>`,
      ctx: { where: "TEST", manifestKeys: [...MANIFEST_FIELDS], skill: null },
      because: /on a page that is not a skill/,
    },
    {
      what: "a correctly-named row that hides where it came from",
      html: `<dt data-field-label data-field-source="plugin-manifest">version</dt><dd>1.0.0</dd>`,
      because: /unattributed/,
    },
  ];

  for (const c of cases) {
    const rows = fieldRows(`<main><dl><div class="field-row">${c.html}</div></dl></main>`);
    assert.equal(rows.length, 1, `the extractor found no row for: ${c.what}`);
    const complaints = traceRow(rows[0], c.ctx ?? ctx);
    assert.ok(complaints.length > 0, `THE GATE WOULD ACCEPT ${c.what}`);
    assert.ok(
      complaints.some((m) => c.because.test(m)),
      `the gate rejected ${c.what} but for the wrong reason: ${complaints.join(" | ")}`,
    );
  }

  // NEGATIVE: well-formed rows of each of the three kinds must be accepted, or
  // the gate is merely a detector for the existence of rows. Run through the
  // same predicate, so "accepted" means the gate accepted it.
  const good = [
    `<dt data-field-label data-field-source="plugin-manifest">version <span class="src">from plugin.json</span></dt><dd>1.0.0</dd>`,
    `<dt data-field-label data-field-source="skill-frontmatter">name <span class="src">from this skill's SKILL.md</span></dt><dd>okf-author</dd>`,
    `<dt data-field-label data-field-source="derived">source <span class="src">derived by this build</span></dt><dd>x</dd>`,
  ];
  for (const html of good) {
    const rows = fieldRows(`<main><dl><div class="field-row">${html}</div></dl></main>`);
    assert.equal(rows.length, 1);
    assert.deepEqual(
      traceRow(rows[0], ctx),
      [],
      `the gate REJECTED a well-formed row, so its greens on the real pages mean nothing: ${html}`,
    );
  }
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
