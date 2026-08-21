// build-e2e.test.mjs — the test class this suite was missing.
//
// WHY THIS FILE EXISTS
//
// Round 1 added 23 tests and every one of them passed while a live defect sat
// in `protectedRanges()`. `link-rules.test.mjs` called `resolveTarget()`
// directly and proved it throws on a site-absolute target — which was true,
// and useless, because `rewriteLinks()` never called it for anything after an
// indented closing fence. A unit test cannot see a caller that does not call.
//
// So the rule this file enforces is different in kind from the other suites:
//   plant a bad thing in a copy of a REAL source file,
//   run the REAL build,
//   assert the build fails, naming file, line and target.
//
// It is the slowest suite by a wide margin (three full builds, ~10s each, run
// concurrently). That cost buys the only assertion in the project that covers
// the whole pipeline end to end, and the defect it would have caught reached
// two shipped files and `dist/`. Keep it.
//
// SCOPE NOTE for whoever adds to this: the value here is coverage of the PATH,
// not of the rule. One case per gate is enough; the rules themselves are
// cheaper to test at unit level, and that is where they still live.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { repoRoot, siteRoot } from "./_helpers.mjs";

const run = promisify(execFile);

const SKILL = "plugins/okf-authoring/skills/okf-author/SKILL.md";
const BAD = "/tables/customers.md";

/**
 * Copies the repo to a temp dir, applies `mutate`, and runs a real build.
 *
 * `node_modules` is MIRRORED — a real directory whose entries are symlinks to
 * the real ones — rather than copied or symlinked whole.
 *
 *   - copying is out: 376MB per case, five cases
 *   - symlinking the whole directory is what I did first, and it is wrong.
 *     Astro writes its content-layer cache to `node_modules/.astro`, so five
 *     concurrent builds sharing one symlink race over one cache. It produced
 *     exactly one intermittent failure before I noticed, which is the worst
 *     possible amount. Running them sequentially would not have fixed it
 *     either — it would have traded the race for stale cache bleeding from
 *     one case into the next, which is harder to see and just as wrong.
 *
 * Mirroring gives each case a writable `node_modules` of its own for `.astro`
 * and `.vite`, while the packages themselves are shared and resolved from
 * their real paths.
 *
 * @returns {Promise<{ok: boolean, output: string, root: string}>}
 */
