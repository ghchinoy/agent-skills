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
// It is the slowest suite by a wide margin (FIVE full builds, ~10s each, all
// started concurrently at module load). That cost buys the only assertion in
// the project that covers the whole pipeline end to end, and the defect it
// would have caught reached two shipped files and `dist/`. Keep it.
//
// (The count above said "three" for two phases while `cases` held five — the
// Phase 1 reviewer's FYI-2. Corrected here rather than left to rot in the one
// file whose job is to stop things rotting.)
//
// SCOPE NOTE for whoever adds to this: the value here is coverage of the PATH,
// not of the rule. One case per gate is enough; the rules themselves are
// cheaper to test at unit level, and that is where they still live.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, cp, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { constants, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { plantOrThrow, repoRoot, siteRoot, walk } from "./_helpers.mjs";

const run = promisify(execFile);

const SKILL = "plugins/okf-authoring/skills/okf-author/SKILL.md";
const BAD = "/tables/customers.md";

const writable = async (dir) => {
  try {
    await access(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * Where the copied trees go.
 *
 * PREFERRED: a sibling of the repository. Not for tidiness — for the
 * FILESYSTEM. `node_modules` is hard-linked into each copy (see below) and a
 * hard link cannot cross a mount point, so the copy has to live on the same
 * filesystem as the real `node_modules`. `os.tmpdir()` frequently is not:
 * `/tmp` is its own mount on most CI images. Falls back to `tmpdir()` when the
 * parent directory is not writable, where the hard-link attempt degrades to a
 * real copy.
 */
async function tempParent() {
  const sibling = resolve(repoRoot, "..");
  return (await writable(sibling)) ? sibling : tmpdir();
}

/**
 * Gives the copied tree its own `node_modules`: a real directory tree whose
 * FILES are hard links to the real ones. Cheap (no bytes copied), private (each
 * case gets its own `.astro` and `.vite`), and — the part that matters —
 * entirely INSIDE the copied tree.
 *
 * PHASE 2 CHANGED THIS, and the reason is worth keeping.
 *
 * It used to mirror with per-entry SYMLINKS pointing back at the real
 * `node_modules`. That works only when the copy and the real tree sit close
 * enough on disk for the bundler to agree with itself about what a module is
 * called. When they do not, every build that reaches the bundling stage dies:
 *
 *   No cached compile metadata found for
 *   "/REAL/site/node_modules/@astrojs/starlight/components/Page.astro?...lang.css".
 *   The main Astro module "/COPY/site/REAL/site/node_modules/.../Page.astro"
 *   should have compiled and filled the metadata first.
 *
 * Note the second path: the real path concatenated onto the copy's root. The
 * symlink gives one file two identities — the id the .astro module compiled
 * under and the id its virtual CSS module is looked up under — and the lookup
 * misses.
 *
 * It passed locally for a whole phase because the checkout and `os.tmpdir()`
 * happened to be on the same filesystem there. On the first CI run, with the
 * checkout under /home/runner/work and the copies under /tmp, four of the eight
 * tests in this file failed. The Phase 1 reviewer's FYI-3 said to watch the
 * first few CI runs rather than assume a local green transferred; it did not
 * transfer, and this is why.
 *
 * Hard links have their own hazard — writing THROUGH one would corrupt the
 * real package — so note what the build actually writes into `node_modules`:
 * `.astro` and `.vite`, both of which it CREATES. New files get new inodes and
 * touch nothing shared. Nothing in the build rewrites a package file in place.
 *
 * THE INVARIANT THAT MAKES THAT SAFE IS A PROPERTY OF THE TOOLCHAIN, NOT OF
 * THIS FILE (review O4). It holds for Astro, Vite and Starlight as pinned, and
 * no counterexample was found. But any future dependency that rewrites a file
 * under `node_modules` IN PLACE during a build — as opposed to creating a new
 * one, or writing-then-renaming, both of which break the link harmlessly —
 * writes straight through into the developer's real install. On CI that tree is
 * disposable; on a laptop it is their `npm ci`. If you are ever staring at a
 * `node_modules` that changed without you touching it, this is the thread.
 */
async function privateNodeModules(dest) {
  const src = join(siteRoot, "node_modules");
  try {
    // GNU cp. `--link` hard-links regular files; -a keeps symlinks (node_modules/.bin)
    // as symlinks, which is correct because they are relative and stay inside.
    await run("cp", ["-a", "--link", src, dest]);
  } catch {
    // BSD cp, or a hard link that could not be made. Correct but slow; better
    // a slow suite than a suite that quietly stops covering the build.
    //
    // `dest` MUST be removed first (review O3). GNU `cp -a --link` creates the
    // destination and THEN fails per-entry on a cross-device link, so by the
    // time we get here `dest` usually exists and is partially populated — and
    // `cp -a src dest` onto an existing directory copies INTO it, producing
    // `node_modules/node_modules/...` and a tree that resolves nothing.
    await rm(dest, { recursive: true, force: true });
    await run("cp", ["-a", src, dest]);
  }
  // Each case must start from a cold cache; a copied one would bleed state.
  await rm(join(dest, ".astro"), { recursive: true, force: true });
  await rm(join(dest, ".vite"), { recursive: true, force: true });
}

/**
 * Copies the repo to a temp dir, applies `mutate`, and runs a real build.
 *
 * @returns {Promise<{ok: boolean, output: string, root: string}>}
 */
async function buildWith(mutate) {
  const root = await mkdtemp(join(await tempParent(), ".site-e2e-"));
  await cp(repoRoot, root, {
    recursive: true,
    filter: (src) =>
      !src.includes(`${"/"}node_modules`) &&
      !src.includes(`${"/"}.git${"/"}`) &&
      !src.endsWith(`${"/"}.git`) &&
      !src.includes(`${"/"}dist`) &&
      !src.includes(`${"/"}.astro`) &&
      !src.includes(`${"/"}.site-e2e-`),
  });
  await privateNodeModules(join(root, "site", "node_modules"));
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

// ── The perturbation registry for the dist positive control (round 4) ────────
//
// Each value is chosen to be UNMISTAKABLE in rendered output: nothing here can
// be produced by any other means, so a match is proof the constant was consumed
// rather than a coincidence of ordinary page text. `main` is exactly why that
// matters — the real REPO_REF is a word that appears in every page as `<main>`,
// so a control asserting the real value's PRESENCE would pass without the
// constant existing at all.
const PERTURBATIONS = {
  SITE: "https://perturbed-origin.example",
  BASE: "/perturbed-base",
  REPO_URL: "https://github.com/perturbed-owner/perturbed-repo",
  REPO_REF: "perturbed-ref",
};

// Strings that legitimately survive a perturbed config because they come from
// repo DATA rather than from `site.config.mjs`. Each key is the exact literal;
// each value is the measurement that justifies allowing it.
const DATA_SOURCED = {
  "https://github.com/ghchinoy/agent-skills":
    "plugins/okf-authoring/plugin.json:10, the manifest's `repository` field, rendered as a " +
    "metadata row on the plugin page. Measured under a fully perturbed config: 1 occurrence on " +
    "1 page. It follows the MANIFEST, not REPO_URL, so its presence is correct. What this " +
    "allowance hides, and it is worth knowing: the repository identity has a second source of " +
    "truth outside site/, which a repo rename would break too, and no gate on this branch pins " +
    "it — plugin.json is repo data rather than site source. Disclosed in round 4, not fixed here.",
};

/** Removes the allowed data-sourced literals, and nothing else. */
function stripDataSourced(text) {
  let out = text;
  for (const literal of Object.keys(DATA_SOURCED)) out = out.split(literal).join(" ");
  return out;
}

// The exemption, priced. Standard 17b: state what it hides.
const UNPERTURBABLE = {
  PHASE_1_PLUGINS:
    "Not a string export. It is an array of plugin DIRECTORY names, so its " +
    "values are filesystem paths that must exist; perturbing it does not " +
    "measure rendering sensitivity, it removes the only plugin. Measured: with " +
    "a perturbed value the build renders zero skill pages, so the control would " +
    "'pass' by producing nothing to contradict it rather than by following the " +
    "constant. What the exemption hides: whether PHASE_1_PLUGINS reaches the " +
    "output. It does, and it is covered elsewhere by construction — every page " +
    "under plugins/okf-authoring/ exists only because this array names it, and " +
    "the harness control below asserts three of those pages were built.",
};

// The five builds are independent, so they all start here at module load and
// each test awaits the one it needs. Sequential would multiply the wall clock
// for nothing.
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
    await writeFile(p, plantOrThrow(raw, /^name:/m, "category: planted\nname:", "an unknown frontmatter key"));
    // (b) unknown top-level plugin.json key — enumerate.mjs (N3)
    const mp = join(root, "plugins/okf-authoring/plugin.json");
    const manifest = await readFile(mp, "utf8");
    await writeFile(mp, plantOrThrow(manifest, /^\{/, '{\n  "tags": ["planted"],', "an unknown plugin.json key"));
  }),

  // C3 — a non-string metadata value. Used to die on Astro's generic
  // frontmatter error with no file and no line.
  badMetadata: buildWith(async (root) => {
    const p = join(root, SKILL);
    const raw = await readFile(p, "utf8");
    // Unquoting the existing metadata.version makes YAML parse it as a float
    // — and 1.10 becomes 1.1, which is the whole reason this is refused
    // rather than coerced.
    // This one always had an ad-hoc no-op guard. It is now the shared one, so
    // the property holds for every plant rather than the one someone remembered.
    await writeFile(p, plantOrThrow(raw, /^(\s*)version: "1\.0\.0"$/m, '$1version: 1.10', "an unquoted metadata.version"));
  }),

  // ── THE DIST POSITIVE CONTROL, round 4 ──────────────────────────────────────
  // Raised by the round-5 pre-registration, and it is right. An UNCHANGED dist
  // digest is consistent with two incompatible states: the change is genuinely
  // output-neutral, OR the change never reached the output at all — dead path,
  // stale dist, cached build, loader not re-run. `installCommand` travels through
  // a loader and then an Astro component; either hop can be silently bypassed.
  //
  // So byte-identity is only evidence of neutrality if the same apparatus can be
  // shown to MOVE. Perturb REPO_URL, rebuild for real, and require the rendered
  // install command to follow it. If this build produced the same bytes, then
  // byte-identity under the real REPO_URL would prove nothing whatever.
  //
  // THE POPULATION HERE IS THE WHOLE CONSTANT SET, NOT THE ONE CONSTANT THAT WAS
  // ASKED FOR. The round-4 brief named REPO_URL, and a control covering exactly
  // REPO_URL is the round-4 defect one level up: a hand-written inclusion list
  // holding precisely the item the review happened to find. The same mistake was
  // already made once this round in `pins.test.mjs` (DERIVED_COMPONENTS) and
  // caught by running the symmetry check against my own diff. Writing it a second
  // time inside the deliverable added to catch it would be the ninth instance.
  //
  // So: every string export is perturbed in ONE build, the registry is asserted
  // exhaustive over the real `site.config.mjs`, and the one export that cannot be
  // perturbed carries a priced exemption. One build covers all four because the
  // claim is per-constant presence, not a whole-output digest.
  perturbedConstants: buildWith(async (root) => {
    const p = join(root, "site/src/site.config.mjs");
    let raw = await readFile(p, "utf8");
    for (const [name, value] of Object.entries(PERTURBATIONS)) {
      raw = plantOrThrow(
        raw,
        new RegExp(`^export const ${name} = "[^"]*";$`, "m"),
        `export const ${name} = ${JSON.stringify(value)};`,
        `the ${name} export`,
      );
    }
    await writeFile(p, raw);
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

test("E2E control: the copied tree resolves its packages INSIDE itself", async () => {
  // The regression test for the symlink-mirroring defect described on
  // `privateNodeModules`. Every positive in this file asserts a FAILING build,
  // so a harness that could no longer build anything would still satisfy them;
  // the clean-build control below catches that, but only after the fact and
  // with a bundler stack trace that says nothing about why.
  //
  // This says why. If `node_modules` ever points back out of the copy again,
  // this fails first and names the mechanism.
  const { root } = await cases.insideFence;
  const inside = await realpath(root);
  for (const pkg of ["astro", "@astrojs/starlight", "yaml"]) {
    const real = await realpath(join(root, "site", "node_modules", pkg, "package.json"));
    assert.ok(
      real.startsWith(inside),
      `${pkg} resolves to ${real}, outside the copied tree at ${inside} — ` +
        `the bundler will give that file two identities and the build will die ` +
        `with "No cached compile metadata found"`,
    );
  }
  // …and the control for THIS control: the real tree is genuinely elsewhere, so
  // the assertion above is not trivially true of any two paths.
  assert.ok(
    !(await realpath(join(siteRoot, "node_modules", "astro"))).startsWith(inside),
    "the copy and the real site are the same directory; this test proves nothing",
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


/** The perturbed build's rendered HTML, as `{rel, text}`. */
async function perturbedHtml() {
  const { root } = await cases.perturbedConstants;
  const dist = join(root, "site/dist");
  const out = [];
  for (const f of await walk(dist)) {
    if (f.endsWith(".html")) out.push({ rel: f.slice(dist.length + 1), text: await readFile(f, "utf8") });
  }
  return out;
}

test("E2E: the perturbation registry is exhaustive over site.config.mjs", async () => {
  // (d). Without this the control covers whichever constants someone thought of,
  // and a NEW site-wide constant — the most likely future addition to that file —
  // joins the rendering path with no sensitivity proof and nothing says so. This
  // is the assertion that makes the next constant announce itself.
  const config = await readFile(join(siteRoot, "src/site.config.mjs"), "utf8");
  const exported = [...config.matchAll(/^export const (\w+) =/gm)].map((m) => m[1]).sort();
  assert.ok(exported.length > 0, "no exports parsed — the scan is looking at the wrong shape");

  const covered = [...Object.keys(PERTURBATIONS), ...Object.keys(UNPERTURBABLE)].sort();
  assert.deepEqual(
    covered,
    exported,
    "site.config.mjs exports and the perturbation registry have diverged: every export must be " +
      "either perturbed or exempted with a reason",
  );

  // And the exemptions must be priced rather than merely present.
  for (const [name, reason] of Object.entries(UNPERTURBABLE)) {
    assert.ok(reason.length > 60, `${name} is exempted without a real reason`);
  }
  // No perturbed value may be a substring producible by ordinary page text.
  for (const [name, value] of Object.entries(PERTURBATIONS)) {
    assert.match(value, /perturbed/, `${name}'s perturbed value is not self-identifying`);
  }
});

test("E2E: EVERY site constant is shown to reach rendered HTML (dist sensitivity)", async () => {
  // THE POINT OF THIS FILE'S ROUND-4 ADDITION. An unchanged `dist` digest is
  // consistent with two incompatible states — the change is output-neutral, or the
  // change never reached the output. The digest cannot tell them apart. This can:
  // it shows the apparatus MOVING under a known perturbation, per constant.
  //
  // Reported as a measurement, not a boolean: the per-constant file counts below
  // are the denominator for any future claim that byte-identity means neutrality.
  const html = await perturbedHtml();
  assert.ok(html.length >= 7, `only ${html.length} pages rendered`);

  const misses = [];
  for (const [name, value] of Object.entries(PERTURBATIONS)) {
    const hits = html.filter((h) => h.text.includes(value)).length;
    if (hits === 0) misses.push(`${name} (${value}) appears in 0 of ${html.length} rendered pages`);
  }
  assert.deepEqual(
    misses,
    [],
    "a site constant does NOT reach the rendered output, so an unchanged dist digest proves " +
      `nothing about it:\n  ${misses.join("\n  ")}`,
  );
});

test("E2E control: the sensitivity check fails when the output does not follow the constant", async () => {
  // (e). The check above is a presence test, and a presence test over a value
  // nobody rendered would be silently vacuous. This drives the same predicate with
  // a constant that was NOT perturbed into the build and requires it to miss.
  const html = await perturbedHtml();
  const absent = "https://perturbed-but-never-planted.example";
  assert.equal(
    html.filter((h) => h.text.includes(absent)).length,
    0,
    "an unplanted perturbation was found in the output; the predicate matches anything",
  );
  // …and the real values must be GONE, which is the half that catches a stale or
  // cached dist being read instead of the perturbed one.
  //
  // THIS ASSERTION FAILED WHEN FIRST WRITTEN AND THE CODE WAS RIGHT. The real
  // REPO_URL — and therefore the real BASE as a substring of it — still rendered
  // on the plugin page under a fully perturbed config. It is not hard-coded: it
  // is repo DATA, `plugins/okf-authoring/plugin.json:10 "repository"`, rendered as
  // a metadata field. Measured before the exemption was written: one occurrence,
  // one page, and it tracks the manifest rather than the constant.
  //
  // Narrowing an assertion to match observed output is exactly the move standard
  // 10 forbids when the reason is "the code does that" — so the reason here is a
  // measurement of an INDEPENDENT source, and the exemption is priced below.
  const config = await readFile(join(siteRoot, "src/site.config.mjs"), "utf8");
  for (const name of Object.keys(PERTURBATIONS)) {
    const real = new RegExp(`^export const ${name} = "([^"]*)";$`, "m").exec(config)[1];
    if (real === "main") continue; // `<main>` — see the note on PERTURBATIONS
    const survivors = html.filter((h) => stripDataSourced(h.text).includes(real));
    assert.deepEqual(
      survivors.map((h) => h.rel),
      [],
      `the REAL ${name} (${real}) still renders under a perturbed config, and not from any ` +
        `known data source — the build read a stale or cached dist, or the value is hard-coded`,
    );
  }
});

test("E2E: the data-sourced allowance is real, and it is a second source of repo identity", async () => {
  // 17b: what does the exemption above hide? A copy of the repository URL that
  // lives OUTSIDE site/ entirely, in repo data, and that a repository rename would
  // break exactly as surely as the one R2 fixed. It is out of this branch's scope
  // to change; it is not out of scope to know about, and an exemption nobody ever
  // re-checks is how it would stop being known.
  const manifest = JSON.parse(
    await readFile(join(repoRoot, "plugins/okf-authoring/plugin.json"), "utf8"),
  );
  assert.equal(
    manifest.repository,
    Object.keys(DATA_SOURCED)[0],
    "the manifest's repository field moved; the allowance in this file is now covering " +
      "something else and must be re-measured, not edited to agree",
  );
  // The allowance must not be a blanket. It removes ONLY the exact strings listed.
  // "keep " + the replacement space + " keep" — three spaces, not two. The first
  // version of this line said two, and the helper was right; kept as written
  // rather than loosened to a `match`, because the exact substitution is the
  // property that stops the allowance eating adjacent text.
  assert.equal(stripDataSourced("keep https://github.com/ghchinoy/agent-skills keep"), "keep   keep");
  assert.equal(stripDataSourced("/agent-skills/plugins/"), "/agent-skills/plugins/");
});

test("E2E: the rendered install command is DERIVED from REPO_URL, not hard-coded", async () => {
  // The gap the round-5 pre-registration found, and it is real independent of
  // R2: the site's most reader-visible constant had no assertion tying it to a
  // rendered byte. Every other test naming REPO_URL is about the detector.
  //
  // TWO GATES ARE NEEDED AND NEITHER IS SUFFICIENT ALONE. pins.test.mjs catches a
  // LITERAL copy of the owner/repo component in source. This catches a rendered
  // value that DISAGREES with REPO_URL. A re-hardcode of the correct literal
  // passes this one and is caught there; a broken derivation passes there and is
  // caught here.
  const { ok, output, root } = await cases.perturbedConstants;
  assert.ok(ok, `the perturbed build failed:\n${output}`);

  const html = (await perturbedHtml()).map((h) => h.text);
  assert.ok(html.length > 0, "the perturbed build produced no HTML");

  const commands = [...new Set(html.flatMap((h) => [...h.matchAll(/npx skills add ([^\s<]+)/g)].map((m) => m[1])))];
  assert.ok(
    commands.length > 0,
    "no install command is rendered anywhere, so this control cannot see the thing it controls",
  );

  // MOVED. Every rendered slug follows the perturbed constant.
  assert.deepEqual(
    commands,
    ["perturbed-owner/perturbed-repo"],
    "the rendered install command did NOT follow REPO_URL — it is hard-coded somewhere, " +
      "or the loader did not re-run, and an unchanged dist digest would mean nothing",
  );
  assert.ok(
    !html.some((h) => h.includes("npx skills add ghchinoy/agent-skills")),
    "the real slug still renders under a perturbed REPO_URL",
  );
});

test("E2E control: the real build renders the real slug, so the check above is not trivially true", async () => {
  // The other half. Without this, an assertion that the slug is the PERTURBED one
  // would also pass if the renderer emitted a constant string that happened to be
  // the perturbed value — and, more plausibly, it pins the fact that the two
  // builds differ in the way claimed rather than in some unrelated way.
  const real = join(siteRoot, "dist");
  if (!existsSync(real)) return; // `npm test` runs after `npm run build` in CI

  const html = [];
  for (const f of await walk(real)) if (f.endsWith(".html")) html.push(await readFile(f, "utf8"));
  const commands = [...new Set(html.flatMap((h) => [...h.matchAll(/npx skills add ([^\s<]+)/g)].map((m) => m[1])))];
  if (commands.length === 0) return;

  const config = await readFile(join(siteRoot, "src/site.config.mjs"), "utf8");
  const repoUrl = /^export const REPO_URL = "([^"]*)";$/m.exec(config)[1];
  const slug = new URL(repoUrl).pathname.replace(/^\/|\/$/g, "");
  assert.deepEqual(
    commands,
    [slug],
    `the built site renders ${commands.join(", ")} but REPO_URL derives ${slug}`,
  );
});
