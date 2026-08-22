// spec-source.test.mjs — Phase 5 AC5.
//
// AC5: "`specification-source.json` exists, pins both specs by version and
// commit, and the build reads it rather than hardcoding a version string."
//
// ── WHAT THIS FILE DOES NOT ASSERT, AND WHY IT WOULD BE A FABRICATION TO ─────
//
// AC5 asks for BOTH specs pinned "by version". One of them has no version.
// **The Agent Skills specification declares no version of itself**, and no
// status either — measured at commit 69ef37e9 with a positive control showing
// the selector finds one where one exists, then re-verified independently at
// source with the file filter removed. It is entered on the governing defect
// list as D-7, AC5-UNVERSIONED: the criterion presumes a fact about the world
// that is false, so the AC is unsatisfiable AS WRITTEN and satisfying it
// literally requires inventing a number.
//
// There was a version available to invent, and it is worth naming because it
// would have passed: `skills-ref/pyproject.toml` declares `version = "0.1.0"`.
// That is the REFERENCE LIBRARY's version, for a library the specification
// itself calls "for demonstration purposes only. It is not meant to be used in
// production." Pinning it satisfies every is-non-empty assertion anyone would
// think to write, and is a wrong-SOURCE fabrication with a green light on it.
//
// So the keys are OMITTED. Not null, not "unknown", not "n/a", not 0.1.0.
//
// ── THE PART THAT MAKES AN OMISSION A GATE RATHER THAN A HOLE ────────────────
//
// A key that is absent because someone measured its absence, and a key that is
// absent because someone forgot it, ARE THE SAME BYTES. That is C10 in a JSON
// file, and no amount of care while writing the file distinguishes them later.
// `declaredAbsent` records each omission with the predicate that established it
// and the positive control that proves the search could have found something,
// and `validateSpecSource()` enforces the pairing in BOTH directions.
//
// This file drives that validator with MUTATED objects, because a throw nobody
// has observed is a claim. It is the unit half. The E2E half is in
// build-e2e.test.mjs, where the same two failures are driven through a real
// build — R5's lesson, established in this suite: A GATE PROVEN ONLY AT UNIT
// LEVEL IS NOT PROVEN.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  PINNED_FIELDS,
  SPEC_SOURCE_PATH,
  loadSpecSource,
  pinSentence,
  validateSpecSource,
} from "../src/loaders/spec-source.mjs";
import { distContentPages, mainOf, pageAt, plantOrThrow, toText } from "./_helpers.mjs";

/** A fresh deep copy, so one mutation test cannot leak into the next. */
async function freshSource() {
  return JSON.parse(await readFile(SPEC_SOURCE_PATH, "utf8"));
}

const specOf = (data, id) => data.specifications.find((s) => s.id === id);

test("AC5: the pin file exists, parses, and validates", async () => {
  const data = await loadSpecSource();
  assert.ok(Array.isArray(data.specifications), "no specifications array");
  assert.equal(
    data.specifications.length,
    2,
    "AC5 says BOTH specs. A file pinning one of them satisfies every " +
      "per-entry assertion below while leaving half the question unanswered.",
  );
  assert.deepEqual(
    data.specifications.map((s) => s.id).sort(),
    ["agent-plugins", "agent-skills"],
    "the pinned specifications are not the two this catalog targets",
  );
});

test("AC5: both specs are pinned by a full 40-hex commit, and the pins are distinct", async () => {
  const data = await loadSpecSource();
  for (const spec of data.specifications) {
    assert.match(
      spec.commit,
      /^[0-9a-f]{40}$/,
      `${spec.id} is pinned by ${JSON.stringify(spec.commit)}, which is not a full object name. ` +
        "An abbreviation can become ambiguous and a branch name is not a pin at all: " +
        "it verifies forever and means something different each time.",
    );
    // A pin with no date cannot be aged by a reader, only trusted.
    assert.match(spec.commitDate, /^\d{4}-\d{2}-\d{2}T/, `${spec.id} records no commitDate`);
  }
  const [a, b] = data.specifications.map((s) => s.commit);
  assert.notEqual(a, b, "both specs carry the same commit — one of them was copied, not measured");
});

