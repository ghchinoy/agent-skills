// advisories.test.mjs — acceptance criterion 6, and the arithmetic behind it.
//
// AC6 AS WRITTEN: "The build log lists all advisories: D1 (4 skills), D2 (670
// lines), D3 (6 links), D4, I3, I4 — each with file and line."
//
// THE FIGURES IN IT ARE CLAIMS, NOT GROUND TRUTH. They were measured when the
// proposal was written. Every one of them is RE-DERIVED here from the
// repository, by this file's own reading of the source files, and the derived
// population is what the assertions run over. Where a derived figure differs
// from the proposal's, this suite asserts the DERIVED one and the difference is
// reported as a finding against the proposal in reports/phase4-siteA.md. No
// condition below was narrowed to reproduce a number.
//
// Three of the six codes diverge, and the divergences are of two different
// kinds — which is the reason each population is also printed as a SET in the
// assertion messages rather than compared as a total:
//
//   D3 — proposal says 6, the build emits 11. BOTH ARE RIGHT, under different
//        predicates. 6 is the markdown link targets escaping the skill root
//        via `../../references/`, which is what §3.4's sentence describes. 11
//        is every emitted [D3], which is those 6 plus 5 sibling-skill escapes
//        of the form `../<other-skill>/SKILL.md`. Neither number moved; the
//        predicate was never stated. Asserted below as 6-within-11 so that the
//        relationship, not either total, is what is bound.
//
//   I4 — proposal says 4, the condition it states in words selects 9. See
//        advise.mjs for why the stated condition is the one implemented. The
//        proposal's 4 are a PROPER SUBSET of the derived 9, asserted as such,
//        so a future change that reshuffles membership while preserving the
//        total goes red.
//
//   I3 — proposal states one instance; 5 skills skew. Established in Phase 3
//        and bound in versions.test.mjs, which owns that population. This file
//        asserts only that AC6's "the build log lists them" holds for whatever
//        that suite derives, and does not re-derive it.
//
// NOTHING HERE NAMES A SKILL. Same rule versions.test.mjs adopted and for the
// same reason, and the same self-check enforces it at the bottom.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { promisify } from "node:util";

import {
  adviseDeadPointers,
  adviseLength,
  adviseOrphans,
  countLines,
  RESOURCE_GROUPS,
  SKILL_MD_LINE_GUIDANCE,
} from "../src/loaders/advise.mjs";
import { declaredSkills, distHtmlFiles, here, repoRoot, siteRoot } from "./_helpers.mjs";

const run = promisify(execFile);

// ── An inventory read INDEPENDENTLY of the loader ──────────────────────────
//
// The whole value of this suite is that it does not ask the enumerator what is
// on disk. If the enumerator and the advisory module shared a bug, a suite
// built on the enumerator's answer would agree with it.

/** Every file under `dir` at any depth, named relative to `dir`, sorted. */
async function tree(dir, prefix = "") {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const out = [];
  for (const e of entries) {
    const name = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...((await tree(join(dir, e.name), name)) ?? []));
    else out.push(name);
  }
  return out.sort();
}

/**
 * Every skill with its resource groups read from disk, in the shape advise.mjs
 * consumes: `null` for an absent directory, entries otherwise.
 */
async function skillsWithResources() {
  const skills = await declaredSkills();
  const out = [];
  for (const s of skills) {
    const dir = join(repoRoot, "plugins", s.plugin, "skills", s.skill);
    const resources = {};
    for (const group of RESOURCE_GROUPS) {
      const files = await tree(join(dir, group));
      resources[group] = files === null ? null : files.map((name) => ({ name, kind: "file" }));
    }
    out.push({
      ...s,
      dir,
      repoDir: relative(repoRoot, dir).split("\\").join("/"),
      repoPath: relative(repoRoot, s.skillMd).split("\\").join("/"),
      resources,
    });
  }
  return out;
}

