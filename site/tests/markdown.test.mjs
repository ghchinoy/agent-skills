// markdown.test.mjs — the two body transformations, pinned at the unit level
// with positive AND negative controls.
//
// The negatives are the important half. "The H1 strip works" is easy; what has
// to be proven is that it does NOT fire on the things it must leave alone —
// I7's headings inside fenced code, I2's body with no H1 at all, and D4's
// link-shaped text inside a code span.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  firstH1,
  isProtected,
  protectedRanges,
  rewriteLinks,
  stripLeadingH1,
} from "../src/loaders/markdown.mjs";
import { repoRoot } from "./_helpers.mjs";

const OKF_AUTHOR = join(repoRoot, "plugins/okf-authoring/skills/okf-author/SKILL.md");

test("stripLeadingH1: POSITIVE — a leading H1 goes", () => {
  const r = stripLeadingH1("# Title\n\nbody\n");
  assert.equal(r.stripped, "Title");
  assert.equal(r.body, "body\n");
  assert.equal(r.removed, 2);
});

test("stripLeadingH1: NEGATIVE — a body with no H1 is untouched (I2)", () => {
  // grill-with-beads/SKILL.md is the real instance; this is its shape.
  const src = "Some opening prose.\n\n## A subheading\n";
  const r = stripLeadingH1(src);
  assert.equal(r.stripped, null);
  assert.equal(r.body, src);
  assert.equal(r.removed, 0);
});

test("stripLeadingH1: NEGATIVE — an H1 inside a leading fence is untouched (I7)", () => {
  const src = "```markdown\n# Concepts\n```\n\nafter\n";
  const r = stripLeadingH1(src);
  assert.equal(r.stripped, null);
  assert.equal(r.body, src);
});

test("stripLeadingH1: NEGATIVE — only the FIRST heading is a candidate", () => {
  const src = "opening prose\n\n# Not leading\n";
  assert.equal(stripLeadingH1(src).stripped, null);
});

test("stripLeadingH1: NEGATIVE — an H2 is not an H1", () => {
  assert.equal(stripLeadingH1("## Two\n\nbody\n").stripped, null);
});

test("protectedRanges: fenced blocks and inline code spans are protected", () => {
  const src = [
    "prose `code span` prose",   // line 1
    "```",                        // 2
    "# Concepts",                 // 3
    "```",                        // 4
    "tail",                       // 5
  ].join("\n");
  const ranges = protectedRanges(src);
  assert.ok(isProtected(ranges, src.indexOf("code span")), "code span not protected");
  assert.ok(!isProtected(ranges, src.indexOf("prose")), "plain prose wrongly protected");
  assert.ok(isProtected(ranges, src.indexOf("# Concepts")), "fenced heading not protected");
  assert.ok(!isProtected(ranges, src.indexOf("tail")), "text after the fence wrongly protected");
});

test("protectedRanges: an INDENTED closing fence closes (R5)", () => {
  // The defect: the closing check sliced past the BACKTICK RUN instead of the
  // whole match, so the up-to-three spaces of indent CommonMark allows left
  // the tail of the fence in `after`, `after` was never "", and the fence
  // stayed open to end of file. Both shipped SKILL.md files hit this, because
  // both put a fenced block inside a list item, which indents it.
  for (const indent of ["", " ", "  ", "   "]) {
    const src = ["intro", `${indent}\`\`\``, `${indent}code`, `${indent}\`\`\``, "tail"].join("\n");
    const ranges = protectedRanges(src);
    assert.ok(isProtected(ranges, src.indexOf("code")), `[indent ${indent.length}] fenced body`);
    assert.ok(
      !isProtected(ranges, src.lastIndexOf("tail")),
      `[indent ${indent.length}] an indented closing fence did not close — ` +
        `everything after it is wrongly exempt from link processing`,
    );
  }
  // Same for tildes, and for a closer longer than its opener (CommonMark
  // allows that; shorter is not a closer).
  const tilde = ["  ~~~", "  code", "  ~~~~", "tail"].join("\n");
  assert.ok(!isProtected(protectedRanges(tilde), tilde.lastIndexOf("tail")));
});

test("protectedRanges: R5 control — an UNCLOSED fence still protects to EOF", () => {
  // Without this, "return false from closesFence always" would pass the test
  // above. A fence that genuinely never closes must still swallow the rest of
  // the document — that is what CommonMark says and what I7 relies on.
  const src = ["intro", "  ```", "  code", "tail — still inside"].join("\n");
  const ranges = protectedRanges(src);
  assert.ok(isProtected(ranges, src.indexOf("tail — still inside")));
  // And a closer with an INFO STRING is not a closer.
  const info = ["```", "code", "```js", "tail — still inside"].join("\n");
  assert.ok(isProtected(protectedRanges(info), info.indexOf("tail — still inside")));
  // …nor is a run of the wrong character, or a shorter run.
  const wrong = ["````", "code", "```", "tail — still inside"].join("\n");
  assert.ok(isProtected(protectedRanges(wrong), wrong.indexOf("tail — still inside")));
});

