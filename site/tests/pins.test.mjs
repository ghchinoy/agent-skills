// pins.test.mjs — the build's own preconditions.
//
// Proposal §10.4 pins the toolchain exactly, because "it built on my machine in
// August" is not a property a repo can rely on. These tests fail if a range
// creeps back in, if the lockfile drifts from the manifest, or if the site
// quietly becomes an npm workspace of the parent repo.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
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

/** Every JSON/JSONC file this site owns. C2: the scanner covered one of them. */
const OWNED_JSON = ["package.json", "tsconfig.json"];

test("no JSON file this site owns declares a key twice", async () => {
  // JSON.parse takes the LAST of two duplicated keys and reports nothing, so a
  // config can carry a stale block that every tool silently ignores and every
  // reader has to guess about. `astro check` caught exactly this shape in
  // skills.ts (ts(2783)); nothing type-checks JSON, so this does. The first
  // thing it found was a duplicated `devDependencies` I had shipped myself.
  //
  // C2: this originally covered package.json only — which is the same mistake
  // in miniature, a gate aimed at one instance of a class.
  for (const name of OWNED_JSON) {
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
  for (const name of OWNED_JSON) {
    const raw = await readFile(join(siteRoot, name), "utf8");
    assert.ok(
      raw.split("\n").filter((l) => /^\s*"[^"]+"\s*:/.test(l)).length > 4,
      `${name} has too few keys for the scan to prove anything`,
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