/** `[CODE] file[:line] — message` lines of a build log, parsed. */
function advisoryLines(output) {
  const out = [];
  for (const line of output.split("\n")) {
    const m = /\[([A-Z0-9-]+)\]\s+(\S+?)(?::(\d+))?\s+—\s+(.*)$/.exec(line);
    // The FIRST bracketed token on a log line is the logger's own level tag
    // ([WARN]) and the SECOND is the advisory code. Anchoring on the arrow and
    // on a path-shaped second field is what tells them apart without this
    // parser knowing the logger's format.
    if (m && m[2].includes("/")) out.push({ code: m[1], file: m[2], line: m[3] ?? null, message: m[4] });
  }
  return out;
}

// One build, shared. Astro is not cheap and every test below asks the same
// question of the same log.
let buildOnce;
function build() {
  buildOnce ??= (async () => {
    const out = await mkdtemp(join(tmpdir(), "skills-ac6-"));
    try {
      const { stdout, stderr } = await run(
        process.execPath,
        ["./node_modules/astro/bin/astro.mjs", "build", "--outDir", out],
        { cwd: siteRoot, maxBuffer: 32 * 1024 * 1024 },
      );
      return `${stdout}\n${stderr}`;
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  })();
  return buildOnce;
}

// ── D2 ─────────────────────────────────────────────────────────────────────

test("D2: the over-length population is derived, and the proposal's instance is in it", async () => {
  const skills = await skillsWithResources();
  const measured = skills.map((s) => ({ route: s.route, lines: countLines(s.raw) }));
  const over = measured.filter((m) => m.lines > SKILL_MD_LINE_GUIDANCE);

  assert.equal(
    over.length,
    1,
    `expected one SKILL.md past the ${SKILL_MD_LINE_GUIDANCE}-line guidance, found ` +
      `${over.length}: ${JSON.stringify(over)}`,
  );
  // The proposal's figure, re-derived. If the file is edited upstream this goes
  // red and the report is what changes, not this line.
  assert.equal(
    over[0].lines,
    670,
    `the over-length SKILL.md measures ${over[0].lines} lines; proposal §3.4 D2 measured ` +
      `670. Re-derive and report the divergence — do not edit this number to match.`,
  );
  // Non-vacuity: the condition is capable of excluding, not just of including.
  const under = measured.filter((m) => m.lines <= SKILL_MD_LINE_GUIDANCE);
  assert.ok(under.length > 20, `only ${under.length} of ${measured.length} skills are under it`);
});

test("D2: the length condition fires and does not fire, on planted input", () => {
  const at = `${"x\n".repeat(SKILL_MD_LINE_GUIDANCE)}`;
  const over = `${"x\n".repeat(SKILL_MD_LINE_GUIDANCE + 1)}`;

  // NEGATIVE: exactly at the guidance is allowed. "Under 500" is the wording,
  // so 500 passes — an off-by-one here would invent a deviation.
  assert.equal(countLines(at), SKILL_MD_LINE_GUIDANCE);
  assert.deepEqual(adviseLength(at, "p/SKILL.md"), []);

  // POSITIVE: one line more.
  const fired = adviseLength(over, "p/SKILL.md");
  assert.equal(fired.length, 1);
  assert.equal(fired[0].code, "D2");
  assert.equal(fired[0].file, "p/SKILL.md");
  assert.equal(fired[0].line, SKILL_MD_LINE_GUIDANCE + 1);
  assert.match(fired[0].message, /501 lines/);

  // The counter itself, which every figure above rests on.
  assert.equal(countLines(""), 0, "an empty file is zero lines, not one");
  assert.equal(countLines("a"), 1, "an unterminated final line is still a line");
  assert.equal(countLines("a\n"), 1, "a trailing newline does not add a line");
  assert.equal(countLines("a\nb"), 2);
});

// ── D4 ─────────────────────────────────────────────────────────────────────

test("D4: the dead-pointer population is derived from a class rule over every skill", async () => {
  const skills = await skillsWithResources();
  const found = skills.flatMap((s) => adviseDeadPointers(s.raw, s).map((a) => `${a.file}:${a.line}`));

  // Proposal §3.4 names two, at lines 42 and 48 of one file. Derived here by
  // scanning all 23 skills for resource-shaped code spans, which is the class
  // the proposal stated an instance of.
  assert.equal(
    found.length,
    2,
    `expected 2 dead resource pointers across the catalog, found ${found.length}: ` +
      `${JSON.stringify(found)}`,
  );
  assert.deepEqual(
    found.map((f) => f.slice(f.lastIndexOf(":") + 1)).sort(),
    ["42", "48"],
    `the dead pointers are no longer at the lines proposal §3.4 measured: ${JSON.stringify(found)}`,
  );
  assert.equal(
    new Set(found.map((f) => f.slice(0, f.lastIndexOf(":")))).size,
    1,
    "the two dead pointers are no longer in the same file",
  );

  // NON-VACUITY, and it is the assertion that matters most here. The catalog is
  // full of LIVE resource-shaped code spans; a scanner that found nothing at
  // all would satisfy nothing above but would satisfy a weaker version of it.
  let live = 0;
  for (const s of skills) {
    for (const group of RESOURCE_GROUPS) {
      for (const e of s.resources[group] ?? []) {
        if (s.raw.includes(`${group}/${e.name}`)) live += 1;
      }
    }
  }
  assert.ok(live > 20, `only ${live} live resource pointers found — the scan is not reaching text`);
});

test("D4: the pointer condition fires, does not fire, and ignores fenced text", () => {
  const skill = {
    repoPath: "p/s/SKILL.md",
    repoDir: "p/s",
    resources: {
      references: null,
      scripts: [{ name: "run.sh", kind: "file" }],
      assets: [{ name: "deep/nested.txt", kind: "file" }],
    },
  };

  // NEGATIVE: a pointer at a file that exists.
  assert.deepEqual(adviseDeadPointers("see `scripts/run.sh`", skill), []);
  // NEGATIVE: a directory named by the files beneath it.
  assert.deepEqual(adviseDeadPointers("see `assets/deep/`", skill), []);
  assert.deepEqual(adviseDeadPointers("see `assets/deep/nested.txt`", skill), []);
  // NEGATIVE: text that is not a code span at all.
  assert.deepEqual(adviseDeadPointers("see scripts/gone.sh", skill), []);
  // NEGATIVE: not one of the three resource groups.
  assert.deepEqual(adviseDeadPointers("see `docs/gone.md`", skill), []);
  // NEGATIVE: inside a fence. A transcript is not a claim about this directory.
  assert.deepEqual(
    adviseDeadPointers("```sh\ncat `scripts/gone.sh`\n```\n", skill),
    [],
    "a resource pointer inside a fenced block was reported as a dead pointer",
  );

  // POSITIVE: a missing file in a group that exists.
  const missing = adviseDeadPointers("see `scripts/gone.sh`", skill);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].code, "D4");
  assert.equal(missing[0].line, 1);
  assert.match(missing[0].message, /holds nothing at "gone\.sh"/);

  // POSITIVE: a group directory that is absent entirely — the case the
  // proposal's instance actually is.
  const absent = adviseDeadPointers("a\nb\nthe `references/` directory\n", skill);
  assert.equal(absent.length, 1);
  assert.equal(absent[0].line, 3, "the reported line is not the source line");
  assert.match(absent[0].message, /has no references\/ directory/);
});

