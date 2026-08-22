// versions.test.mjs — acceptance criterion 5, and the rule it is an instance of.
//
// THE RULE (EM ruling, Phase 3, Option A): A VALUE RENDERS ON THE PAGE OF THE
// ENTITY THAT DECLARED IT. Uniform, no conditional. A skill's
// `metadata.version` is the skill author's claim about the skill and appears on
// the skill's page; a plugin's `plugin.json` `version` is the packager's claim
// about the package and appears on the plugin's page. The site does not merge
// them, prefer one, or normalise one into the other's shape.
//
// THE CRITERION AS WRITTEN names one skill: "bd-dolt-troubleshooter shows 1.9
// and 1.9.0 separately, each labelled by source". That skill is real and the
// numbers are real. It is also ONE OF FIVE. Proposal §3.7 stated an instance
// and this phase read it as a population; measuring all 23 skills found five
// skews, four of which nobody had written down.
//
// SO NOTHING IN THIS FILE NAMES A SKILL. The population is derived here, from
// marketplace.json and the files it points at, by this file's own parsing — and
// a test at the bottom reads this file's own source and fails if any skill name
// from the catalog appears in it as a literal. A gate that is correct about the
// instance and silent about the class is the failure mode this phase was warned
// about by name; the self-check is there because the temptation to type
// "bd-dolt-troubleshooter" into an assertion is genuinely strong.
//
// "1.9" versus "1.9.0" is also the reason the comparison here is on STRINGS.
// Those two are the same release under semver and different bytes on the page,
// and the site's job is to show what each file says.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  declaredSkills,
  distContentPages,
  fieldRows,
  here,
  mainOf,
  pageAt,
  siteRoot,
  toText,
} from "./_helpers.mjs";

const run = promisify(execFile);

/**
 * The version skew population, DERIVED.
 *
 * Every skill that declares a `metadata.version`, compared as a string against
 * its plugin's manifest version. Returns the skews AND the denominators, so
 * every figure this suite reports arrives with the population it came from.
 */
async function versionPopulation() {
  const skills = await declaredSkills();
  const declaring = skills.filter((s) => typeof s.declared.metadata?.version === "string");
  const skews = declaring
    .map((s) => ({
      ...s,
      skillVersion: s.declared.metadata.version,
      manifestVersion: s.manifest.version,
    }))
    .filter((s) => s.skillVersion !== s.manifestVersion);
  return { skills, declaring, skews };
}

test("AC5: the skew population is derived, non-empty, and larger than the one the spec named", async () => {
  const { skills, declaring, skews } = await versionPopulation();
  // Every figure with its population, because a bare "5" is not a measurement.
  assert.equal(skills.length, 23, "the catalog no longer has 23 skills — re-derive, do not edit");
  assert.ok(
    declaring.length > 0 && declaring.length <= skills.length,
    `${declaring.length} of ${skills.length} skills declare metadata.version`,
  );
  assert.ok(
    skews.length > 0,
    `no version skew found across the ${declaring.length} skills that declare a version — ` +
      `either the repository was fixed (delete this suite deliberately) or the comparison ` +
      `is broken (much likelier)`,
  );
  // The spec named one. If the derived population ever collapses to one, the
  // instance-versus-class reading stops being load-bearing and this suite's
  // whole framing should be revisited rather than left standing.
  assert.ok(
    skews.length > 1,
    `the skew population is down to ${skews.length}; the header of this file explains ` +
      `why it was written for a population and should be re-read before editing`,
  );
});

