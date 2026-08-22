// enumeration.test.mjs — ACCEPTANCE CRITERION 4, and the reason the loader is
// written the way it is.
//
// Agent Plugins §7.1: "Each immediate child directory containing a path named
// exactly `SKILL.md` that resolves to a regular file is treated as one skill.
// Clients MUST NOT recursively search deeper descendants for additional
// skills."
//
// A test that only checked the OUTPUT (five pages, none from example-bundle)
// would pass equally well for a glob-plus-excludes implementation, which is
// exactly the design the standard rules out. So this suite watches the
// loader's filesystem calls instead: it injects a recording `fs` facade and
// asserts on where the loader LOOKED, not just on what it returned.
//
// Every assertion here has a NEGATIVE CONTROL — a deliberately recursive
// enumerator, defined in this file, run against the same recorder — because a
// detector nobody has proven can fire is not a gate.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { MANIFEST_FIELDS, enumerate } from "../src/loaders/enumerate.mjs";
import { PLUGIN, repoRoot } from "./_helpers.mjs";

/**
 * Writes a minimal but valid fixture repo and returns its root. `plugin` is
 * merged into the plugin.json, `refs` is a map of references/ filename to
 * contents.
 */
async function fixture(prefix, { plugin = {}, refs = {} } = {}) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(root, ".claude-plugin"), { recursive: true });
  await writeFile(
    join(root, ".claude-plugin", "marketplace.json"),
    JSON.stringify({ name: "f", plugins: [{ name: "p", source: "./plugins/p", skills: [] }] }),
  );
  await mkdir(join(root, "plugins", "p"), { recursive: true });
  await writeFile(
    join(root, "plugins", "p", "plugin.json"),
    JSON.stringify({ name: "p", description: "d", ...plugin }, null, 2),
  );
  const names = Object.keys(refs);
  if (names.length > 0) {
    await mkdir(join(root, "plugins", "p", "references"), { recursive: true });
    for (const name of names) {
      await writeFile(join(root, "plugins", "p", "references", name), refs[name]);
    }
  }
  return root;
}

/** An `fs` facade that records every path it is asked about. */
function recorder(root) {
  const calls = [];
  const note = (op, p) => calls.push({ op, path: relative(root, p).split("\\").join("/") });
  return {
    calls,
    fs: {
      readFile: (p, enc) => (note("readFile", p), readFile(p, enc)),
      readdir: (p, o) => (note("readdir", p), readdir(p, o)),
      stat: (p) => (note("stat", p), stat(p)),
    },
  };
}

// ── The detectors. Each returns the offending call paths, or []. ────────────

/** Any SKILL.md probed at a depth the standard forbids. */
function skillProbesBelowDepthOne(calls) {
  return calls
    .filter((c) => /(^|\/)SKILL\.md$/.test(c.path))
    .filter((c) => !/^plugins\/[^/]+\/skills\/[^/]+\/SKILL\.md$/.test(c.path))
    .map((c) => `${c.op} ${c.path}`);
}

/**
 * Any touch inside the example-bundle teaching asset (I5) OTHER THAN listing
 * its names.
 *
 * NARROWED IN PHASE 4 UNDER EM RULING (Option A). It previously asserted zero
 * calls of ANY op whose path contained `example-bundle`. AC1 requires every
 * asset file to appear on its owning skill page by real filename and names a
 * depth-2 file explicitly, which cannot be done without a `readdir` inside an
 * asset subtree.
 *
 * WHAT THE OLD FORM PROTECTED, AND WHERE THAT PROTECTION LIVES NOW. It was a
 * PROXY for two invariants, neither of which moved:
 *   - bundle bytes are never read  -> `assetFileReads()` below, which is
 *     STRICTER than the clause replaced here because it covers every asset
 *     tree rather than this one directory.
 *   - no bundle file becomes a page -> the witness-string leak detector in
 *     tests/content.test.mjs.
 * Both were given fresh planted negative controls in Phase 4; neither is
 * inherited from Phase 3's green.
 *
 * Only NAME LISTING is newly permitted. A `readFile` or a `stat` inside the
 * bundle is still caught here, unchanged.
 */