// ── I4 ─────────────────────────────────────────────────────────────────────

/** The proposal's four orphans, quoted from §3.7 as PATH SUFFIXES. */
const PROPOSAL_I4_SUFFIXES = [
  "references/CommandsAndMenus.swift",
  "references/HoverAndInputs.swift",
  "references/WindowManagement.swift",
  "references/sample-mcp-audit-report.md",
];

test("I4: the derived orphan set STRICTLY CONTAINS the four the proposal listed", async () => {
  const skills = await skillsWithResources();
  const derived = skills.flatMap((s) => adviseOrphans(s.raw, s).map((a) => a.file)).sort();

  // The count, with its population, and the predicate named in the message so
  // a failure is readable without opening advise.mjs.
  assert.equal(
    derived.length,
    9,
    `predicate: a resource file whose own SKILL.md never contains its name. Derived ` +
      `${derived.length} orphans across ${skills.length} skills:\n  ${derived.join("\n  ")}`,
  );

  // MEMBERSHIP, not just the total — Standard 32. Each of the proposal's four
  // must be present, matched by suffix so this file names no skill.
  for (const suffix of PROPOSAL_I4_SUFFIXES) {
    assert.equal(
      derived.filter((d) => d.endsWith(suffix)).length,
      1,
      `proposal §3.7 lists ${suffix} as an orphan and the derived set has it ` +
        `${derived.filter((d) => d.endsWith(suffix)).length} times`,
    );
  }
  // And the containment is PROPER, which is the finding. If a later change
  // makes the two sets equal, that is a real event and should be looked at.
  assert.ok(
    derived.length > PROPOSAL_I4_SUFFIXES.length,
    `the derived orphan set is no longer strictly larger than the proposal's four`,
  );

  // The five extras contain no SKILL-LEVEL reference, which is the exact shape
  // of the proposal's omission: §3.7's heading says "resources", its list is
  // four references, and every file it left out is in another group. Matched on
  // the group segment rather than on the substring "/references/", because two
  // of the extras live under an assets/ tree that has a references/ directory
  // of its own — sample content inside an asset, §3.5's first glob trap, and
  // the reason that looser test read the wrong five files as references.
  const extras = derived.filter((d) => !PROPOSAL_I4_SUFFIXES.some((s) => d.endsWith(s)));
  assert.equal(extras.length, 5, `extras: ${JSON.stringify(extras)}`);
  const skillLevel = (p, group) => new RegExp(`^plugins/[^/]+/skills/[^/]+/${group}/`).test(p);
  assert.deepEqual(
    extras.filter((e) => skillLevel(e, "references")),
    [],
    `the proposal's four are no longer ALL of the orphaned skill-level references: ` +
      `${JSON.stringify(extras)}`,
  );
  // ...and the discriminator is live: it does select the proposal's four.
  assert.equal(derived.filter((d) => skillLevel(d, "references")).length, 4);
});

