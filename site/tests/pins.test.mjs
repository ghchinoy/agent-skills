// pins.test.mjs — the build's own preconditions.
//
// Proposal §10.4 pins the toolchain exactly, because "it built on my machine in
// August" is not a property a repo can rely on. These tests fail if a range
// creeps back in, if the lockfile drifts from the manifest, or if the site
// quietly becomes an npm workspace of the parent repo.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, access, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";

import { repoRoot, siteRoot, walk, rel } from "./_helpers.mjs";

const PINNED = {
  astro: "7.2.4",
  "@astrojs/starlight": "0.41.7",
  "@astrojs/check": "0.9.10",
  typescript: "5.9.3",
};

/** Strips JSONC comments, leaving string literals alone. */
function stripJsonComments(text) {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      const nl = text.indexOf("\n", i);
      if (nl === -1) break;
      i = nl - 1;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end === -1) break;
      i = end + 1;
      continue;
    }
    out += c;
  }
  return out;
}

const pkg = async (p) => JSON.parse(stripJsonComments(await readFile(p, "utf8")));
const exists = async (p) => {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

test("astro and starlight are pinned to exact versions, not ranges", async () => {
  const manifest = await pkg(join(siteRoot, "package.json"));
  const deps = { ...manifest.dependencies, ...manifest.devDependencies };
  for (const [name, version] of Object.entries(PINNED)) {
    assert.equal(deps[name], version, `${name} must be pinned to exactly ${version}`);
  }
  // No range operator on ANY dependency: a caret here is how a build starts
  // producing different bytes from the same commit.
  for (const [name, version] of Object.entries(deps)) {
    assert.match(
      version,
      /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
      `${name} is declared as "${version}" — pin it exactly`,
    );
  }
});

test("pins control: the range detector rejects the forms it is meant to reject", () => {
  const re = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
  for (const bad of ["^7.2.4", "~7.2.4", ">=7.2.4", "7.x", "latest", "*"]) {
    assert.ok(!re.test(bad), `the range detector accepts "${bad}"`);
  }
  for (const good of ["7.2.4", "0.41.7", "1.0.0-rc.1"]) {
    assert.ok(re.test(good), `the range detector rejects the valid pin "${good}"`);
  }
});

test("there is a type check, and `npm test` runs it", async () => {
  // The loader is a .ts file with a tsconfig.json beside it, and for a whole
  // phase nothing type-checked either. `astro check` found 39 errors on first
  // run, one of which was a real duplicated object key in skills.ts and two of
  // which were `z.record()` calls that had been silently wrong since Zod 4.
  // A check nobody runs is not a check, so it is wired into `npm test` rather
  // than left as a script a reviewer has to know about.
  const manifest = await pkg(join(siteRoot, "package.json"));
  assert.equal(manifest.scripts?.typecheck, "astro check");
  assert.match(
    manifest.scripts?.test ?? "",
    /\bnpm run typecheck\b/,
    "`npm test` does not run the type check",
  );
  assert.match(manifest.scripts?.test ?? "", /node --test/, "`npm test` no longer runs the suite");
  for (const dep of ["@astrojs/check", "typescript"]) {
    assert.ok(manifest.devDependencies?.[dep], `${dep} is not a devDependency`);
  }
});

/**
 * Keys declared twice in the SAME object, reported by dotted path.
 *
 * Deliberately not a line regex over `"key":`. The same NAME in two different
 * objects is ordinary JSON — "astro" is both a dependency and a script in this
 * very manifest — so a detector has to track nesting, not indentation. Written
 * as a small scanner because JSON.parse cannot help: it takes the last of two
 * duplicates and reports nothing at all.
 *
 * JSONC-aware, because tsconfig.json is JSONC and now carries a long comment
 * documenting the type check's real scope (R6). A comment can contain braces,
 * quotes and colons — this one does — so a scanner that did not skip comments
 * would not merely miss duplicates in that file, it would desynchronise and
 * report nonsense for the rest of it.
 */
function duplicateKeys(text) {
  const dupes = [];
  const stack = [];
  let last = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") {
      i = text.indexOf("\n", i);
      if (i === -1) break;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end === -1) break;
      i = end + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let s = "";
      while (j < text.length && text[j] !== '"') {
        if (text[j] === "\\") {
          s += text[j + 1];
          j += 2;
          continue;
        }
        s += text[j];
        j += 1;
      }
      last = s;
      i = j;
    } else if (c === "{") {
      stack.push({ key: last, keys: new Set() });
      last = null;
    } else if (c === "[") {
      stack.push({ key: last, keys: null });
      last = null;
    } else if (c === "}" || c === "]") {
      stack.pop();
      last = null;
    } else if (c === ":") {
      const top = stack[stack.length - 1];
      if (top?.keys && last !== null) {
        const path = [...stack.map((f) => f.key).filter(Boolean), last].join(".");
        if (top.keys.has(last)) dupes.push(path);
        top.keys.add(last);
      }
      // `last` deliberately survives the colon: it is the key a following `{`
      // or `[` is opened under, and nulling it here is what made the first
      // version of this report a bare "test" instead of "scripts.test".
    } else if (c === ",") {
      last = null;
    }
  }
  return dupes;
}