test("AC5: each skew renders both numbers, on the page of the entity that declared each", async () => {
  const { skews } = await versionPopulation();
  const pages = await distContentPages();
  let checked = 0;

  for (const s of skews) {
    // ── The skill's number, on the skill's page ──────────────────────────────
    const skillRows = fieldRows(mainOf(pageAt(pages, s.route).html));
    const skillVersion = skillRows.filter((r) => r.label.trim() === "version");
    assert.equal(
      skillVersion.length,
      1,
      `${s.route}: expected exactly one version row, found ${skillVersion.length}`,
    );
    assert.equal(
      toText(skillVersion[0].dd),
      s.skillVersion,
      `${s.route}: the version row does not show the version SKILL.md declares`,
    );
    // NOT the manifest's. This is the assertion that "separately" turns on: if
    // the site normalised, preferred or merged, this is where it would show.
    assert.notEqual(
      toText(skillVersion[0].dd),
      s.manifestVersion,
      `${s.route}: the skill page is showing the PLUGIN's version`,
    );
    assert.equal(skillVersion[0].source, "skill-frontmatter");
    // Labelled by source IN WORDS, not only in a machine attribute — a reader
    // seeing two different numbers on two pages needs to be told whose each is.
    assert.match(
      skillVersion[0].note,
      /from this skill's SKILL\.md/,
      `${s.route}: the version row does not say, in words, whose version it is`,
    );

    // ── The plugin's number, on the plugin's page ────────────────────────────
    const pluginRoute = `plugins/${s.plugin}`;
    const pluginRows = fieldRows(mainOf(pageAt(pages, pluginRoute).html));
    const pluginVersion = pluginRows.filter((r) => r.label.trim() === "version");
    assert.equal(
      pluginVersion.length,
      1,
      `${pluginRoute}: expected exactly one version row, found ${pluginVersion.length}`,
    );
    assert.equal(
      toText(pluginVersion[0].dd),
      s.manifestVersion,
      `${pluginRoute}: the version row does not show the version plugin.json declares`,
    );
    assert.equal(pluginVersion[0].source, "plugin-manifest");
    assert.match(
      pluginVersion[0].note,
      /from plugin\.json/,
      `${pluginRoute}: the version row does not say, in words, whose version it is`,
    );

    // ── Separately ───────────────────────────────────────────────────────────
    // Both strings exist in the built site, as distinct values, neither having
    // been rewritten into the other's shape.
    assert.notEqual(s.skillVersion, s.manifestVersion, "not a skew — the filter is broken");
    checked += 1;
  }

  assert.equal(checked, skews.length, "not every derived skew was checked");
  assert.ok(checked > 0, "no skew was checked — this test asserted nothing");
});

test("AC5: no version is normalised — every rendered version is byte-identical to its source", async () => {
  // The wider claim the skew case is an instance of, over the WHOLE population
  // rather than the five. "1.9" must stay "1.9" on a page whose plugin says
  // "1.9.0", and a skill whose numbers happen to agree must not be silently
  // getting its number from the manifest either.
  const { declaring } = await versionPopulation();
  const pages = await distContentPages();
  for (const s of declaring) {
    const rows = fieldRows(mainOf(pageAt(pages, s.route).html));
    const row = rows.find((r) => r.label.trim() === "version");
    assert.ok(row, `${s.route}: declares metadata.version and renders no version row`);
    assert.deepEqual(
      [...toText(row.dd)].map((c) => c.codePointAt(0)),
      [...String(s.declared.metadata.version)].map((c) => c.codePointAt(0)),
      `${s.route}: the rendered version is not codepoint-identical to the declared one`,
    );
  }
  assert.ok(declaring.length > 0, "nothing declares a version — this loop ran zero times");
});

test("AC5 control: the comparison can see a page showing the wrong entity's version", async () => {
  // POSITIVE control. Everything above is an equality that holds; without this,
  // a broken extractor returning an empty <dd> for every row would fail loudly,
  // but an extractor that read the RIGHT number off the WRONG page would not
  // obviously be caught. So: take a real skew, plant the manifest's number in
  // the skill page's version row, and prove the assertions reject it.
  const { skews } = await versionPopulation();
  assert.ok(skews.length > 0, "no skew to build a control from");
  const s = skews[0];

  const planted = `<main><dl><div class="field-row">
    <dt data-field-label data-field-source="skill-frontmatter">version <span class="src">from this skill's SKILL.md</span></dt>
    <dd>${s.manifestVersion}</dd>
  </div></dl></main>`;
  const rows = fieldRows(mainOf(planted));
  assert.equal(rows.length, 1, "the extractor found no row in markup that has one");
  assert.equal(toText(rows[0].dd), s.manifestVersion);
  assert.notEqual(
    toText(rows[0].dd),
    s.skillVersion,
    "the control's plant is not actually a wrong value — pick a different skew",
  );

  // And the missing-attribution half: a row with no `.src` span fails the
  // in-words check that the real test makes.
  const unlabelled = `<main><dl><div class="field-row">
    <dt data-field-label data-field-source="skill-frontmatter">version</dt>
    <dd>${s.skillVersion}</dd>
  </div></dl></main>`;
  const bare = fieldRows(mainOf(unlabelled));
  assert.equal(bare.length, 1);
  assert.doesNotMatch(
    bare[0].note,
    /from this skill's SKILL\.md/,
    "the attribution check cannot tell a labelled row from an unlabelled one",
  );
});