test("I4: two mention-detectors with different loss profiles select the same set", async () => {
  // The comparison is run in two variants and both results are asserted, not
  // declared. A substring test is generous (it accepts "xREADME.mdy" as a
  // mention of README.md); a token-boundary test is not. If the two disagreed,
  // the derived population would be an artifact of the detector rather than a
  // fact about the repository, and the count would not be reportable.
  const skills = await skillsWithResources();
  const loose = new Set();
  const strict = new Set();
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  for (const s of skills) {
    for (const group of RESOURCE_GROUPS) {
      for (const e of s.resources[group] ?? []) {
        const id = `${s.repoDir}/${group}/${e.name}`;
        const bare = e.name.slice(e.name.lastIndexOf("/") + 1);
        if (!(s.raw.includes(e.name) || s.raw.includes(bare))) loose.add(id);
        // A leading "/" or "." IS a boundary — a path-qualified mention is a
        // mention. A leading letter is not.
        const re = new RegExp(
          `(^|[^A-Za-z0-9_-])(${esc(e.name)}|${esc(bare)})($|[^A-Za-z0-9_-])`,
        );
        if (!re.test(s.raw)) strict.add(id);
      }
    }
  }

  const onlyLoose = [...loose].filter((x) => !strict.has(x));
  const onlyStrict = [...strict].filter((x) => !loose.has(x));
  assert.deepEqual(
    { onlyLoose, onlyStrict },
    { onlyLoose: [], onlyStrict: [] },
    "the two mention-detectors disagree, so the orphan population depends on which one runs",
  );
  assert.equal(loose.size, 9, `variant 1 selected ${loose.size}`);
  assert.equal(strict.size, 9, `variant 2 selected ${strict.size}`);

  // A comparison of two empty sets is not agreement. The variants must both be
  // capable of selecting and of rejecting.
  let population = 0;
  for (const s of skills) {
    for (const group of RESOURCE_GROUPS) population += (s.resources[group] ?? []).length;
  }
  // NAMED, BECAUSE THE INTEGER IS A HOMONYM. 58 does duty for two unrelated
  // populations in this suite: RESOURCE FILES here (22 + 12 + 24) and CONTENT
  // PAGES in content.test.mjs, in the test named "AC1: dist holds exactly 58
  // content pages", composed 1 + 10 + 23 + 20 + 1 + 3. Same integer, different
  // things counted, and they are equal today by coincidence rather than by any
  // relationship — nothing keeps them equal if either population moves.
  //
  // Both sites already state their composition, so a reader cannot conflate
  // them. The exposure is a future tidy-up seeing two 58s and lifting a shared
  // constant out of them, which would silently couple two counts that have no
  // reason to move together. A name is the cheap inoculation.
  //
  // Cross-referenced by TEST NAME rather than by line number, because a line
  // number is a pin on a moving file and would rot the way the 1527 in
  // site-pages.test.mjs rotted.
  const RESOURCE_FILE_POPULATION = 58;
  assert.equal(
    population,
    RESOURCE_FILE_POPULATION,
    `the resource FILE population is ${population}; AC1's 22 + 12 + 24 is ` +
      `${RESOURCE_FILE_POPULATION}. This is not the 58 content pages in content.test.mjs.`,
  );
  assert.ok(loose.size > 0 && loose.size < population, "the detector accepted or rejected everything");
});