/**
 * JSON files in the site root that are NOT scanned for duplicate keys, each with
 * the reason. Asserted exhaustive against the directory below, so a new JSON file
 * is scanned by default and can only be skipped by being named here.
 */
const UNSCANNED_JSON = {
  "package-lock.json":
    "generated by npm and never hand-edited, so a duplicate key in it would be " +
    "an npm defect rather than one of ours, and it is large enough to dominate " +
    "the run time of this suite",
};

/** Every JSON file in the site root, read from the directory, not named here. */
async function ownedJsonIn(root) {
  return (await readdir(root)).filter((f) => f.endsWith(".json")).sort();
}

test("no JSON file this site owns declares a key twice", async () => {
  // JSON.parse takes the LAST of two duplicated keys and reports nothing, so a
  // config can carry a stale block that every tool silently ignores and every
  // reader has to guess about. `astro check` caught exactly this shape in
  // skills.ts (ts(2783)); nothing type-checks JSON, so this does. The first
  // thing it found was a duplicated `devDependencies` I had shipped myself.
  //
  // C2 SAID THIS AND THE FIX MISSED THE POINT. Its note read: "this originally
  // covered package.json only — which is the same mistake in miniature, a gate
  // aimed at one instance of a class." The remedy applied was to add
  // tsconfig.json to the list. That is an instance fix wearing a class fix's
  // comment, and it left the same hole one file smaller: the population is
  // three, the list was two. Found by re-grepping this file for R1's shape
  // AFTER writing R1's fix three hundred lines below — which is the half of
  // that rule I had to be told twice.
  const present = await ownedJsonIn(siteRoot);
  assert.ok(present.length >= 3, `expected at least 3 JSON files in the site root, saw ${present.length}`);

  const stale = Object.keys(UNSCANNED_JSON).filter((f) => !present.includes(f));
  assert.deepEqual(stale, [], "UNSCANNED_JSON names a file that no longer exists");

  const scanned = present.filter((f) => !(f in UNSCANNED_JSON));
  assert.deepEqual(
    [...scanned, ...Object.keys(UNSCANNED_JSON)].sort(),
    present,
    "the scanned/exempt partition does not cover every JSON file in the site root",
  );

  for (const name of scanned) {
    const raw = await readFile(join(siteRoot, name), "utf8");
    assert.deepEqual(duplicateKeys(raw), [], `${name} declares a key more than once`);
  }
});