function exampleBundleTouches(calls) {
  return calls
    .filter((c) => c.path.includes("example-bundle"))
    .filter((c) => c.op !== "readdir")
    .map((c) => `${c.op} ${c.path}`);
}

/**
 * Any directory read outside the shape the design allows.
 *
 * NARROWED IN PHASE 4 UNDER EM RULING (Option A): one pattern was ADDED, the
 * last one, permitting descent at any depth below a skill's `assets/`. The
 * other three are unchanged.
 *
 * WHAT SURVIVES. Descent under `references/`, under `scripts/`, under
 * `skills/<s>/` itself, or anywhere else in the tree still trips this gate.
 * The class "no unexpected descent" is intact; the single instance "no descent
 * under assets/" is deliberately given up, because AC1 names a depth-2 asset
 * file as required output.
 *
 * WHY ONLY `assets/`. A `references/*.md` is ROUTED to a page by slug, and a
 * nested reference has no route this design defines — descending there would
 * silently produce a route collision or a dropped file rather than an error.
 * Assets are never routed, so depth is harmless. Scripts are flat today and
 * widening a gate where nothing needs it buys nothing; the consequence is that
 * a future nested file under `scripts/` would be missed by the inventory and
 * would not trip anything, which is recorded as an accepted hole in the Phase
 * 4 boundary ledger rather than left for a reader to find.
 */
function readdirsOutsideAllowedShape(calls) {
  const ALLOWED = [
    /^plugins\/[^/]+\/skills$/,
    /^plugins\/[^/]+\/references$/,
    /^plugins\/[^/]+\/skills\/[^/]+\/(references|scripts|assets)$/,
    /^plugins\/[^/]+\/skills\/[^/]+\/assets\/.+$/,
  ];
  return calls
    .filter((c) => c.op === "readdir")
    .filter((c) => !ALLOWED.some((re) => re.test(c.path)))
    .map((c) => c.path);
}

