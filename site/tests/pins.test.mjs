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
    for (const f of await walk(abs)) {
      if (UNCHECKED_BY_ASTRO_CHECK.includes(extensionOf(f))) sources.push(rel(f, siteRoot));
    }
  }
  assert.deepEqual(
    UNCHECKED_BY_ASTRO_CHECK.sort(),
    [".js", ".mjs"],
    "the unchecked-extension complement has drifted — SCANNED_EXTENSIONS or " +
      "CHECKED_BY_ASTRO_CHECK changed and this disclosure test's population moved with it",
  );
  assert.ok(sources.length >= 6, "the source scan found suspiciously few unchecked sources");
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
//
// ROUND 4, R2 — THE THIRD DENOMINATOR WAS STILL HAND-WRITTEN, AND IT WAS THE ONE
// I DID NOT LOOK AT. Round 3 derived the file set over DIRECTORIES and the
// constant set over EXPORTS, then bounded the files by a bare `.endsWith(".mjs")
// || .endsWith(".js")` — a hand-written extension list with no exemption entry,
// no reason and no control, sitting inside the commit whose whole subject was
// removing hand-written bounds. The review demonstrated it: `src/mut10.ts` and
// `src/mut10.astro`, each carrying a mirrored constant, left the suite at exactly
// baseline. Reproduced here before accepting it, and it is exactly right.
//
// The asymmetry IS the finding. One dimension of the same fix got an exhaustive
// partition, priced exemptions and a staleness check; the other got a bare
// string comparison. That is what an incomplete class fix looks like from the
// inside: the dimension you are thinking about gets the discipline, and the one
// you are merely using does not.
//
// THE RULE IS NOW A PROPERTY, NOT A LIST: a file is scanned if the language it
// is written in CAN IMPORT the constant. If it can import and it copies instead,
// that is the defect. If it cannot import, a literal is the only thing the author
// could have written, so it is exempt — and the exemption is MEASURED below
// rather than assumed, because an exemption nobody tests is a blind spot.
const SCANNED_EXTENSIONS = [".mjs", ".js", ".ts", ".astro"];

const EXEMPT_EXTENSIONS = {
  ".json": "JSON has no import mechanism, so a URL in a manifest cannot be " +
    "expressed as a reference to site.config.mjs — the literal is the only option",
  ".md": "prose documentation, where quoting the deployed URL is the point rather " +
    "than a defect; a reader cannot resolve an import",
  ".css": "CSS cannot import a JavaScript binding, so a URL in a stylesheet has no " +
    "in-language fix and would be a finding about the design rather than the file",
};

/**
 * Files in an exempt extension that DO carry a copy, each with the reason it is
 * allowed to. Asserted to be exactly the set found on disk, so a new copy in a
 * non-importing file reds this test and has to be argued for rather than
 * inherited. Same shape as the package-lock exemption above: the exclusion is
 * priced every run, not granted once.
 */
const DOCUMENTED_COPIES = {
  "README.md": "the site README quotes the deployed URL and the repository URL as " +
    "documentation; both are for a human to read and neither is consumed by code",
};

/**
 * Extensions `astro check` DOES see. `checkJs` is false, so it reads the TypeScript
 * and the Astro component scripts and nothing else — verified, not assumed, by the
 * planted-annotation experiment recorded in tsconfig.json's scope comment.
 */
const CHECKED_BY_ASTRO_CHECK = [".ts", ".astro"];

/**
 * Extensions `astro check` cannot see, DERIVED as the complement rather than
 * written out a second time.
 *
 * The review counted three populations and two definitions. Making this the
 * complement of the scan population means there is now ONE hand-written source of
 * extensions in this file, and the second population falls out of it. Add `.tsx`
 * to SCANNED_EXTENSIONS and it becomes type-check-unchecked automatically unless
 * someone also declares it checked — which is the direction that fails safe.
 *
 * The divergence between the two lists is real and is the reason they are two:
 * `.ts` and `.astro` ARE type-checked, so they belong in the constant scan and
 * must never appear in tsconfig's NOT CHECKED disclosure. Two lists that differ
 * for a stated reason are fine; two that differ because nobody noticed are R2.
 */
const UNCHECKED_BY_ASTRO_CHECK = SCANNED_EXTENSIONS.filter(
  (e) => !CHECKED_BY_ASTRO_CHECK.includes(e),
);

/** Is this file read by the mirrored-constant scan? */
const isScannedSource = (name) => SCANNED_EXTENSIONS.includes(extensionOf(name));

/** The extension of a file NAME, or "" for a dotfile or an extensionless file. */
function extensionOf(name) {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i) : "";
}