test("I4: the orphan condition fires and does not fire, on planted input", () => {
  const skill = {
    repoPath: "p/s/SKILL.md",
    repoDir: "p/s",
    resources: {
      references: [{ name: "named.md", kind: "file" }, { name: "quiet.md", kind: "file" }],
      scripts: null,
      assets: [{ name: "deep/hidden.txt", kind: "file" }],
    },
  };
  const orphans = adviseOrphans("run `references/named.md` first", skill);
  const files = orphans.map((o) => o.file);

  // POSITIVE: the two nobody named, one of them below the top level.
  assert.deepEqual(files, ["p/s/references/quiet.md", "p/s/assets/deep/hidden.txt"]);
  // NEGATIVE: the one that IS named is absent from the set.
  assert.ok(!files.includes("p/s/references/named.md"));
  // A bare name counts as a mention, not only the group-qualified path.
  assert.deepEqual(adviseOrphans("see hidden.txt and named.md and quiet.md", skill), []);
  // The finding is an ABSENCE, so it carries no line and must not invent one.
  for (const o of orphans) assert.equal(o.line, null, "an orphan advisory invented a line number");
});

// ── AC6 END TO END ─────────────────────────────────────────────────────────

test("AC6: every derived advisory reaches the build log, with its file", async () => {
  const skills = await skillsWithResources();
  const expected = skills.flatMap((s) => [
    ...adviseLength(s.raw, s.repoPath),
    ...adviseDeadPointers(s.raw, s),
    ...adviseOrphans(s.raw, s),
  ]);
  assert.ok(expected.length > 0, "nothing was derived, so this test would prove nothing");

  const logged = advisoryLines(await build());
  assert.ok(logged.length > 0, "the advisory parser found no lines in a real build log");

  // Matched on code AND file AND line together. Matching on code and file
  // alone found the FIRST advisory in a file and compared its line against
  // every expected line in that file — so a file with two findings in it
  // reported a mismatch that was an artifact of the lookup. Two D4s in one
  // SKILL.md is the case, and it is the normal case, not an edge one.
  for (const a of expected) {
    const key = (l) => `${l.code}|${l.file}|${l.line ?? ""}`;
    const want = `${a.code}|${a.file}|${a.line ?? ""}`;
    const hits = logged.filter((l) => key(l) === want);
    assert.equal(
      hits.length,
      1,
      `expected exactly one build-log line for ${want}, found ${hits.length}. ` +
        `The log's lines for that file: ` +
        JSON.stringify(logged.filter((l) => l.file === a.file).map(key)),
    );
  }
});

