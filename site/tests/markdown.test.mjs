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

test("firstH1 is fence-aware and returns the source bytes verbatim", () => {
  assert.equal(firstH1("```\n# Fenced\n```\n\n# Real — with an em dash\n"), "Real — with an em dash");
  assert.equal(firstH1("no heading here\n"), null);
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
  rewriteLinks(body, (t, at) => (seen.push(`${at.line}:${t}`), t), { lineOffset: 9 });
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