const EXEMPT_CONSTANTS = {
  REPO_REF: 'the value is "main" — too short and too common to scan for without ' +
    "flooding the report with false positives from ordinary prose and code",
};

/**
 * COMPONENTS OF A CONSTANT, DERIVED — not a list of the ones I happened to think
 * of.
 *
 * F9's lesson, and `ecf68e8` is the precedent: a mirrored constant can be coupled
 * in one component and uncoupled in another, and grading the whole value hides
 * the uncoupled half. `REPO_URL` is never copied whole; its `owner/repo`
 * component was, in an install command rendered on every skill page.
 *
 * MY FIRST VERSION OF THIS WAS A HAND-WRITTEN INCLUSION LIST holding exactly the
 * one component the review had already found. That is R2's own defect at one more
 * level up — deriving the population and then hand-bounding it — and it failed
 * criterion (d) of the symmetry check in the brief. Caught by running that check
 * against my own diff before pushing, which is the deliverable that matters more
 * than the filter.
 *
 * Deriving instead of listing also ADDED coverage: the rule yields SITE's host,
 * which the hand list did not contain and which nothing else scans for.
 */
const COMPONENT_MIN_LENGTH = 12;

/**
 * Components dropped for being too short to scan without flooding the report,
 * each with a MEASURED reason rather than a predicted one.
 */
const SHORT_COMPONENTS = {
  "REPO_URL host":
    'the value is "github.com" at 10 characters. Measured rather than assumed, per ' +
    "17b: it occurs 4 times in scanned files — three are JSDoc placeholder examples " +
    '("https://github.com/o/r/blob/main", "https://github.com/<owner>/<repo>") and ' +
    "the fourth is inside REPO_URL itself. Zero real instances are hidden by this.",
};