test("duplicate-key control: the detector sees a duplicate and accepts a clean manifest", async () => {
  // Positive: the exact shape that shipped in commit 0cb23ba.
  assert.deepEqual(
    duplicateKeys(
      '{\n  "devDependencies": {\n    "typescript": "5.9.3"\n  },\n' +
        '  "devDependencies": {\n    "typescript": "5.9.3"\n  }\n}',
    ),
    ["devDependencies"],
  );
  // …and a duplicate nested one level down is reported by its path.
  assert.deepEqual(
    duplicateKeys('{\n  "scripts": {\n    "test": "a",\n    "test": "b"\n  }\n}'),
    ["scripts.test"],
  );
  // Negative (near miss): the same NAME in two different objects is legitimate
  // and must not fire. This is not hypothetical — "astro" appears in both
  // `dependencies` and `scripts` in the real manifest, and it is what caught my
  // first attempt at this test out.
  assert.deepEqual(
    duplicateKeys(
      '{\n  "scripts": {\n    "astro": "astro"\n  },\n' +
        '  "dependencies": {\n    "astro": "7.2.4"\n  }\n}',
    ),
    [],
  );
  // Negative: a key name repeated across sibling objects INSIDE an array.
  assert.deepEqual(
    duplicateKeys('{\n  "a": [\n    { "n": 1 },\n    { "n": 2 }\n  ]\n}'),
    [],
  );
  // Negative: JSONC comments are skipped, not scanned. tsconfig.json's scope
  // comment contains quotes, colons and braces; a scanner that read it as data
  // would desynchronise and report garbage.
  assert.deepEqual(
    duplicateKeys('{\n  // "a": 1 and "a": 2 in a comment\n  /* "a": 3 */\n  "a": 4\n}'),
    [],
  );
  // …but a real duplicate on either side of a comment is still caught.
  assert.deepEqual(
    duplicateKeys('{\n  "a": 1,\n  // a comment\n  "a": 2\n}'),
    ["a"],
  );
  // And the real files are non-trivial enough for this to mean something.
  const present = await ownedJsonIn(siteRoot);
  const scanned = present.filter((f) => !(f in UNSCANNED_JSON));
  assert.ok(scanned.length >= 2, `only ${scanned.length} JSON file(s) are actually scanned`);
  for (const name of scanned) {
    const raw = await readFile(join(siteRoot, name), "utf8");
    assert.ok(
      raw.split("\n").filter((l) => /^\s*"[^"]+"\s*:/.test(l)).length > 4,
      `${name} has too few keys for the scan to prove anything`,
    );
  }

  // THE EXEMPTION IS PRICED, NOT ASSUMED. package-lock.json is skipped on the
  // argument that npm generates it; if that argument is right the file is also
  // clean, so check it here where the cost is paid once rather than never.
  // An exemption nobody ever tests is indistinguishable from a blind spot.
  for (const name of Object.keys(UNSCANNED_JSON)) {
    assert.ok(UNSCANNED_JSON[name].length > 30, `${name}'s exemption has no stated reason`);
    const raw = await readFile(join(siteRoot, name), "utf8");
    assert.deepEqual(
      duplicateKeys(raw),
      [],
      `${name} is exempt from the gate above, and it turns out to be dirty — the exemption's ` +
        `premise that npm never emits duplicate keys is false`,
    );
  }
});

test("R6: tsconfig.json documents exactly which files the type check covers", async () => {
  // The type check reports 0 errors and covers one source file. That gap is
  // the finding; this test is what stops the documentation of it going stale.
  const raw = await readFile(join(siteRoot, "tsconfig.json"), "utf8");
  const config = await pkg(join(siteRoot, "tsconfig.json"));

  if (config.compilerOptions?.checkJs === true) {
    // Someone widened coverage — good, but then this comment is now wrong.
    assert.ok(
      !raw.includes("NOT CHECKED"),
      "checkJs is now true but tsconfig.json still documents files as unchecked",
    );
    return;
  }

  assert.match(raw, /NOT CHECKED/, "tsconfig.json does not disclose the limit of the type check");
  assert.match(raw, /INERT/, "tsconfig.json does not disclose that the JSDoc typedefs are inert");
  assert.match(raw, /PHASE 5 CANDIDATE/, "widening coverage is not logged for a later phase");

  // Every unchecked source file must be NAMED. A new .mjs added without a line
  // here silently inherits a coverage claim it does not have.
  //
  // Phase 2 widened this in two ways. (a) `scripts/` is scanned as well as
  // `src/`: the live-link checker lives there, is unchecked like the loaders,
  // and would otherwise have been undisclosed by construction. (b) The search
  // is now scoped to the text AFTER the "NOT CHECKED" heading — the Phase 1
  // reviewer's FYI-1, that naming a file under the CHECKED heading also
  // satisfied `raw.includes()`, leaving it in fact unchecked and the test
  // green. Adding a file to this list is the moment that hole matters most, so
  // it is closed here rather than deferred.
  const disclosed = raw.slice(raw.indexOf("NOT CHECKED"));
  const dirs = ["src", "scripts"];
  const sources = [];
  for (const d of dirs) {
    const abs = join(siteRoot, d);
    if (!(await exists(abs))) continue;
    for (const f of await walk(abs)) if (f.endsWith(".mjs")) sources.push(rel(f, siteRoot));
  }
  assert.ok(sources.length >= 6, "the source scan found suspiciously few .mjs files");
  for (const s of sources) {
    assert.ok(disclosed.includes(s), `${s} is not type-checked and tsconfig.json does not say so`);
  }
});