async function buildWith(mutate) {
  const root = await mkdtemp(join(tmpdir(), "site-e2e-"));
  await cp(repoRoot, root, {
    recursive: true,
    filter: (src) =>
      !src.includes(`${"/"}node_modules`) &&
      !src.includes(`${"/"}.git${"/"}`) &&
      !src.endsWith(`${"/"}.git`) &&
      !src.includes(`${"/"}dist`) &&
      !src.includes(`${"/"}.astro`),
  });
  const mods = join(root, "site", "node_modules");
  await mkdir(mods, { recursive: true });
  for (const ent of await readdir(join(siteRoot, "node_modules"))) {
    // Skip the caches themselves: each case creates its own.
    if (ent === ".astro" || ent === ".vite") continue;
    await symlink(join(siteRoot, "node_modules", ent), join(mods, ent));
  }
  await mutate(root);
  try {
    const { stdout, stderr } = await run("npm", ["run", "build"], {
      cwd: join(root, "site"),
      env: process.env,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { ok: true, output: stdout + stderr, root };
  } catch (err) {
    return { ok: false, output: `${err.stdout ?? ""}${err.stderr ?? ""}`, root };
  }
}

/**
 * The advisory total the build reports, or `null` if it reported none.
 *
 * Matched against the string the build ACTUALLY emits. Pinned by the control
 * below, because the point of F1 is that a literal nobody checks against real
 * output is how an assertion becomes decorative.
 */
function advisoryCount(output) {
  const m = /(\d+) source-repo advisories/.exec(output);
  return m ? Number(m[1]) : null;
}

/** Appends `text` to a file in the copied repo and returns its 1-based line. */
async function append(root, relPath, text) {
  const p = join(root, relPath);
  const before = await readFile(p, "utf8");
  const body = before.endsWith("\n") ? before : `${before}\n`;
  await writeFile(p, `${body}${text}\n`);
  return body.split("\n").length; // the appended text lands on this line
}

/** Set by the `afterIndentedFence` plant; read by the test that awaits it. */
let plantedLine = null;

// The builds are independent, so they run concurrently and each test awaits
// the one it needs. Sequential would multiply the wall clock for nothing.
const cases = {
  // POSITIVE 1 — a bad link in an ordinary region. This one always worked;
  // it is here so a failure in the other two can be attributed to the region
  // rather than to the harness, the plant, or the rule.
  normalRegion: buildWith(async (root) => {
    const p = join(root, SKILL);
    const lines = (await readFile(p, "utf8")).split("\n");
    // Line 14 is prose, outside any fence — the reviewer's own choice of site.
    lines.splice(14, 0, `Planted in a normal region: [x](${BAD})`);
    await writeFile(p, lines.join("\n"));
  }),

  // POSITIVE 2 — THE REGRESSION. End of file, which in okf-author sits after
  // the indented closing fence at line 197. Before the fix this built clean
  // and the dead link reached dist/.
  afterIndentedFence: buildWith(async (root) => {
    // F2.1: keep the line the plant landed on. The whole claim about the §6.5
    // hard error is that it names file, LINE and target; a test that plants at
    // a line it then declines to look at is only checking two thirds of it.
    plantedLine = await append(root, SKILL, `Planted after the indented fence: [x](${BAD})`);
  }),

  // NEGATIVE (near miss) — the SAME bad target, inside a fenced block, where
  // it is a code sample and not a link. Must build CLEAN and reach dist
  // verbatim. Without this, "delete the fence logic entirely" would pass every
  // other test in this file.
  insideFence: buildWith(async (root) => {
    await append(root, SKILL, ["```", `[x](${BAD})`, "```"].join("\n"));
  }),

  // ── The generalisation R5 asks for ───────────────────────────────────────
  // R5's real lesson is "a gate proven only at unit level is not proven".
  // Auditing the rest of the suite for that shape turned up three more gates
  // in the same position — reachable in principle, never once driven through
  // a real build. They are advisory gates rather than hard errors, so one
  // build covers all three: each must appear in the build LOG.
  advisories: buildWith(async (root) => {
    // (a) unknown top-level SKILL.md frontmatter key — frontmatter.mjs
    const p = join(root, SKILL);
    const raw = await readFile(p, "utf8");
    await writeFile(p, raw.replace(/^name:/m, "category: planted\nname:"));
    // (b) unknown top-level plugin.json key — enumerate.mjs (N3)
    const mp = join(root, "plugins/okf-authoring/plugin.json");
    const manifest = await readFile(mp, "utf8");
    await writeFile(mp, manifest.replace(/^\{/, '{\n  "tags": ["planted"],'));
  }),

  // C3 — a non-string metadata value. Used to die on Astro's generic
  // frontmatter error with no file and no line.
  badMetadata: buildWith(async (root) => {
    const p = join(root, SKILL);
    const raw = await readFile(p, "utf8");
    // Unquoting the existing metadata.version makes YAML parse it as a float
    // — and 1.10 becomes 1.1, which is the whole reason this is refused
    // rather than coerced.
    const out = raw.replace(/^(\s*)version: "1\.0\.0"$/m, '$1version: 1.10');
    assert.notEqual(out, raw, "the metadata.version plant did not apply");
    await writeFile(p, out);
  }),
};

test.after(async () => {
  for (const p of Object.values(cases)) {
    const { root } = await p;
    await rm(root, { recursive: true, force: true });
  }
});

test("E2E: a bad link in a normal region fails the build, naming file, line and target", async () => {
  const { ok, output } = await cases.normalRegion;
  assert.equal(ok, false, "the build SUCCEEDED with an unresolvable link in it");
  assert.match(output, /unresolvable link target/);
  assert.ok(output.includes(BAD), `the error does not name the target ${BAD}`);
  assert.ok(output.includes(SKILL), `the error does not name the file ${SKILL}`);
  assert.match(output, new RegExp(`${SKILL}:15\\b`), "the error does not name line 15");
});

test("E2E: a bad link AFTER an indented closing fence fails the build too (R5)", async () => {
  // The defect: `protectedRanges()` sliced with the length of the backtick run
  // instead of the whole match, so three spaces of indent left the fence open
  // to EOF and every link below it was treated as code. The §6.5 gate could
  // not fire in that region. This is the assertion that would have caught it.
  const { ok, output, root } = await cases.afterIndentedFence;
  assert.equal(
    ok,
    false,
    "the build SUCCEEDED — an unresolvable link after an indented closing " +
      "fence is being treated as code, which is R5 all over again",
  );
  assert.match(output, /unresolvable link target/);
  assert.ok(output.includes(BAD));
  // F2.1: assert the LINE, which this test planted and then ignored. The line
  // is the part of the diagnostic most likely to break silently — it survives
  // frontmatter, the H1 strip and the fence scan, and every one of those can
  // shift it — and it is the only part a reader acts on.
  assert.ok(plantedLine > 200, `the plant landed at line ${plantedLine}, before the fence`);
  assert.ok(
    output.includes(`${SKILL}:${plantedLine}`),
    `the error should name ${SKILL}:${plantedLine}; it says: ` +
      `${/unresolvable link target[^\n]*/.exec(output)?.[0] ?? "(nothing)"}`,
  );
  assert.ok(
    !existsSync(join(root, "site", "dist", "plugins")),
    "a failed build still produced pages",
  );
});

test("E2E control: the same bad target INSIDE a fence builds clean and is left verbatim", async () => {
  const { ok, output, root } = await cases.insideFence;
  assert.equal(ok, true, `the build failed on a link inside a code fence:\n${output}`);
  const page = await readFile(
    join(root, "site", "dist", "plugins", "okf-authoring", "okf-author", "index.html"),
    "utf8",
  );
  // Rendered as code, with the target NOT rewritten to a route.
  assert.ok(
    page.includes(`[x](${BAD})`),
    "the fenced code sample was rewritten or dropped instead of left alone",
  );
  assert.ok(
    !page.includes(`href="/agent-skills/tables/customers`),
    "the fenced sample became a real link",
  );
});

test("E2E: advisory gates proven only at unit level actually fire in a real build", async () => {
  // The R5 generalisation. Each of these was tested by calling its function
  // directly and asserting the returned advisory — which says nothing about
  // whether the build ever calls it, or whether the advisory reaches a human.
  const { ok, output } = await cases.advisories;
  assert.equal(ok, true, `the planted advisories should not fail the build:\n${output}`);
  assert.match(
    output,
    /\[UNKNOWN-FIELD\][^\n]*SKILL\.md:\d+[^\n]*"category"/,
    "the unknown FRONTMATTER key advisory never reached the build log",
  );
  assert.match(
    output,
    /\[UNKNOWN-FIELD\][^\n]*plugin\.json:\d+[^\n]*"tags"/,
    "the unknown MANIFEST key advisory never reached the build log (N3)",
  );
  // F1. This line used to read:
  //
  //     assert.doesNotMatch(output, /Advisories: 10\b/, "the count did not move");
  //
  // The build has never emitted the string "Advisories: 10" in its life — it
  // says "10 source-repo advisories". So the assertion could not fail under
  // any input. It is the R2 defect exactly: a check that is not a gate.
  //
  // Repaired rather than deleted, because there IS a real claim here that the
  // two matches above do not make: the planted keys must ADD to the advisory
  // total, not merely appear in the log. And it is written relationally —
  // planted count against the count from an unplanted build — so it cannot go
  // vacuous again if the baseline changes. A literal 12 here would be a fact
  // about today's repo that silently stops being checked the day an advisory
  // is fixed.
  const planted = advisoryCount(output);
  const baseline = advisoryCount((await cases.insideFence).output);
  assert.equal(baseline, 10, `the unplanted baseline moved: ${baseline}`);
  assert.equal(
    planted,
    baseline + 2,
    `two keys were planted, so the total should be ${baseline + 2}, not ${planted} — ` +
      `an advisory is being logged without being counted, or vice versa`,
  );
});

test("E2E control: the advisory-count assertion is aimed at a string the build emits", async () => {
  // The control F1 says the original assertion never had. Positive: the helper
  // reads the real line out of a real build's output.
  const { output } = await cases.insideFence;
  assert.match(output, /\d+ source-repo advisories/, "the build no longer reports a total");
  assert.equal(advisoryCount(output), 10);

  // Negative, and the evidence for the finding: the literal the deleted
  // assertion matched against appears in NO build output that has ever
  // existed. Kept as a test rather than a comment so that if the build ever
  // does start saying "Advisories: N", whoever makes that change is told that
  // a previous assertion depended on the wording.
  assert.doesNotMatch(output, /Advisories:/, "the build's wording changed; re-check F1");
  assert.equal(advisoryCount("Advisories: 10"), null);

  // And the helper must not match a number that is merely nearby.
  assert.equal(advisoryCount("10 source-repo advisers"), null);
  assert.equal(advisoryCount("no advisories at all"), null);
});

test("E2E: neither planted unknown key is rendered on the page (report AND ignore)", async () => {
  const { root } = await cases.advisories;
  const page = await readFile(
    join(root, "site", "dist", "plugins", "okf-authoring", "okf-author", "index.html"),
    "utf8",
  );
  assert.ok(!page.includes("planted"), "an unknown key's value was rendered");
});

test("E2E: a non-string metadata value fails with a diagnostic naming file and line (C3)", async () => {
  const { ok, output } = await cases.badMetadata;
  assert.equal(ok, false, "a non-string metadata value built successfully");
  assert.match(output, /skills-loader:/, "this is Astro's generic error, not the loader's");
  assert.match(
    output,
    new RegExp(`${SKILL}:6\\b`),
    "the diagnostic does not name the file and line of the offending key",
  );
  // F2.2: this used to be `output.includes("1.1")`, which the "1.10" already
  // in the same sentence satisfies on its own — so it discriminated nothing.
  // The coerced value has to be asserted where the message reports the value
  // it actually parsed, and as a whole number so "1.10" cannot stand in for
  // it.
  assert.match(
    output,
    /metadata\.version is number \(1\.1\)(?!\d)/,
    "the error does not show the COERCED value that refusing to coerce avoids",
  );
  assert.doesNotMatch(
    output,
    /Invalid content entry frontmatter/,
    "Astro's generic frontmatter error is still what the developer sees",
  );
});

test("E2E control: the harness itself is not what makes builds fail", async () => {
  // Every positive above asserts a FAILING build, so they would all pass if
  // the copy were simply broken — a missing node_modules symlink, say. The
  // clean case proves a copied tree builds, and proves it produced real pages.
  const { ok, root } = await cases.insideFence;
  assert.equal(ok, true);
  for (const rel of [
    "plugins/okf-authoring/index.html",
    "plugins/okf-authoring/okf-author/index.html",
    "plugins/okf-authoring/references/trust-vocabulary/index.html",
  ]) {
    assert.ok(existsSync(join(root, "site", "dist", rel)), `the copy did not build ${rel}`);
  }
});