/** Every scannable component of every URL-valued constant, by the rule above. */
function componentsOf(constants) {
  const all = [];
  for (const { name, value } of constants) {
    let u;
    try {
      u = new URL(value);
    } catch {
      continue; // BASE is a path fragment, not a URL — it has no components
    }
    all.push({ name: `${name} host`, value: u.host });
    const slug = u.pathname.replace(/^\/|\/$/g, "");
    if (slug) all.push({ name: `${name} owner/repo`, value: slug });
  }
  return all;
}

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

  // COMPONENTS, not just whole values — F9's lesson applied to the scan itself,
  // derived from the exports and partitioned exhaustively by the length rule.
  const candidates = componentsOf(scanned);
  assert.ok(candidates.length >= 2, `component derivation produced ${candidates.length}, expected 2+`);
  const components = candidates.filter((c) => c.value.length >= COMPONENT_MIN_LENGTH);
  const dropped = candidates.filter((c) => c.value.length < COMPONENT_MIN_LENGTH);
  assert.deepEqual(
    dropped.map((c) => c.name).sort(),
    Object.keys(SHORT_COMPONENTS).sort(),
    "a constant component is below the scan threshold and is not declared in " +
      "SHORT_COMPONENTS with a measured reason for dropping it",
  );
  for (const [name, reason] of Object.entries(SHORT_COMPONENTS)) {
    assert.ok(reason.length > 30, `${name} is dropped with no stated reason`);
  }
  for (const c of components) {
    const source = scanned.find((e) => c.name.startsWith(`${e.name} `));
    assert.ok(source && source.value.includes(c.value), `${c.name} is not a component of its constant`);
  }

  // Nothing shorter than this is worth matching: "/agent-skills" appears inside
  // the repo URL, so the longest values have to be checked first and the
  // matched span removed, or every REPO_URL hit double-counts as a BASE hit.
  const needles = [...scanned, ...components].sort((a, b) => b.value.length - a.value.length);

  // THE FILE POPULATION, over every file in the walked roots, partitioned by
  // extension rather than filtered by one. `seen` is what is actually on disk;
  // nothing may fall outside the partition unclassified.
  const all = [];
  for (const d of ["src", "scripts"]) {
    const abs = join(siteRoot, d);
    if (!(await exists(abs))) continue;
    for (const f of await walk(abs)) all.push(f);
  }
  for (const ent of await readdir(siteRoot, { withFileTypes: true })) {
    if (ent.isFile()) all.push(join(siteRoot, ent.name));
  }

  const seen = [...new Set(all.map((f) => extensionOf(f.split("/").pop())))]
    .filter((e) => e !== "")
    .sort();
  const classified = [...SCANNED_EXTENSIONS, ...Object.keys(EXEMPT_EXTENSIONS)].sort();
  assert.deepEqual(
    seen.filter((e) => !classified.includes(e)),
    [],
    `an extension in the walked roots is neither scanned nor exempted: ${seen.join(" ")} — ` +
      "add it to SCANNED_EXTENSIONS, or to EXEMPT_EXTENSIONS with a reason",
  );
  for (const [ext, reason] of Object.entries(EXEMPT_EXTENSIONS)) {
    assert.ok(reason.length > 30, `${ext} is exempt with no stated reason`);
  }
  assert.ok(
    SCANNED_EXTENSIONS.every((e) => !(e in EXEMPT_EXTENSIONS)),
    "an extension is both scanned and exempted",
  );

  const files = all.filter((f) => isScannedSource(f.split("/").pop()));
  assert.ok(
    files.length >= 8,
    `the production-file scan found ${files.length} files, expected at least 8`,
  );
  // The scan must reach the languages R2 was demonstrated on, not merely enough
  // files to look busy.
  for (const ext of [".ts", ".astro"]) {
    assert.ok(
      files.some((f) => f.endsWith(ext)),
      `the scan reaches no ${ext} file — R2's demonstration would pass again`,
    );
  }

  const offenders = [];
  for (const abs of files) {
    if (abs.endsWith("site.config.mjs")) continue; // the source itself
    offenders.push(...copiesIn(await readFile(abs, "utf8"), rel(abs, siteRoot), needles));
  }
  assert.deepEqual(
    offenders,
    [],
    "a site constant is written twice in production code — import it from " +
      "src/site.config.mjs instead:\n  " + offenders.join("\n  "),
  );

  // THE EXEMPTION IS PRICED. Files that cannot import are still READ; they are
  // just allowed to carry a copy, and only the ones named here. A new literal in
  // a manifest or a stylesheet reds this and has to be argued for.
  const exemptFiles = all.filter((f) => extensionOf(f.split("/").pop()) in EXEMPT_EXTENSIONS);
  const carrying = [];
  for (const abs of exemptFiles) {
    if (abs.endsWith("package-lock.json")) continue; // npm's, not ours; see UNSCANNED_JSON
    if (plainCopiesIn(await readFile(abs, "utf8"), rel(abs, siteRoot), needles).length > 0) {
      carrying.push(rel(abs, siteRoot));
    }
  }
  assert.deepEqual(
    carrying.sort(),
    Object.keys(DOCUMENTED_COPIES).sort(),
    "a file that cannot import a constant carries a copy of one, and it is not in " +
      "DOCUMENTED_COPIES — decide whether it is documentation or a defect",
  );
  for (const [f, reason] of Object.entries(DOCUMENTED_COPIES)) {
    assert.ok(reason.length > 30, `${f}'s documented copy has no stated reason`);
  }
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
    for (const f of await walk(abs)) if (isScannedSource(f)) dirs.add(rel(f, siteRoot).split("/")[0]);
  }
  for (const ent of await readdir(siteRoot, { withFileTypes: true })) {
    if (ent.isFile() && isScannedSource(ent.name)) dirs.add(".");
  }
  assert.deepEqual(
    [...dirs].sort(),
    [".", "scripts", "src"],
    "the production-file scan no longer covers all three roots",
  );
});

// R2's control. The finding was that the file population was derived over
// DIRECTORIES and then hand-bounded by EXTENSION — a filter with no exemption
// entry, no reason and no control, inside the commit whose subject was removing
// hand-written bounds. Three dimensions, each asserted here.
test("CONTROL: the extension bound is a partition, and it reaches .ts and .astro", async () => {
  // ONE — the languages R2 was demonstrated on are actually scanned. Asserted on
  // the predicate, so it holds for a file that does not exist yet.
  for (const f of ["mut10.ts", "EntryMeta.astro", "x.mjs", "y.js"]) {
    assert.ok(isScannedSource(f), `${f} is not read by the constant scan`);
  }
  for (const f of ["a.json", "b.md", "c.css"]) {
    assert.ok(!isScannedSource(f), `${f} is scanned by an instrument that cannot be right for it`);
  }

  // TWO — the partition is exhaustive over what is PRESENT, so a language nobody
  // anticipated cannot slip through by not being mentioned. `.tsx` is not in
  // either list; if it appeared in src/ the real test reds until classified.
  const classified = [...SCANNED_EXTENSIONS, ...Object.keys(EXEMPT_EXTENSIONS)];
  assert.ok(!classified.includes(".tsx"), "the .tsx case is no longer unclassified — pick another");
  assert.deepEqual(
    SCANNED_EXTENSIONS.filter((e) => e in EXEMPT_EXTENSIONS),
    [],
    "an extension is both scanned and exempted",
  );
  for (const [ext, reason] of Object.entries(EXEMPT_EXTENSIONS)) {
    assert.ok(reason.length > 30, `${ext} is exempt without a reason`);
  }

  // THREE — the detector fires on the review's exact planted content, at the
  // exact paths it used, for both languages.
  const constants = stringExportsIn(await readFile(join(siteRoot, "src/site.config.mjs"), "utf8"))
    .filter((c) => !(c.name in EXEMPT_CONSTANTS))
    .sort((a, b) => b.value.length - a.value.length);
  assert.deepEqual(
    copiesIn('export const t = "https://ghchinoy.github.io/agent-skills/";\n', "src/mut10.ts", constants),
    ["src/mut10.ts:1 SITE", "src/mut10.ts:1 BASE"],
  );
  assert.deepEqual(
    copiesIn('const r = "https://github.com/ghchinoy/agent-skills";\n', "src/mut10.astro", constants),
    ["src/mut10.astro:1 REPO_URL"],
  );
});

