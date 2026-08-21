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

import { enumerate } from "../src/loaders/enumerate.mjs";
import { PLUGIN, repoRoot } from "./_helpers.mjs";

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

/** Any touch at all inside the example-bundle teaching asset (I5). */
function exampleBundleTouches(calls) {
  return calls.filter((c) => c.path.includes("example-bundle")).map((c) => `${c.op} ${c.path}`);
}

/** Any directory read deeper than the depth-1 inventory the design allows. */
function readdirsOutsideAllowedShape(calls) {
  const ALLOWED = [
    /^plugins\/[^/]+\/skills$/,
    /^plugins\/[^/]+\/references$/,
    /^plugins\/[^/]+\/skills\/[^/]+\/(references|scripts|assets)$/,
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
  assert.deepEqual(
    author.resources.assets.map((a) => `${a.name}:${a.kind}`),
    ["README.md:file", "example-bundle:directory"],
    "assets/ must be inventoried at depth 1: one file and one DIRECTORY, never 11 pages",
  );
});