test("type-check disclosure control: the scoped search can actually fail", () => {
  // FYI-1's regression test. The old `raw.includes(name)` was satisfied by a
  // filename appearing ANYWHERE in the file, including under the CHECKED
  // heading — which is the one place that means the opposite of what the test
  // is asserting. Proven on a fixture rather than argued.
  const fixture = [
    "// CHECKED      src/loaders/skills.ts",
    "//              src/zz-new-module.mjs",
    "// NOT CHECKED",
    "//              src/loaders/enumerate.mjs",
  ].join("\n");
  const scoped = fixture.slice(fixture.indexOf("NOT CHECKED"));
  assert.ok(fixture.includes("src/zz-new-module.mjs"), "the fixture is wrong");
  assert.ok(!scoped.includes("src/zz-new-module.mjs"), "the scoped search still cannot fail");
  assert.ok(scoped.includes("src/loaders/enumerate.mjs"), "the scoped search lost a real entry");
});

test("engines.node requires Node 22, and the running Node satisfies it", async () => {
  const manifest = await pkg(join(siteRoot, "package.json"));
  assert.equal(manifest.engines?.node, ">=22.19.0");

  const [major, minor, patch] = process.versions.node.split(".").map(Number);
  const ok =
    major > 22 || (major === 22 && (minor > 19 || (minor === 19 && patch >= 0)));
  assert.ok(
    ok,
    `these tests are running on Node ${process.versions.node}, below the declared floor`,
  );
});

test("the lockfile is present, v3, and agrees with the manifest", async () => {
  const lockPath = join(siteRoot, "package-lock.json");
  assert.ok(await exists(lockPath), "site/package-lock.json is missing — `npm ci` cannot work");
  const lock = await pkg(lockPath);
  assert.equal(lock.lockfileVersion, 3);

  const manifest = await pkg(join(siteRoot, "package.json"));
  assert.deepEqual(
    lock.packages[""].dependencies,
    manifest.dependencies,
    "the lockfile's root dependencies differ from package.json",
  );
  assert.deepEqual(
    lock.packages[""].devDependencies,
    manifest.devDependencies,
    "the lockfile's root devDependencies differ from package.json",
  );
  for (const [name, version] of Object.entries(PINNED)) {
    assert.equal(
      lock.packages[`node_modules/${name}`]?.version,
      version,
      `the lockfile resolves ${name} to something other than ${version}`,
    );
  }
});

test("site/ is self-contained: no npm workspace, one package.json", async () => {
  // Proposal §10.4: the site is a standalone npm project inside the repo, not a
  // workspace member. A workspace would make `cd site && npm ci` depend on
  // files outside site/, which is exactly what acceptance criterion 1 forbids.
  const manifest = await pkg(join(siteRoot, "package.json"));
  assert.equal(manifest.workspaces, undefined, "site/package.json declares workspaces");
  assert.equal(manifest.private, true);

  assert.ok(
    !(await exists(join(repoRoot, "package.json"))),
    "a package.json appeared at the repo root — site/ is no longer self-contained",
  );
  assert.ok(!(await exists(join(repoRoot, "package-lock.json"))));
  assert.ok(!(await exists(join(repoRoot, "pnpm-workspace.yaml"))));
});

test("the build touches nothing outside site/ except the plugin sources it reads", async () => {
  // The loader is pointed at the repo root on purpose (that is where the
  // content lives), so this pins the OTHER direction: no config in site/ writes
  // outside site/.
  const config = await readFile(join(siteRoot, "astro.config.mjs"), "utf8");
  assert.ok(!/outDir\s*:/.test(config), "astro.config.mjs redirects outDir somewhere");
  const tsconfig = await pkg(join(siteRoot, "tsconfig.json"));
  assert.ok(
    !JSON.stringify(tsconfig).includes(".."),
    "tsconfig.json reaches outside site/",
  );
});