// The COMPONENT dimension, which is the one with a live instance behind it.
test("CONTROL: a component of a constant is graded separately from the whole", async () => {
  const exported = stringExportsIn(await readFile(join(siteRoot, "src/site.config.mjs"), "utf8"));
  const repoUrl = exported.find((c) => c.name === "REPO_URL");
  const derived = componentsOf([repoUrl]);
  const slug = derived.find((c) => c.name === "REPO_URL owner/repo").value;
  assert.equal(slug, "ghchinoy/agent-skills");

  // The derivation is a RULE, so it also yields the component the hand list did
  // not contain. Asserted here so a regression to a list is visible.
  assert.deepEqual(derived.map((c) => c.name).sort(), ["REPO_URL host", "REPO_URL owner/repo"]);

  // The literal that shipped, at the line it shipped on. A WHOLE-VALUE scan sees
  // nothing here — that is the point, and it is F9's shape exactly: the copy is
  // of a component, so grading the whole reads clean.
  const shipped = 'installCommand: `npx skills add ghchinoy/agent-skills --skill ${d.name}`,\n';
  assert.deepEqual(
    copiesIn(shipped, "src/loaders/skills.ts", [repoUrl]),
    [],
    "the whole-value scan can see the component copy — then this control proves nothing",
  );
  assert.deepEqual(
    copiesIn(shipped, "src/loaders/skills.ts", [{ name: "REPO_URL owner/repo", value: slug }]),
    ["src/loaders/skills.ts:1 REPO_URL owner/repo"],
    "the component scan cannot see the copy that actually shipped",
  );

  // And the fix is coupled rather than merely correct: the derived form contains
  // no literal for the component scan to find.
  const fixed = "installCommand: `npx skills add ${repoSlug} --skill ${d.name}`,\n";
  assert.deepEqual(copiesIn(fixed, "src/loaders/skills.ts", [{ name: "REPO_URL owner/repo", value: slug }]), []);
});

// The instrument finding, kept as a test because it produced a clean report from
// a dirty file and that is the failure direction nobody investigates.
test("CONTROL: the plain scanner does not treat a URL as a comment", () => {
  const constants = [{ name: "SITE", value: "https://ghchinoy.github.io" }];
  const markdown = "The site is published at <https://ghchinoy.github.io/agent-skills/>.";

  // copiesIn is JavaScript-aware: `//` starts a comment, so it discards the rest
  // of the line — including the URL. Correct for .mjs, catastrophic for .md.
  assert.deepEqual(
    copiesIn(markdown, "README.md", constants),
    [],
    "copiesIn no longer truncates at // — re-examine whether plainCopiesIn is still needed",
  );
  assert.deepEqual(
    plainCopiesIn(markdown, "README.md", constants),
    ["README.md:1 SITE"],
    "the plain scanner cannot see a URL in prose either",
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
/**
 * The same scan WITHOUT JavaScript comment handling, for files that are not
 * JavaScript.
 *
 * Found by using the wrong one: `copiesIn` treats `//` as the start of a comment
 * and discards the rest of the line, which in a Markdown file means every line
 * containing an `https://` URL outside a string literal is silently truncated to
 * nothing. The priced-exemption check below reported ZERO copies in README.md
 * while `grep` reported two. The instrument was wrong, not the file — and it was
 * wrong in the direction that produces a clean report, which is the direction
 * nobody investigates. Recorded rather than quietly patched, because "the scanner
 * returned empty" and "there is nothing there" are the same output.
 */
function plainCopiesIn(text, label, constants) {
  const out = [];
  text.split("\n").forEach((raw, i) => {
    let line = raw;
    for (const { name, value } of constants) {
      if (!line.includes(value)) continue;
      line = line.split(value).join("");
      out.push(`${label}:${i + 1} ${name}`);
    }
  });
  return out;
}

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
