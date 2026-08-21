// link-rules.test.mjs — unit tests for the §6.5 resolver in
// src/loaders/links.mjs.
//
// links.test.mjs checks the OUTPUT: that nothing in dist/ dangles. That is a
// necessary gate and not a sufficient one, because it only sees the link
// shapes this repository happens to contain today. §6.5 states a rule about
// behaviour — "a rewrite that finds no target is a hard build error naming
// file, line and target — never a silent pass-through" — and a rule about
// behaviour needs a test that calls the function.
//
// This file exists because of N2. Site-absolute targets used to be returned
// untouched. The reviewer injected `[x](/tables/customers.md)` and
// `[y](/totally-made-up/)` into a SKILL.md: the build succeeded, no advisory
// was raised, and both dead hrefs reached dist/. The dist sweep caught them
// afterwards, so the site was never going to ship them — but as a test, not as
// the build error the spec asks for, and anything consuming this loader
// without the suite got nothing at all.

import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveTarget } from "../src/loaders/links.mjs";

const BASE = "/agent-skills";

/** A context standing in for okf-author, with its real routed neighbours. */
function ctx(overrides = {}) {
  const notes = [];
  return {
    notes,
    ctx: {
      kind: "skill",
      base: BASE,
      blobBase: "https://github.com/o/r/blob/main",
      treeBase: "https://github.com/o/r/tree/main",
      plugin: "okf-authoring",
      skill: "okf-author",
      pluginRepoPath: "plugins/okf-authoring",
      routedPluginRefs: new Set(["trust-vocabulary", "okf-v0.2-spec-summary"]),
      routedSkillRefs: new Set(),
      routedSkills: new Set(["okf-author", "okf-validate"]),
      resources: { references: null, scripts: null, assets: [{ name: "README.md", kind: "file" }] },
      sourceRepoPath: "plugins/okf-authoring/skills/okf-author/SKILL.md",
      note: (n) => notes.push(n),
      ...overrides,
    },
  };
}

const at = (line = 42) => ({ line, isImage: false });

// ── N2 ──────────────────────────────────────────────────────────────────────

test("N2: a site-absolute target is a hard build error, not a silent pass-through", () => {
  // The two targets the reviewer injected, verbatim.
  for (const target of ["/tables/customers.md", "/totally-made-up/"]) {
    const { ctx: c, notes } = ctx();
    assert.throws(
      () => resolveTarget(target, at(17), c),
      (err) => {
        // §6.5: the error names file, line and target.
        assert.match(err.message, /plugins\/okf-authoring\/skills\/okf-author\/SKILL\.md:17/);
        assert.ok(err.message.includes(target), "the error does not name the target");
        assert.match(err.message, /site-absolute/);
        return true;
      },
      `"${target}" did not raise a build error`,
    );
    // …and it did not quietly downgrade itself to an advisory either.
    assert.deepEqual(notes, []);
  }
});

test("N2: even a site-absolute target that LOOKS like a real route is refused", () => {
  // The tempting special case: a hand-written link to a page this build really
  // does produce. Refused anyway, and the message says what to write instead.
  // A SKILL.md is a portable directory; a leading "/" in it names the
  // filesystem root, and the skill cannot know a deployed site's base path.
  const { ctx: c } = ctx();
  assert.throws(
    () => resolveTarget(`${BASE}/plugins/okf-authoring/okf-validate/`, at(3), c),
    /site-absolute link targets are not resolvable/,
  );
});

test("N2 control: the shapes §6.5 DOES define still resolve, silently and correctly", () => {
  // The negative control, and a near miss in the sense that matters here: each
  // of these begins one character away from the rejected shape, or reaches the
  // same destination by a legitimate route. If the change above had been
  // written as "throw on anything containing a slash", every one of these
  // would fail.
  const cases = [
    // A relative path to the very page the previous test refused absolutely.
    ["../okf-validate/SKILL.md", `${BASE}/plugins/okf-authoring/okf-validate/`, "D3"],
    ["../../references/trust-vocabulary.md", `${BASE}/plugins/okf-authoring/references/trust-vocabulary/`, "D3"],
    ["assets/README.md", "https://github.com/o/r/blob/main/plugins/okf-authoring/skills/okf-author/assets/README.md", null],
  ];
  for (const [target, want, code] of cases) {
    const { ctx: c, notes } = ctx();
    assert.equal(resolveTarget(target, at(), c), want, `${target} resolved wrongly`);
    assert.deepEqual(notes.map((n) => n.code), code ? [code] : [], `${target}: wrong advisories`);
  }

  // External and in-page targets are untouched, including protocol-relative
  // and anchor-only ones — none of these is a site-absolute path.
  for (const target of ["https://example.org/x", "mailto:a@b.c", "#a-heading"]) {
    const { ctx: c } = ctx();
    assert.equal(resolveTarget(target, at(), c), target);
  }
});

test("N2 control: the error path is reachable for the OTHER unresolvable shapes too", () => {
  // Proving the site-absolute branch throws is only interesting if throwing is
  // still reserved for things that genuinely do not resolve.
  const { ctx: c } = ctx();
  assert.throws(() => resolveTarget("references/nope.md", at(), c), /has no entry named "nope\.md"/);
  assert.throws(() => resolveTarget("../okf-nonexistent/SKILL.md", at(), c), /no routed page for sibling skill/);
  assert.throws(() => resolveTarget("", at(), c), /empty target/);
  assert.throws(() => resolveTarget("some-loose-file.md", at(), c), /no §6\.5 rule matches/);
});