test("Phase 2's workflows are the only ones this site added", async () => {
  // This test used to assert the OPPOSITE: Phase 1 built locally only, so a
  // workflow file was out of scope and its absence was the check. Phase 2 adds
  // exactly two, and their contents are gated by tests/workflows.test.mjs.
  //
  // What survives here is the SCOPE half — the site owns two workflow files and
  // no others, and the repository's pre-existing validate.yml is still present.
  // Phase 2's acceptance criterion 6 is that validate.yml still passes and was
  // not modified; its contents are not this suite's to pin (it is not the
  // site's file), but a site change that deleted it would be caught here.
  for (const f of [".github/workflows/docs.yml", ".github/workflows/site-ci.yml"]) {
    assert.ok(await exists(join(repoRoot, f)), `${f} is missing — Phase 2 adds it`);
  }
  assert.ok(
    await exists(join(repoRoot, ".github/workflows/validate.yml")),
    "the repository's existing validate.yml has gone missing",
  );
  // Exactly two workflows may build the site. Scoped to the site's own concern
  // deliberately: the repository is free to add workflows of its own without
  // this suite failing, but a THIRD place that builds site/ would mean the
  // build is configured in more than one file and they will drift.
  const { readdir } = await import("node:fs/promises");
  const dir = join(repoRoot, ".github/workflows");
  const builders = [];
  for (const f of await readdir(dir)) {
    const text = await readFile(join(dir, f), "utf8");
    if (/working-directory:\s*site\b/.test(text)) builders.push(f);
  }
  assert.deepEqual(
    builders.sort(),
    ["docs.yml", "site-ci.yml"],
    "the site build is configured in a workflow this suite does not know about",
  );
});

// ── the mirrored-constant class ─────────────────────────────────────────────
//
// Gap 2 residue. Sweep 2 was scoped to PREDICATES, so mirrored CONSTANTS were
// out of scope by construction, and F9 was one instance of what that boundary
// hid: `DEFAULT_URL` was a fourth hand-written copy of the deployed URL whose
// ORIGIN component had no artifact-mediated path back to `src/site.config.mjs`.
// Its base component already had one, transitively through the test helper —
// established by mutating each component separately, one at a time. Moving both
// at once reads as coupled, because the coupled half's red masks the uncoupled
// half. See tests/live-links.test.mjs for the four readings.
//
// Closing an instance is not closing a class. This is the class: NO PRODUCTION
// FILE MAY CARRY A SECOND COPY OF A SITE CONSTANT. It found one that no review
// named — `astro.config.mjs` hard-coded the repository URL while importing
// `BASE` and `SITE` from the very file that exports `REPO_URL` two lines below
// them.
//
// TESTS ARE DELIBERATELY EXEMPT, and the exemption is the point rather than a
// carve-out for convenience: a test that imports the site's own constant to
// build its expected value cannot catch the site changing that constant. It
// asserts `x === x`. `tests/_helpers.mjs` says so at its own BASE and ORIGIN,
// and `live-links.test.mjs`'s DEFAULT_URL test says so again — those literals
// are the suite's INDEPENDENT copies and they must stay literals. So the rule
// is directional: production code single-sources, test code deliberately does
// not, and the drift between them is what makes the comparison mean anything.
//
// COMMENTS are exempt too. A doc comment showing `--url
// https://ghchinoy.github.io/agent-skills/` as a usage example is documentation
// of a value, not a second definition of it; stripping it would make the
// example wrong.
// ROUND 3, R1 — BOTH DENOMINATORS ARE NOW DERIVED, AND THEY WERE BOTH
// HAND-WRITTEN BEFORE. This test states a universally quantified rule and used
// to quantify over `walk(src/**)` plus two files named individually, against a
// constant list spelled `["SITE", "BASE", "REPO_URL"]`. So it was an instance
// list wearing a class title — the exact defect it was written to close,
// occurring inside the gate that closes it. Third time this round; see the
// review's four-step reproduction, which shipped a fourth hard-coded copy of the
// deployed URL past a green suite by putting it in `scripts/`.
//
// FILES: `src/`, `scripts/` and the site root are all walked. `scripts/` was the
// hole — one test in this very file already walked `["src", "scripts"]` for the
// type-coverage disclosure, so the tree knew the shape and this test did not use
// it. The root is walked because `astro.config.mjs` lives there and was the
// fourth copy the first sweep found; naming it individually would leave the next
// root-level config uncovered for the same reason.
//
// CONSTANTS: derived from `site.config.mjs`'s string exports by scanning for
// them, so adding a fourth export cannot silently widen the blind spot. What the
// scanner cannot cover goes in EXEMPT_CONSTANTS **with a reason**, and the
// partition is asserted EXHAUSTIVE — every string export is scanned or exempted,
// never neither. That is standard 5a, which came out of the README case: an
// audit must state a denominator, and the mechanism must be able to notice when
// the denominator is short. Naming REPO_REF as uncovered in prose was correct
// and insufficient, because prose depends on the next person remembering.
const EXEMPT_CONSTANTS = {
  REPO_REF: 'the value is "main" — too short and too common to scan for without ' +
    "flooding the report with false positives from ordinary prose and code",
};