/** Any file opened from inside an assets/ tree. Filenames are listed; bytes are not read. */
function assetFileReads(calls) {
  return calls
    .filter((c) => c.op === "readFile" && /(^|\/)assets\//.test(c.path))
    .map((c) => c.path);
}

test("AC4: enumeration reads marketplace.json and skills/'s immediate children only", async () => {
  const { fs, calls } = recorder(repoRoot);
  const { plugins } = await enumerate({ repoRoot, fs, onlyPlugins: [PLUGIN] });

  // It read the distribution index for membership and ordering …
  assert.ok(
    calls.some((c) => c.op === "readFile" && c.path === ".claude-plugin/marketplace.json"),
    "the loader never read .claude-plugin/marketplace.json",
  );
  // … and plugin.json for the canonical description (I1).
  assert.ok(
    calls.some((c) => c.op === "readFile" && c.path === `plugins/${PLUGIN}/plugin.json`),
    "the loader never read plugin.json",
  );

  // The SKILL.md probes it made, verbatim. Exactly two, both at depth 1.
  const probes = calls.filter((c) => /(^|\/)SKILL\.md$/.test(c.path)).map((c) => c.path);
  assert.deepEqual(probes.sort(), [
    `plugins/${PLUGIN}/skills/okf-author/SKILL.md`,
    `plugins/${PLUGIN}/skills/okf-validate/SKILL.md`,
  ]);

  assert.deepEqual(skillProbesBelowDepthOne(calls), []);
  assert.deepEqual(exampleBundleTouches(calls), []);
  assert.deepEqual(readdirsOutsideAllowedShape(calls), []);
  assert.deepEqual(assetFileReads(calls), []);

  assert.deepEqual(
    plugins[0].skills.map((s) => s.name),
    ["okf-author", "okf-validate"],
    "skills must be in marketplace.json's declared order",
  );
});

test("AC4 control: a RECURSIVE enumerator fires every detector above", async () => {
  // The negative control. If this walker did not trip the detectors, the
  // assertions in the previous test would be vacuous — they would pass for a
  // loader that recursed too.
  const { fs, calls } = recorder(repoRoot);

  async function recursiveWalk(dir) {
    let ents;
    try {
      ents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await recursiveWalk(p);
      else if (e.name.endsWith(".md")) await fs.readFile(p, "utf8");
    }
  }
  await recursiveWalk(join(repoRoot, "plugins", PLUGIN));

  assert.notDeepEqual(
    exampleBundleTouches(calls),
    [],
    "the example-bundle detector cannot fire — it is not a gate",
  );
  assert.notDeepEqual(
    readdirsOutsideAllowedShape(calls),
    [],
    "the readdir-shape detector cannot fire — it is not a gate",
  );
  assert.notDeepEqual(
    assetFileReads(calls),
    [],
    "the asset-read detector cannot fire — it is not a gate",
  );
  // And the naive `**/*.md` glob really does reach the trap §3.5 describes.
  assert.ok(
    calls.some(
      (c) =>
        c.op === "readFile" &&
        c.path.endsWith("assets/example-bundle/references/skills/run-on-bq.md"),
    ),
    "the glob trap file was not reached by the recursive walker",
  );
});

test("AC4 control: a nested SKILL.md is INVISIBLE to enumerate and VISIBLE to a recursive glob", async () => {
  // The sharpest form of the criterion, on a fixture built for it: a SKILL.md
  // two levels below skills/ is a "deeper descendant" the standard says clients
  // MUST NOT find. Both halves are asserted, so the first is not vacuous.
  const root = await mkdtemp(join(tmpdir(), "skills-ac4-"));
  try {
    await mkdir(join(root, ".claude-plugin"), { recursive: true });
    await writeFile(
      join(root, ".claude-plugin", "marketplace.json"),
      JSON.stringify({
        name: "fixture",
        plugins: [
          {
            name: "p",
            source: "./plugins/p",
            skills: ["./plugins/p/skills/real"],
          },
        ],
      }),
    );
    await mkdir(join(root, "plugins", "p", "skills", "real"), { recursive: true });
    await writeFile(join(root, "plugins", "p", "plugin.json"), JSON.stringify({ name: "p", description: "d" }));
    await writeFile(join(root, "plugins", "p", "skills", "real", "SKILL.md"), "---\nname: real\ndescription: d\n---\n# t\n");
    // The trap: a SKILL.md at skills/real/nested/SKILL.md.
    await mkdir(join(root, "plugins", "p", "skills", "real", "nested"), { recursive: true });
    await writeFile(
      join(root, "plugins", "p", "skills", "real", "nested", "SKILL.md"),
      "---\nname: nested\ndescription: d\n---\n# t\n",
    );

    const { fs, calls } = recorder(root);
    const { plugins } = await enumerate({ repoRoot: root, fs, onlyPlugins: ["p"] });

    assert.deepEqual(
      plugins[0].skills.map((s) => s.name),
      ["real"],
      "enumerate() found a skill below skills/<skill>/ — it recursed",
    );
    assert.deepEqual(
      calls.filter((c) => c.path.includes("nested")).map((c) => `${c.op} ${c.path}`),
      [],
      "enumerate() even LOOKED inside skills/real/nested/",
    );

    // Positive control: a recursive glob finds the nested one, so the fixture
    // genuinely contains a trap and the assertion above is not vacuous.
    const found = [];
    async function globSkillMd(dir) {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) await globSkillMd(p);
        else if (e.name === "SKILL.md") found.push(relative(root, p).split("\\").join("/"));
      }
    }
    await globSkillMd(join(root, "plugins", "p", "skills"));
    assert.deepEqual(found.sort(), [
      "plugins/p/skills/real/SKILL.md",
      "plugins/p/skills/real/nested/SKILL.md",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a directory named SKILL.md is not a skill; a stray file in skills/ is not a skill", async () => {
  const root = await mkdtemp(join(tmpdir(), "skills-ac4b-"));
  try {
    await mkdir(join(root, ".claude-plugin"), { recursive: true });
    await writeFile(
      join(root, ".claude-plugin", "marketplace.json"),
      JSON.stringify({ name: "f", plugins: [{ name: "p", source: "./plugins/p", skills: [] }] }),
    );
    await mkdir(join(root, "plugins", "p", "skills", "fake", "SKILL.md"), { recursive: true });
    await writeFile(join(root, "plugins", "p", "plugin.json"), JSON.stringify({ name: "p", description: "d" }));
    await writeFile(join(root, "plugins", "p", "skills", "README.md"), "not a skill");
    await mkdir(join(root, "plugins", "p", "skills", "empty"), { recursive: true });

    const { fs } = recorder(root);
    const { plugins } = await enumerate({ repoRoot: root, fs, onlyPlugins: ["p"] });
    assert.deepEqual(plugins[0].skills.map((s) => s.name), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the resource inventory distinguishes 'no such directory' from 'empty directory'", async () => {
  // `null` vs `[]`. okf-author HAS assets/ and has NO scripts/, so the two
  // shapes are both exercised by real data. Shipping `[]` for a directory the
  // build never checked would be a claim it did not earn.
  const { fs } = recorder(repoRoot);
  const { plugins } = await enumerate({ repoRoot, fs, onlyPlugins: [PLUGIN] });
  const author = plugins[0].skills.find((s) => s.name === "okf-author");
  assert.equal(author.resources.scripts, null, "okf-author has no scripts/ — expected null");
  assert.equal(author.resources.references, null, "okf-author has no skill-level references/ — expected null");
  // RE-PINNED IN PHASE 4 UNDER EM RULING (Option A), as a consequence of the
  // ruling and not to silence a red. It previously pinned
  //   ["README.md:file", "example-bundle:directory"]
  // — the depth-1 shape, one file and one DIRECTORY entry. The inventory now
  // lists every asset file at every depth, named relative to `assets/`, and
  // emits no bare directory rows, because every file inside one is listed
  // individually and a directory row would be a second, coarser claim about
  // the same bytes.
  //
  // The old message asserted the bundle held eleven markdown files. It holds
  // eight, of nine files. That figure is DELETED rather than corrected: it was
  // an unbound literal restating what the assertion below already derives, and
  // Phase 3's ruling on such duplicates is deletion, not refresh.
  assert.deepEqual(
    author.resources.assets.map((a) => `${a.name}:${a.kind}`),
    [
      "README.md:file",
      "example-bundle/computations/revenue.md:file",
      "example-bundle/index.md:file",
      "example-bundle/log.md:file",
      "example-bundle/metrics/revenue.md:file",
      "example-bundle/references/attesters/revenue.py:file",
      "example-bundle/references/skills/run-on-bq.md:file",
      "example-bundle/tables/customers.md:file",
      "example-bundle/tables/index.md:file",
      "example-bundle/tables/orders.md:file",
    ],
    "assets/ is inventoried at every depth, by path relative to assets/, files only",
  );
});

// ── N1: ordering is by code unit, everywhere ────────────────────────────────
//
// Collation is ICU- and locale-dependent. A locale difference between a
// developer's machine and CI would silently reorder RENDERED output — the
// plugin page's References block is built from the list below. The repo's one
// references/ directory happens to hold two all-lowercase filenames, where
// both orderings agree, which is how a `localeCompare` survived here through a
// whole phase and a two-build byte comparison. This fixture removes that luck.

test("N1: plugin-level references sort in code-unit order, not by locale collation", async () => {
  const root = await fixture("skills-n1-", {
    refs: {
      "README.md": "# R\n",
      "Zeta.md": "# Z\n",
      "alpha.md": "# a\n",
      "ähnlich.md": "# ae\n",
    },
  });
  try {
    const { fs } = recorder(root);
    const { plugins } = await enumerate({ repoRoot: root, fs, onlyPlugins: ["p"] });
    const got = plugins[0].references.map((r) => r.name);

    // Uppercase sorts before lowercase, and a non-ASCII letter sorts after
    // both, because that is what comparing UTF-16 code units does.
    assert.deepEqual(got, ["README.md", "Zeta.md", "alpha.md", "ähnlich.md"]);

    // POSITIVE CONTROL — the fixture genuinely discriminates. If localeCompare
    // and code-unit order agreed on these names (as they do on the repo's real
    // two), the assertion above would pass for the buggy implementation too.
    const byLocale = [...got].sort((a, b) => a.localeCompare(b));
    assert.notDeepEqual(
      byLocale,
      got,
      "the fixture filenames do not distinguish the two orderings — it proves nothing",
    );
    assert.deepEqual(byLocale, ["ähnlich.md", "alpha.md", "README.md", "Zeta.md"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ── N3: report and ignore unknown plugin.json keys ──────────────────────────
//
// Agent Plugins §5.2 requires clients to REPORT AND IGNORE unknown manifest
// fields. SKILL.md frontmatter got exactly this treatment from the start via
// `analyzeDeclared()`; the manifest was `z.record(z.any())` and got only the
// "ignore" half — silently, and only because no template happened to iterate
// it.

test("N3: an unknown top-level plugin.json key is advised, with a line, and dropped", async () => {
  const root = await fixture("skills-n3-", {
    plugin: { category: "data", tags: ["a", "b"], keywords: ["real"] },
  });
  try {
    const { fs } = recorder(root);
    const { plugins, advisories } = await enumerate({ repoRoot: root, fs, onlyPlugins: ["p"] });

    const unknown = advisories.filter((a) => a.code === "UNKNOWN-FIELD");
    assert.deepEqual(
      unknown.map((a) => a.file),
      ["plugins/p/plugin.json", "plugins/p/plugin.json"],
    );
    assert.match(unknown[0].message, /unknown top-level plugin\.json key "category"/);
    assert.match(unknown[1].message, /unknown top-level plugin\.json key "tags"/);
    // An advisory names a line the reader can open (§6.5).
    assert.deepEqual(unknown.map((a) => a.line), [4, 5]);

    // IGNORE: the key is not in the object any template can reach.
    assert.deepEqual(
      Object.keys(plugins[0].manifest).sort(),
      ["description", "keywords", "name"],
      "an unknown manifest key survived into the rendered data",
    );

    // NEGATIVE CONTROL — the same run kept every KNOWN key it was given, so
    // the detector is an allowlist and not a "drop everything".
    assert.deepEqual(plugins[0].manifest.keywords, ["real"]);
    assert.equal(plugins[0].manifest.description, "d");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("N3 control: the real plugin.json declares only known keys, and the vocabulary is the spec's ten", async () => {
  // The other direction: with no unknown key present, no advisory fires — so
  // the ten advisories this build reports are not padded by a false one.
  const { fs } = recorder(repoRoot);
  const { plugins, advisories } = await enumerate({ repoRoot, fs, onlyPlugins: [PLUGIN] });
  assert.deepEqual(
    advisories.filter((a) => a.code === "UNKNOWN-FIELD"),
    [],
    `${PLUGIN}/plugin.json now declares an unknown key`,
  );

  // Read independently of the loader, and checked against the closed list.
  const raw = JSON.parse(
    await readFile(join(repoRoot, "plugins", PLUGIN, "plugin.json"), "utf8"),
  );
  assert.deepEqual(
    Object.keys(raw).filter((k) => !MANIFEST_FIELDS.includes(k)),
    [],
  );
  // Nothing was dropped from the real manifest.
  assert.deepEqual(Object.keys(plugins[0].manifest), Object.keys(raw));
  assert.deepEqual(MANIFEST_FIELDS, [
    "$schema",
    "name",
    "version",
    "description",
    "author",
    "homepage",
    "repository",
    "license",
    "keywords",
    "extensions",
  ]);
});