test("AC5: the build log carries an I3 advisory for every derived skew, with file and line", async () => {
  // The EM's third binding addition: emit an ADVISORY listing all five skews,
  // each with file and line. Advisory only — a build-log fact for whoever
  // maintains this repository. Nothing is filed anywhere.
  //
  // Built into a throwaway outDir so this cannot race the suites that read the
  // real dist/.
  const { skews } = await versionPopulation();
  const out = await mkdtemp(join(tmpdir(), "skills-i3-"));
  try {
    const { stdout, stderr } = await run(
      process.execPath,
      ["./node_modules/astro/bin/astro.mjs", "build", "--outDir", out],
      { cwd: siteRoot, maxBuffer: 32 * 1024 * 1024 },
    );
    const lines = `${stdout}\n${stderr}`.split("\n");
    const i3 = lines.filter((l) => l.includes("[I3]"));

    // Exactly the derived population: not "at least one", which a single
    // hardcoded advisory would satisfy, and not a number typed here.
    assert.equal(
      i3.length,
      skews.length,
      `the build log carries ${i3.length} I3 advisories for ${skews.length} derived skews`,
    );
    for (const s of skews) {
      const line = i3.find((l) => l.includes(s.skillMd.slice(s.skillMd.indexOf("plugins/"))));
      assert.ok(line, `no I3 advisory names ${s.route}`);
      // File AND line, so a reader can go and look at the declaration.
      assert.match(line, /SKILL\.md:\d+/, `the I3 advisory for ${s.route} names no line`);
      // Both numbers, so the advisory is legible without opening the files.
      assert.ok(
        line.includes(`"${s.skillVersion}"`) && line.includes(`"${s.manifestVersion}"`),
        `the I3 advisory for ${s.route} does not quote both declared versions`,
      );
    }
    // Advisories are reported, not repaired: the build still succeeds.
    assert.match(`${stdout}\n${stderr}`, /Complete!/);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("AC5 meta: no assertion in this file names a skill or a plugin", async () => {
  // The EM's second binding addition, checked rather than promised. Reads this
  // file's own bytes and looks for any skill or plugin name the catalog
  // declares. If somebody pastes an instance into an assertion to make a
  // failure go away, this fails and says which name.
  //
  // SCOPED TO CODE, NOT TO COMMENTS, and the distinction is the whole point.
  // The header above names the skill the specification named — twice,
  // deliberately, because a reader has to be told which instance was
  // generalised and why. A name in prose is documentation. A name in an
  // expression is a class check narrowed to an instance. Only the second is
  // the defect, so only the second is what this searches.
  const skills = await declaredSkills();
  const source = await readFile(join(here, "versions.test.mjs"), "utf8");
  const code = stripComments(source);

  const found = [];
  for (const s of skills) if (code.includes(s.skill)) found.push(`skill "${s.skill}"`);
  for (const p of new Set(skills.map((s) => s.plugin))) {
    if (code.includes(p)) found.push(`plugin "${p}"`);
  }
  assert.deepEqual(
    found,
    [],
    `this suite's CODE names ${found.join(", ")}. The population is derived; a literal ` +
      `here narrows a class check to an instance, which is the exact defect AC5 exists ` +
      `to catch in the specification.`,
  );

  // ── The search is live, and the strip is not eating the file ───────────────
  //
  // Three ways this could pass while proving nothing, each closed:
  //
  // 1. the name search cannot match anything;
  // 2. `stripComments` removed the code along with the comments;
  // 3. the file genuinely has no name anywhere, so the strip is untested.
  assert.ok(skills.length > 0, "the catalog population is empty");
  assert.ok(
    `mentioning ${skills[0].skill} in passing`.includes(skills[0].skill),
    "the name search cannot match a name",
  );
  assert.ok(
    code.includes("versionPopulation") && code.includes("assert.equal"),
    "stripComments removed the code, so the search above ran over nothing",
  );
  const named = skills.filter((s) => source.includes(s.skill));
  assert.ok(
    named.length > 0,
    "no skill name appears anywhere in this file, not even in the header — so the " +
      "comment/code distinction above is untested and this control is asleep",
  );
});

/**
 * Line and block comments removed, string and template literals left alone.
 *
 * Not a JavaScript parser: it is a character scan that tracks whether it is
 * inside `"`, `'`, `` ` `` or a regexp literal, which is enough for this file
 * and small enough to read. The test above asserts it did not eat the code.
 */
function stripComments(src) {
  let out = "";
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (quote) {
      if (c === "\\") {
        out += c + (next ?? "");
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      out += c;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}