test("protectedRanges: real data — every fence in both shipped SKILL.md files closes", async () => {
  // The unit cases above use synthetic input. This one asserts the property on
  // the actual files the defect was live in: after the last fence, the tail of
  // each document must be ordinary prose. A synthetic-only test would have
  // been satisfied by a fixture nobody ships.
  for (const name of ["okf-author", "okf-validate"]) {
    const raw = await readFile(
      join(repoRoot, `plugins/okf-authoring/skills/${name}/SKILL.md`),
      "utf8",
    );
    const ranges = protectedRanges(raw);
    const lastNonBlank = raw.trimEnd();
    assert.ok(
      !isProtected(ranges, lastNonBlank.length - 1),
      `${name}/SKILL.md ends inside an unclosed fence — an indented closing ` +
        `fence is being missed, so link processing is disabled for the tail ` +
        `of the file and D3 advisories there will never be reported`,
    );
    // Both files DO contain indented fences; if that ever stops being true the
    // assertion above gets weaker without saying so.
    assert.match(raw, /\n {1,3}(`{3,}|~{3,})/, `${name}/SKILL.md no longer has an indented fence`);
  }
});

test("firstH1 is fence-aware and returns the source bytes verbatim", () => {
  assert.equal(firstH1("```\n# Fenced\n```\n\n# Real — with an em dash\n"), "Real — with an em dash");
  assert.equal(firstH1("no heading here\n"), null);
});

test("firstH1 uses the same fence scanner as protectedRanges (R5 generalisation)", () => {
  // There were two fence implementations in markdown.mjs and they disagreed.
  // `protectedRanges` had the indent bug; `firstH1` had a different one — it
  // closed on any long-enough run of the same character, info string or not,
  // so "```js" inside a block ended it early. Both now call one function.
  // An indented closing fence must close here too:
  assert.equal(firstH1("  ```\n  # Fenced\n  ```\n\n# Real\n"), "Real");
  // …and an info-string line must NOT close, so the heading after it is still
  // inside code and there is no H1 at all:
  assert.equal(firstH1("```\n# Fenced\n```js\n# Also fenced\n"), null);
});

// ── Link rewriting ──────────────────────────────────────────────────────────

/** A resolver that just marks what it was asked to resolve. */
const mark = (t) => `REWRITTEN(${t})`;

test("rewriteLinks: POSITIVE — an ordinary inline link is rewritten", () => {
  const { body } = rewriteLinks("see [x](references/a.md) here\n", mark);
  assert.match(body, /\[x\]\(REWRITTEN\(references\/a\.md\)\)/);
});

test("rewriteLinks: POSITIVE — a code-span LABEL does not block its own link", () => {
  // This is the exact shape at okf-author/SKILL.md:25. Skipping on "the match
  // overlaps a protected range" would wrongly leave it alone; the rule is on
  // the TARGET's offset.
  const src = "- [`../../references/x.md`](../../references/x.md)\n";
  const { body } = rewriteLinks(src, mark);
  assert.match(body, /\[`\.\.\/\.\.\/references\/x\.md`\]\(REWRITTEN\(\.\.\/\.\.\/references\/x\.md\)\)/);
});

test("rewriteLinks: NEGATIVE — link syntax INSIDE a code span is untouched (D4)", () => {
  // okf-v0.2-spec-summary.md:93 documents OKF's own link form inside a code
  // span. Rewriting it would corrupt an example of the format.
  const src = "bundle-relative — `[customers](/tables/customers.md)`. Stable.\n";
  const { body, rewrites } = rewriteLinks(src, () => {
    throw new Error("resolver must not be called for text inside a code span");
  });
  assert.equal(body, src);
  assert.deepEqual(rewrites, []);
});

test("rewriteLinks: NEGATIVE — links inside a fenced block are untouched", () => {
  const src = "```markdown\n* [Customer Orders](/tables/orders.md) - one row\n```\n";
  const { body } = rewriteLinks(src, () => {
    throw new Error("resolver must not be called inside a fence");
  });
  assert.equal(body, src);
});

test("rewriteLinks: line numbers are SOURCE-FILE lines, not buffer lines", () => {
  const seen = [];
  rewriteLinks("a\nb\n[x](y)\n", (t, at) => (seen.push(at.line), t), { lineOffset: 12 });
  assert.deepEqual(seen, [15]);
});

test("rewriteLinks: images are flagged as images", () => {
  const seen = [];
  rewriteLinks("![alt](assets/p.webp)\n[a](assets/p.webp)\n", (t, at) => (seen.push(at.isImage), t));
  assert.deepEqual(seen, [true, false]);
});

test("real data: exactly the six link targets outside code in okf-author/SKILL.md", async () => {
  // Computed from the real file by this test, independently of the loader:
  // whatever the resolver is handed IS the set of things the site will rewrite.
  const raw = await readFile(OKF_AUTHOR, "utf8");
  const body = raw.replace(/^---\n[\s\S]*?\n---\n/, "");
  const seen = [];
  rewriteLinks(body, (t, at) => (seen.push(`${at.line}:${t}`), t), { lineOffset: 7 });
  assert.deepEqual(seen, [
    "20:#cli-is-opportunistic-never-required",
    "25:../../references/okf-v0.2-spec-summary.md",
    "29:../../references/trust-vocabulary.md",
    "33:assets/example-bundle/",
    "127:../../references/trust-vocabulary.md",
    "155:../okf-validate/SKILL.md",
  ]);
  // The three D3 links the acceptance criteria name, at the lines they name.
  assert.ok(seen.includes("25:../../references/okf-v0.2-spec-summary.md"));
  assert.ok(seen.includes("29:../../references/trust-vocabulary.md"));
  assert.ok(seen.includes("127:../../references/trust-vocabulary.md"));
  // And NOT the bundle-relative examples inside the fences at lines 73 and 103.
  assert.ok(
    !seen.some((s) => s.includes("/tables/orders.md") || s.includes("/tables/customers.md")),
    "a link inside a fenced example was handed to the rewriter",
  );
});