/** Every `export const NAME = "literal"` in site.config.mjs, as name/value. */
function stringExportsIn(config) {
  const out = [];
  for (const m of config.matchAll(/^export const ([A-Z0-9_]+) = "([^"]*)"/gm)) {
    out.push({ name: m[1], value: m[2] });
  }
  return out;
}

test("no production file carries a second copy of a site constant", async () => {
  const config = await readFile(join(siteRoot, "src/site.config.mjs"), "utf8");
  const exported = stringExportsIn(config);

  // The denominator reports on itself. If site.config.mjs stops exporting
  // strings, or this scan stops finding them, the gate says so instead of
  // passing over an empty set — the "gate that cannot fire" shape one level up.
  assert.ok(
    exported.length >= 4,
    `site.config.mjs string exports: found ${exported.length}, expected at least 4 — ` +
      "the constant scan has stopped finding them and this gate is now vacuous",
  );

  // EXHAUSTIVE PARTITION. Every string export is either scanned or exempted with
  // a reason. A new export lands here, loudly, on the day it is added.
  const scanned = exported.filter((c) => !(c.name in EXEMPT_CONSTANTS));
  const exemptNames = Object.keys(EXEMPT_CONSTANTS);
  assert.deepEqual(
    exemptNames.filter((n) => !exported.some((c) => c.name === n)),
    [],
    "EXEMPT_CONSTANTS names a constant site.config.mjs no longer exports — " +
      "delete the exemption rather than leaving it to cover nothing",
  );
  assert.deepEqual(
    exported.map((c) => c.name).sort(),
    [...scanned.map((c) => c.name), ...exemptNames].sort(),
    "a site.config.mjs string export is neither scanned nor exempted",
  );

  // Nothing shorter than this is worth matching: "/agent-skills" appears inside
  // the repo URL, so the longest values have to be checked first and the
  // matched span removed, or every REPO_URL hit double-counts as a BASE hit.
  scanned.sort((a, b) => b.value.length - a.value.length);

  const files = [];
  for (const d of ["src", "scripts"]) {
    const abs = join(siteRoot, d);
    if (!(await exists(abs))) continue;
    for (const f of await walk(abs)) if (f.endsWith(".mjs") || f.endsWith(".js")) files.push(f);
  }
  for (const ent of await readdir(siteRoot, { withFileTypes: true })) {
    if (ent.isFile() && (ent.name.endsWith(".mjs") || ent.name.endsWith(".js"))) {
      files.push(join(siteRoot, ent.name));
    }
  }

  // The file denominator reports on itself too, for the same reason.
  assert.ok(
    files.length >= 8,
    `the production-file scan found ${files.length} files, expected at least 8`,
  );

  const offenders = [];
  for (const abs of files) {
    if (abs.endsWith("site.config.mjs")) continue; // the source itself
    offenders.push(...copiesIn(await readFile(abs, "utf8"), rel(abs, siteRoot), scanned));
  }
  assert.deepEqual(
    offenders,
    [],
    "a site constant is written twice in production code — import it from " +
      "src/site.config.mjs instead:\n  " + offenders.join("\n  "),
  );
});

