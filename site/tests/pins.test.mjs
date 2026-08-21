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

import { repoRoot, siteRoot } from "./_helpers.mjs";

const PINNED = {
  astro: "7.2.4",
  "@astrojs/starlight": "0.41.7",
  "@astrojs/check": "0.9.10",
  typescript: "5.9.3",
};

const pkg = async (p) => JSON.parse(await readFile(p, "utf8"));
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
 */
function duplicateKeys(text) {
  const dupes = [];
  const stack = [];
  let last = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
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

test("package.json declares no key twice", async () => {
  // JSON.parse takes the LAST of two duplicated keys and reports nothing, so a
  // manifest can carry a stale block that every tool silently ignores and every
  // reader has to guess about. `astro check` caught exactly this shape in
  // skills.ts (ts(2783)); nothing type-checks JSON, so this does. The first
  // thing it found was a duplicated `devDependencies` I had shipped myself.
  const raw = await readFile(join(siteRoot, "package.json"), "utf8");
  assert.deepEqual(duplicateKeys(raw), [], "package.json declares a key more than once");
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
  // And the real manifest is non-trivial enough for this to mean something.
  const raw = await readFile(join(siteRoot, "package.json"), "utf8");
  assert.ok(raw.split("\n").filter((l) => /"[^"]+"\s*:/.test(l)).length > 15);
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

test("no GitHub Actions workflow was added by this phase", async () => {
  // Phase 1 builds LOCALLY ONLY. A workflow file here would be out of scope and
  // would deploy something nobody has reviewed. Phase 2 adds them.
  const forbidden = [".github/workflows/docs.yml", ".github/workflows/site-ci.yml"];
  for (const f of forbidden) {
    assert.ok(!(await exists(join(repoRoot, f))), `${f} exists — Phase 1 must not add workflows`);
  }
  // …and the repo's own pre-existing workflow is untouched, which the git diff
  // in the PR also shows. This checks it is at least still there.
  assert.ok(
    await exists(join(repoRoot, ".github/workflows/validate.yml")),
    "the repository's existing validate.yml has gone missing",
  );
});