test("AC5 / D-7: Agent Skills declares NO version and NO status, and says so with its predicate", async () => {
  const skills = specOf(await loadSpecSource(), "agent-skills");

  for (const field of ["version", "status"]) {
    assert.ok(
      !(field in skills),
      `agent-skills carries a ${field} key. The Agent Skills specification declares no ` +
        `${field} of itself, so any value here was invented, inherited or taken from the ` +
        `wrong source — most likely skills-ref/pyproject.toml's 0.1.0, which is the ` +
        `demonstration-only reference LIBRARY's version and not the specification's.`,
    );

    const record = skills.declaredAbsent[field];
    assert.ok(record, `${field} is absent from agent-skills and NOT declared absent`);

    // C8: a figure ships with the predicate that produced it — AND SO DOES A ZERO.
    assert.ok(
      record.predicate && record.predicate.length > 60,
      `declaredAbsent.${field} states no re-runnable predicate. An absence nobody ` +
        "can re-derive is an assertion wearing a measurement's clothes.",
    );
    // Rule 505: an absence from a guessed needle and an absence from a real
    // defect are the same bytes. The positive control is what tells them apart.
    assert.ok(
      record.positiveControl && record.positiveControl.length > 60,
      `declaredAbsent.${field} states no positive control. Without one, "we looked and ` +
        `found nothing" is indistinguishable from "we looked in the wrong place with a ` +
        `selector that finds nothing anywhere".`,
    );
    assert.ok(record.reason && record.reason.length > 40, `declaredAbsent.${field} states no reason`);
  }

  // The trap is named in the file, so the next reader meets it before inventing it.
  assert.match(
    skills.declaredAbsent.version.doNotUse ?? "",
    /0\.1\.0/,
    "the version absence record does not name the skills-ref 0.1.0 trap",
  );
});

test("AC5 / D-8: Agent Plugins is pinned at the MEASURED revision, with the stale designed one recorded", async () => {
  const plugins = specOf(await loadSpecSource(), "agent-plugins");
  assert.equal(plugins.version, "1.0.0");
  assert.equal(plugins.status, "published");
  assert.deepEqual(plugins.declaredAbsent, {}, "agent-plugins should declare nothing absent");

  // The design quotes an older commit. Neither silently adopted nor silently
  // dropped: recorded, with the divergence named. A provenance record naming a
  // commit nobody consulted is a wrong-SOURCE defect wearing a correct sha.
  assert.ok(plugins.supersedes, "the divergence from the designed commit is not recorded");
  assert.match(plugins.supersedes.commit, /^[0-9a-f]{40}$/);
  assert.notEqual(plugins.supersedes.commit, plugins.commit);
  assert.ok(
    plugins.supersedes.why && plugins.supersedes.why.length > 80,
    "the superseded commit is recorded without saying why it was not adopted",
  );
});

test("AC5: every pinned field is either declared or declared absent — no third state", async () => {
  // The exhaustive partition. Without it, a field could be quietly dropped from
  // BOTH the entry and declaredAbsent and every other assertion here would still
  // pass, because every other assertion asks about fields it already knows.
  const data = await loadSpecSource();
  for (const spec of data.specifications) {
    for (const field of PINNED_FIELDS) {
      const declared = typeof spec[field] === "string" && spec[field].trim() !== "";
      const absent = Object.prototype.hasOwnProperty.call(spec.declaredAbsent, field);
      assert.notEqual(
        declared,
        absent,
        `${spec.id}.${field} is ${declared && absent ? "BOTH declared and declared-absent" : "in neither state"}`,
      );
    }
  }
});

// ── THE GATE, DRIVEN IN BOTH DIRECTIONS ─────────────────────────────────────

test("GATE 1: filling in a declared-absent field throws", async () => {
  const data = await freshSource();
  specOf(data, "agent-skills").version = "1.0.0";
  assert.throws(
    () => validateSpecSource(data),
    /declares version.*AND lists version in declaredAbsent/s,
    "a version was supplied for the specification that declares none, and the " +
      "validator accepted it. This is the direction that catches a FUTURE FABRICATION.",
  );
});