test("CONTROL: the mirrored-constant detector can actually fire", () => {
  const constants = [
    { name: "REPO_URL", value: "https://github.com/ghchinoy/agent-skills" },
    { name: "BASE", value: "/agent-skills" },
  ].sort((a, b) => b.value.length - a.value.length);

  // The exact defect this test was written after: a literal where an import
  // belongs.
  assert.deepEqual(
    copiesIn('href: "https://github.com/ghchinoy/agent-skills",', "x.mjs", constants),
    ["x.mjs:1 REPO_URL"],
  );
  // …and the same value one line lower, so a detector that only reads line 1
  // is not what is passing.
  assert.deepEqual(
    copiesIn('\n\nconst b = "/agent-skills";', "x.mjs", constants),
    ["x.mjs:3 BASE"],
  );
  // The ordering guard: REPO_URL contains BASE as a substring. If the longest
  // value were not stripped first this would report BASE as well, and a real
  // BASE copy would then be indistinguishable from a REPO_URL copy.
  assert.deepEqual(
    copiesIn('const r = "https://github.com/ghchinoy/agent-skills";', "x.mjs", constants),
    ["x.mjs:1 REPO_URL"],
  );

  // THE DEFECT THE FIRST VERSION OF THIS DETECTOR HAD. `https://` contains
  // `//`; a line-oriented stripper cuts here and the constant vanishes. Two of
  // the three constants are URLs, so that version could not fire on either.
  assert.deepEqual(
    copiesIn('const r = "https://github.com/ghchinoy/agent-skills"; // note', "x.mjs", constants),
    ["x.mjs:1 REPO_URL"],
  );

  // NEGATIVE HALF. Each of these is a shape the codebase legitimately contains,
  // and a detector that flagged any of them would be reverted within a day —
  // which is a slower and more expensive way of not having a gate.
  assert.deepEqual(copiesIn('import { BASE } from "./src/site.config.mjs";', "x.mjs", constants), []);
  assert.deepEqual(copiesIn("// see https://github.com/ghchinoy/agent-skills", "x.mjs", constants), []);
  assert.deepEqual(copiesIn("/*\n * base is /agent-skills here\n */", "x.mjs", constants), []);
  assert.deepEqual(copiesIn("const s = BASE + \"/pagefind/\";", "x.mjs", constants), []);
});

// R1's control, and it is the REVIEWER'S OWN REPRODUCTION rather than a case I
// chose. The finding was that `scripts/` was not walked, so a fourth hard-coded
// copy of the deployed URL could ship green from there. Both halves are asserted
// — the file set now REACHES scripts/ and the site root, and it reaches them for
// a `.mjs` that does not exist yet, because a scan that only covers today's
// files is the instance list again.
test("CONTROL: the file scan reaches scripts/ and the site root, not a named list", async () => {
  const config = await readFile(join(siteRoot, "src/site.config.mjs"), "utf8");
  const scanned = stringExportsIn(config)
    .filter((c) => !(c.name in EXEMPT_CONSTANTS))
    .sort((a, b) => b.value.length - a.value.length);

  // The exact content of the review's step 1, at the path it used. It reports
  // TWO constants, not one, and that is correct rather than a false positive:
  // the deployed URL is `SITE + BASE + "/"`, so a hand-written copy of it
  // mirrors both. I expected one, the detector said two, and the detector was
  // right — recorded because the assertion was corrected to match the code here,
  // which is the direction standard 10 usually forbids. It is allowed in this
  // instance because the code is demonstrably right and the expectation was
  // arithmetic I got wrong, not a claim weakened to fit.
  const planted = 'const target = "https://ghchinoy.github.io/agent-skills/";\n';
  assert.deepEqual(
    copiesIn(planted, "scripts/publish-preview.mjs", scanned),
    ["scripts/publish-preview.mjs:1 SITE", "scripts/publish-preview.mjs:1 BASE"],
    "the detector cannot see the review's planted copy at all",
  );

  // …and the enumeration would have handed it that file. Asserted on the
  // ENUMERATION rather than by writing into the tree, so the control leaves no
  // artefact behind and cannot pass because a fixture was forgotten.
  const dirs = new Set();
  for (const d of ["src", "scripts"]) {
    const abs = join(siteRoot, d);
    if (!(await exists(abs))) continue;
    for (const f of await walk(abs)) if (f.endsWith(".mjs")) dirs.add(rel(f, siteRoot).split("/")[0]);
  }
  for (const ent of await readdir(siteRoot, { withFileTypes: true })) {
    if (ent.isFile() && ent.name.endsWith(".mjs")) dirs.add(".");
  }
  assert.deepEqual(
    [...dirs].sort(),
    [".", "scripts", "src"],
    "the production-file scan no longer covers all three roots",
  );
});