test("AC6: the log carries all six codes the criterion names, and its totals reconcile", async () => {
  const logged = advisoryLines(await build());
  const by = (code) => logged.filter((l) => l.code === code);

  // ── The six AC6 names, each present ──────────────────────────────────────
  for (const code of ["D1", "D2", "D3", "D4", "I3", "I4"]) {
    assert.ok(by(code).length > 0, `AC6 names ${code} and the build log carries none`);
  }

  // ── D1: "4 skills". The advisory is per FIELD, so the population that
  // reconciles with the criterion is the set of distinct FILES, not of lines.
  assert.equal(
    new Set(by("D1").map((l) => l.file)).size,
    4,
    `D1 covers ${new Set(by("D1").map((l) => l.file)).size} distinct files; AC6 says 4 skills. ` +
      `Predicate: distinct SKILL.md paths carrying at least one [D1].`,
  );

  // ── D3: "6 links", and the build emits 11. Both predicates asserted, so the
  // relationship is what is bound rather than either total. Six of the eleven
  // escape the SKILL ROOT to the plugin's own references/; the other five are
  // sibling-skill pointers. A change that turned one kind into the other while
  // holding 11 would go red here and would not if only the total were checked.
  const d3 = by("D3");
  assert.equal(d3.length, 11, `D3 total moved: ${d3.length}`);
  // Discriminated on the LINK TARGET the advisory quotes, not on the substring
  // "../../references/" anywhere in the message: the sibling-skill advisories
  // mention that form too, in a sentence comparing themselves to it, so the
  // looser test selected all eleven and reported them as six.
  const escapes = d3.filter((l) => /link "\.\.\/\.\.\/references\//.test(l.message));
  assert.equal(
    escapes.length,
    6,
    `proposal §3.4 D3 describes links escaping to the plugin's references/ and measured 6; ` +
      `${escapes.length} of the ${d3.length} emitted [D3] advisories are of that kind`,
  );
  assert.equal(d3.length - escapes.length, 5, "the sibling-skill remainder moved");
  // §3.4 says "two skills". Three emit.
  assert.equal(
    new Set(escapes.map((l) => l.file)).size,
    2,
    "the plugin-references escapes are no longer confined to the two skills §3.4 names",
  );
  assert.equal(
    new Set(d3.map((l) => l.file)).size,
    3,
    "the number of skills emitting any [D3] moved from the 3 measured in Phase 4",
  );

  // ── Every code carries a file, and every line that is present is a number.
  for (const l of logged) {
    assert.ok(l.file.includes("/"), `an advisory logged a file that is not a path: ${l.file}`);
    if (l.line !== null) assert.match(l.line, /^\d+$/);
  }

  // ── I4 is the one code AC6's "each with file and line" cannot have. The
  // finding is that SKILL.md does not mention a file; there is no line where
  // that absence sits. Asserted as a deliberate, uniform property rather than
  // left as a gap somebody might later "fix" by writing a number in.
  assert.equal(
    by("I4").filter((l) => l.line !== null).length,
    0,
    "an I4 advisory carries a line number, which would have to be invented",
  );
  assert.ok(by("I4").every((l) => l.file.includes("/")), "an I4 advisory names no file");

  // ── The total reconciles against the sum of its parts, with no residual.
  const codes = new Set(logged.map((l) => l.code));
  const sum = [...codes].reduce((n, c) => n + by(c).length, 0);
  assert.equal(sum, logged.length, "the per-code partition does not cover the log");
  const reported = Number(/(\d+) source-repo advisor/.exec(await build())[1]);
  assert.equal(
    logged.length,
    reported,
    `the build says ${reported} advisories and ${logged.length} lines were parsed`,
  );
});

test("AC6 control: the log parser can fail, and is not matching the logger's own tag", () => {
  // POSITIVE on a synthetic line of the exact shape the loader emits.
  const one = advisoryLines("07:00:00 [WARN] [agent-skills]   [D2] a/b/SKILL.md:501 — too long");
  assert.deepEqual(one, [{ code: "D2", file: "a/b/SKILL.md", line: "501", message: "too long" }]);

  // POSITIVE without a line, which is the I4 shape.
  const noLine = advisoryLines("07:00:00 [WARN] [agent-skills]   [I4] a/b/x.swift — orphan");
  assert.deepEqual(noLine, [{ code: "I4", file: "a/b/x.swift", line: null, message: "orphan" }]);

  // NEGATIVE: an ordinary log line is not an advisory.
  assert.deepEqual(advisoryLines("07:00:00 [build] Complete!"), []);
  // NEGATIVE: the logger's own level tag has no path after it.
  assert.deepEqual(advisoryLines("07:00:00 [WARN] [agent-skills] 42 advisories:"), []);
  // NEGATIVE: an em-dash is required. A hyphen is not the loader's format, and
  // if that ever changes this control is what says so.
  assert.deepEqual(advisoryLines("[D2] a/b/SKILL.md:501 - too long"), []);
});

test("AC6 meta: no assertion in this file names a skill or a plugin", async () => {
  // Same self-check as versions.test.mjs, for the same reason: every
  // population here is derived, and a literal name in an expression would
  // narrow a class check to the instance the proposal happened to record.
  // Scoped to CODE, not comments — the header names instances deliberately.
  const skills = await declaredSkills();
  const source = await readFile(join(here, "advisories.test.mjs"), "utf8");
  const code = source
    .split("\n")
    .map((l) => (l.trimStart().startsWith("//") ? "" : l))
    .join("\n");

  const found = [];
  for (const s of skills) if (code.includes(s.skill)) found.push(`skill "${s.skill}"`);
  for (const p of new Set(skills.map((s) => s.plugin))) {
    if (code.includes(p)) found.push(`plugin "${p}"`);
  }
  assert.deepEqual(found, [], `this suite's CODE names ${found.join(", ")}`);

  // The search must be live and the comment strip must not have eaten the file.
  assert.ok(skills.length > 0, "the catalog population is empty");
  assert.ok(`saw ${skills[0].skill} here`.includes(skills[0].skill), "the name search cannot match");
  assert.ok(code.includes("adviseOrphans"), "the comment strip removed the code as well");
  // A probe that exists ONLY in a comment. Assembled from pieces so that the
  // probe itself is not a literal in the code — the first attempt at this
  // check wrote the phrase out, which put it in the very text being searched
  // and made the assertion unsatisfiable no matter how well the strip worked.
  const probe = ["THE FIGURES", "IN IT ARE", "CLAIMS"].join(" ");
  assert.ok(source.includes(probe), "the probe phrase is no longer in this file's header");
  assert.ok(!code.includes(probe), "the comment strip removed nothing");
});

test("AC6 meta: the resource inventory this suite reads is its own, not the loader's", async () => {
  // If this file imported the enumerator, a bug shared between the enumerator
  // and advise.mjs would be invisible: both sides of every comparison above
  // would carry it. Asserted rather than promised, because the import is one
  // autocomplete away.
  const source = await readFile(join(here, "advisories.test.mjs"), "utf8");
  assert.doesNotMatch(
    source,
    /from "\.\.\/src\/loaders\/enumerate\.mjs"/,
    "this suite now reads the enumerator's inventory, so it can no longer contradict it",
  );
  // And the local reader really does reach depth 2, which is where AC1's
  // dotfile lives and where a top-level-only reader would silently stop.
  const skills = await skillsWithResources();
  const nested = skills.flatMap((s) =>
    (s.resources.assets ?? []).filter((e) => e.name.includes("/")).map((e) => e.name),
  );
  assert.ok(nested.length > 0, "this suite's own inventory found no nested asset — it is too shallow");
  assert.ok(
    nested.some((n) => n.split("/").pop().startsWith(".")),
    "this suite's own inventory is skipping dotfiles",
  );
  // stat is imported for this one check: the paths above must be real files.
  const first = skills.find((s) => (s.resources.assets ?? []).some((e) => e.name.includes("/")));
  const sample = first.resources.assets.find((e) => e.name.includes("/"));
  assert.ok((await stat(join(first.dir, "assets", sample.name))).isFile());
});

// ── THE THIRD POPULATION: PROSE EMITTED BY CODE ─────────────────────────────
//
// Raised by the EM, and neither of us had looked at it. Every discussion of
// restated normative language on this site has been about PAGES AUTHORED AS
// PROSE — the landing page, the standards page. But the loaders also emit
// English, and some of that English restates the specifications:
//
//   D1            "…the Agent Skills spec defines metadata as a map of string
//                  keys to string VALUES."
//   NAME-DIR-SKEW "…Agent Skills requires them to match."
//   I4            "…another file in the repository may describe it."
//
// If any of that reaches a rendered page, it is site-authored restatement in
// the same sense the landing-page sentence was, arriving by a route no AC and
// no detector in this suite has ever pointed at.
//
// ENUMERATED RATHER THAN SEARCHED, because a needle would only tell me about
// the messages I thought to grep for. The routes out of an advisory are
// finite and all of them were followed: `throw` (build fails, never renders),
// the build log (skills.ts §6.5, `Advisories to the build log`), and
// `_skill.specNotes`, which IS carried on entity data and therefore COULD
// render — except that no component reads it. `grep -rn specNotes src/` returns
// five hits, all inside the loaders, none in `src/components/` or in
// `content.config.ts`.
//
// SO THE ANSWER IS NO, AND THIS TEST IS WHAT KEEPS IT NO. A future component
// that renders `specNotes`, or an advisory routed to a page, turns it red.

test("no advisory prose reaches a rendered page — the emitted-English population", async () => {
  const logged = advisoryLines(await build());
  assert.ok(logged.length > 0, "no advisories were emitted, so this test would prove nothing");

  // A stable needle per message: its longest run of fixed prose, with no digit
  // and no path separator in it, so the needle is the TEMPLATE's words rather
  // than one skill's interpolated values.
  const needle = (message) =>
    message
      .split(/[^A-Za-z ,']+/)
      .map((s) => s.trim())
      .sort((a, b) => b.length - a.length)[0] ?? "";

  const needles = [...new Set(logged.map((l) => needle(l.message)))].filter((n) => n.length >= 30);
  assert.ok(
    needles.length >= 4,
    `only ${needles.length} advisory needles were derived; the extractor has stopped working ` +
      "and the search below would be over almost nothing",
  );

  // POSITIVE CONTROL FIRST, and it is the whole reason the zero below means
  // anything. THESE EXACT NEEDLES ARE FOUND, by this exact matcher, in the
  // build log. So a zero in `dist/` is an absence in the artifact and not a
  // dead selector — the same string, the same search, two outputs, one hit and
  // one miss. E-4's ladder: the control is drawn from the corpus the scan is at
  // risk against, not from the scan.
  const log = await build();
  for (const n of needles) {
    assert.ok(log.includes(n), `the needle ${JSON.stringify(n)} is not even in the build log`);
  }

  const html = await Promise.all(
    (await distHtmlFiles()).map(async (p) => ({ p, text: await readFile(p, "utf8") })),
  );
  assert.ok(html.length >= 50, `only ${html.length} rendered pages were searched`);

  const rendered = [];
  for (const n of needles) {
    for (const { p, text } of html) {
      if (text.includes(n)) rendered.push(`${relative(siteRoot, p)} renders advisory prose: ${n}`);
    }
  }

  assert.deepEqual(
    rendered,
    [],
    "advisory prose is rendering to a page. Some of it restates the specifications " +
      "in the site's own words, which is the thing AC3 forbids, arriving by a route " +
      "no page-level scan looks at. An operator-facing build-log message explaining " +
      "WHY a plugin was rejected is a different act from telling a reader what a " +
      "specification says — but that defence only holds while the message stays in " +
      "the log, and this is where it stopped:\n  " + rendered.join("\n  "),
  );
});