test("GATE 2: dropping a field without declaring it absent throws", async () => {
  const data = await freshSource();
  const plugins = specOf(data, "agent-plugins");
  delete plugins.version;
  assert.throws(
    () => validateSpecSource(data),
    /neither a version nor a declaredAbsent\.version/s,
    "a pinned field vanished and the validator accepted it. This is the direction " +
      "that catches SILENT LOSS — the C10 shape, where absence-by-measurement and " +
      "absence-by-oversight render identically.",
  );
});

test("GATE 3: an absence declared without a predicate throws", async () => {
  const data = await freshSource();
  delete specOf(data, "agent-skills").declaredAbsent.version.predicate;
  assert.throws(
    () => validateSpecSource(data),
    /without both a reason and a predicate/s,
    "an absence was declared with no way to re-derive it, and that passed",
  );
});

test("GATE 4: a branch name in place of a commit throws", async () => {
  const data = await freshSource();
  specOf(data, "agent-plugins").commit = "main";
  assert.throws(() => validateSpecSource(data), /not a 40-character hex sha/s);
});

test("GATE 5: an empty specifications array throws rather than pinning nothing", async () => {
  const data = await freshSource();
  data.specifications = [];
  assert.throws(
    () => validateSpecSource(data),
    /pins nothing while looking like it does/s,
    "an empty pin file validated. Every per-entry assertion in this file is " +
      "vacuously true over an empty array, so this is the one that stops the " +
      "whole suite going green on a file that pins nothing.",
  );
});

test("CONTROL: the unmutated file passes the same validator every gate above uses", async () => {
  // Without this, all five gates are consistent with a validator that throws on
  // EVERYTHING — five red lights from a broken bulb rather than five detections.
  const data = await freshSource();
  assert.doesNotThrow(() => validateSpecSource(data));
});

test("CONTROL: the mutation anchors still exist in the real file", async () => {
  // Every gate above mutates a parsed object, so a renamed key would make the
  // mutation a no-op and the gate would go green by mutating nothing. This
  // asserts against the RAW BYTES that the things being mutated are really there.
  const raw = await readFile(SPEC_SOURCE_PATH, "utf8");
  for (const anchor of ['"id": "agent-skills"', '"id": "agent-plugins"', '"declaredAbsent"']) {
    assert.ok(raw.includes(anchor), `the mutation anchor ${anchor} is gone from the pin file`);
  }
  // And the plant used by the E2E control must still match, for the same reason.
  plantOrThrow(raw, /"version": "1\.0\.0"/, '"version": "planted"', "the E2E version anchor");
});

// ── THE READ REACHES THE PAGE ───────────────────────────────────────────────

test("AC5: the pinned revisions reach /about/standards/, absence rendered AS absence", async () => {
  const data = await loadSpecSource();
  const page = pageAt(await distContentPages(), "about/standards");
  const text = toText(mainOf(page.html));

  for (const spec of data.specifications) {
    assert.ok(text.includes(spec.commit), `the page does not render ${spec.id}'s pinned commit`);
  }

  const plugins = specOf(data, "agent-plugins");
  assert.ok(text.includes(`version ${plugins.version}`), "the page does not render the pinned version");

  // The anti-fabrication half, and the one worth having: the specification with
  // no version must render NO version clause — not "unknown", not a blank, not
  // a dash. Suppressing declared data and inventing data are the same
  // violation, so this asserts the shape of the sentence rather than a silence.
  const skills = specOf(data, "agent-skills");
  assert.ok(!/version/.test(pinSentence(skills)), "pinSentence invented a version clause");
  for (const placeholder of ["version unknown", "version n/a", "version -", "version TBD"]) {
    assert.ok(!text.toLowerCase().includes(placeholder), `the page stubs a missing version as "${placeholder}"`);
  }

  // And the absence is EXPLAINED on the page, not merely omitted from it: a
  // reader who notices one spec has a version and the other does not should
  // learn which of the two possible reasons applies.
  assert.match(
    text,
    /declares no version(,| or) status of its own/,
    "the page omits the version silently. An unexplained omission reads exactly " +
      "like an oversight, which is the thing being ruled out.",
  );
});