// The OTHER denominator, which the review raised as structural rather than
// demonstrated: the constant list was hand-written, so a fourth string export
// was silently uncovered. This proves the derivation actually derives.
test("CONTROL: the constant list is derived, and an unknown export is not silently dropped", () => {
  const real = stringExportsIn(
    'export const SITE = "https://ghchinoy.github.io";\n' +
      'export const BASE = "/agent-skills";\n' +
      'export const REPO_REF = "main";\n',
  );
  assert.deepEqual(real, [
    { name: "SITE", value: "https://ghchinoy.github.io" },
    { name: "BASE", value: "/agent-skills" },
    { name: "REPO_REF", value: "main" },
  ]);

  // A NEW export the exemption list has never heard of must land in `scanned`,
  // not vanish. This is the case the hand-written list got wrong by construction.
  const withNew = stringExportsIn('export const CDN_ORIGIN = "https://cdn.example.test";\n');
  assert.deepEqual(
    withNew.filter((c) => !(c.name in EXEMPT_CONSTANTS)).map((c) => c.name),
    ["CDN_ORIGIN"],
  );

  // Non-string exports are not string exports. PHASE_1_PLUGINS is an array and
  // must not be picked up as a literal to scan for.
  assert.deepEqual(stringExportsIn('export const PHASE_1_PLUGINS = ["okf-authoring"];\n'), []);

  // And the exemption reasons are real text, not empty strings standing in for
  // a decision nobody made.
  for (const [name, why] of Object.entries(EXEMPT_CONSTANTS)) {
    assert.ok(why.length > 30, `EXEMPT_CONSTANTS.${name} has no stated reason`);
  }
});

/**
 * Every line of `text` outside a comment that contains a constant's literal
 * value.
 *
 * THE COMMENT STRIPPER IS QUOTE-AWARE, AND THE FIRST VERSION WAS NOT. It cut
 * each line at the first `//`, which is inside `https://` for two of the three
 * constants — so the detector could never have fired on SITE or REPO_URL. It
 * would have passed on the day it was written, passed forever after, and been
 * indistinguishable from a working gate. The control below caught it before it
 * was committed, which is the entire argument for writing the control first.
 *
 * So this walks the line character by character, tracking whether it is inside
 * a single-quoted, double-quoted or template string, and only treats `//` and
 * `/*` as comment openers OUTSIDE one. Escapes are honoured. Template
 * interpolation is not parsed — a `${...}` containing a quote could confuse it
 * — and that residue is left deliberately rather than papered over, because the
 * failure direction is a missed offender, and the constants at issue are never
 * written as interpolations.
 *
 * @param {string} text
 * @param {string} label
 * @param {{name: string, value: string}[]} constants longest value FIRST
 * @returns {string[]}
 */
function copiesIn(text, label, constants) {
  const out = [];
  let inBlock = false;
  text.split("\n").forEach((raw, i) => {
    let code = "";
    let quote = null;
    for (let j = 0; j < raw.length; j += 1) {
      const c = raw[j];
      if (inBlock) {
        if (c === "*" && raw[j + 1] === "/") { inBlock = false; j += 1; }
        continue;
      }
      if (quote) {
        code += c;
        if (c === "\\") { code += raw[j + 1] ?? ""; j += 1; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") { quote = c; code += c; continue; }
      if (c === "/" && raw[j + 1] === "/") return record(code);
      if (c === "/" && raw[j + 1] === "*") { inBlock = true; j += 1; continue; }
      code += c;
    }
    record(code);

    function record(line) {
      for (const { name, value } of constants) {
        if (!line.includes(value)) continue;
        line = line.split(value).join(""); // strip so shorter values do not re-hit
        out.push(`${label}:${i + 1} ${name}`);
      }
    }
  });
  return out;
}
