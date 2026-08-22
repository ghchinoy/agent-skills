// site-pages.test.mjs — acceptance criteria 9 and 10, and the counts §11 bans
// anyone from typing.
//
// Five pages are ABOUT the catalog rather than in it. Three of them LIFT bytes
// from a repository document; two are site-authored. The difference is the
// subject of this file, because the two halves fail in opposite directions:
//
//   a LIFT fails by drifting        — the README changes and the page does not
//   an AUTHORED page fails by growing — a pointer becomes a paraphrase, and a
//                                       paraphrase of a requirement is a second
//                                       and worse copy of the requirement
//
// AC9 is the first: /about/install/ reproduces the README's installers verbatim
// and in README order. Verbatim is checked line by line against the README's
// own bytes, not by looking for a few remembered strings.
//
// AC10 is the second: /about/standards/ links the two standards, states the
// catalog is skills-only with zero MCP servers, and restates no normative text.
// "Restates no normative text" is a judgement and the criterion says so —
// reviewed by a human, with a length ceiling as the automatable proxy. The
// ceiling is here, priced, with the measurement next to it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  SITE_ROUTES,
  decodeEntities,
  distContentPages,
  fieldRows,
  mainOf,
  pageAt,
  repoRoot,
  sourceRoutes,
  toText,
} from "./_helpers.mjs";

/**
 * The `## <heading>` section of a repository document, as lines.
 *
 * Re-implemented here rather than imported from site-pages.mjs. The page is
 * built by that module's extraction; if this file used the same one, "the page
 * reproduces the README" would mean "the extraction agrees with itself".
 */
async function readmeSection(heading) {
  const lines = (await readFile(join(repoRoot, "README.md"), "utf8")).split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  assert.notEqual(start, -1, `README.md has no "## ${heading}" section — this model is stale`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^## \S/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end);
}

/** `{ headings, commands }` of the README's install section, in document order. */
async function readmeInstallers() {
  const lines = await readmeSection("Installation & Usage");
  const headings = [];
  const commands = [];
  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      if (line.trim() !== "") commands.push(line);
      continue;
    }
    const h = /^###\s+(.+?)\s*$/.exec(line);
    if (h) headings.push(h[1]);
  }
  assert.ok(headings.length > 0, "the README's install section has no ### sub-headings");
  assert.ok(commands.length > 0, "the README's install section has no fenced commands");
  assert.equal(inFence, false, "a fence in the README's install section is unclosed");
  return { headings, commands };
}

/**
 * The rendered code lines of a page, in document order, entities decoded.
 *
 * NOT `toText`, and the difference is a real one that cost this test a debug
 * cycle. `toText` replaces each tag with a SPACE before collapsing whitespace,
 * which is right for prose and wrong for code: the syntax highlighter wraps
 * every token in its own span, so `plugins/ai-pop/skills/*` comes back as
 * `plugins/ai-pop/skills/ *` — a space that is in no source file and on no
 * reader's screen. A verbatim comparison has to strip tags without inserting
 * anything, and keep the whitespace the spans actually contain.
 */
function codeLines(html) {
  return [...html.matchAll(/<div class="ec-line">([\s\S]*?)<\/div><\/div>/g)]
    .map((m) => decodeEntities(m[1].replace(/<[^>]+>/g, "")).trim())
    .filter((l) => l !== "");
}

/**
 * A README heading as it reads once markdown has been rendered.
 *
 * The headings carry inline code — "Installing via Open Agent Skills CLI
 * (`npx skills`)" — and the backticks are markup, not text. Removing them is
 * the only normalisation this comparison does, and it is applied to the SOURCE
 * side so the rendered side stays untouched.
 */
const asRendered = (heading) => heading.replace(/`/g, "");

/**
 * The text of an inline fragment, tags removed WITHOUT substituting a space.
 *
 * Same reason as `codeLines`, in the other half of the page: a heading that
 * contains inline code renders as `(<code>npx skills</code>)`, and `toText`
 * turns that into `( npx skills )`. The parentheses are the author's; the
 * spaces are the markup's. Runs of whitespace are collapsed afterwards because
 * this side IS prose.
 */
const inlineText = (html) =>
  decodeEntities(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

// ── AC9 ─────────────────────────────────────────────────────────────────────

test("AC9: /about/install/ reproduces every README installer, in README order", async () => {
  const { headings } = await readmeInstallers();
  const page = pageAt(await distContentPages(), "about/install");
  const main = mainOf(page.html);

  // Rendered sub-headings, in the order the document puts them, read off the
  // artifact rather than assumed from the source.
  const rendered = [...main.matchAll(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/g)]
    .map((m) => inlineText(m[1]).replace(/\s*Direct link to.*$/i, "").trim())
    .filter((t) => t !== "");

  // Every README installer appears, and the ones that do appear are in the
  // README's relative order. Compared as a SUBSEQUENCE, because the page also
  // carries its own H1 and Starlight may add anchors: an equality here would
  // fail on chrome rather than on drift.
  const positions = headings.map((h) => {
    const i = rendered.findIndex((r) => r === asRendered(h));
    assert.notEqual(i, -1, `installer "${h}" is in README.md and not on /about/install/`);
    return i;
  });
  assert.deepEqual(
    positions,
    [...positions].sort((a, b) => a - b),
    `the installers are on the page in a different order from the README: ${headings.join(" | ")}`,
  );
  assert.ok(positions.length >= 3, `only ${positions.length} installers were found`);
});

test("AC9: every install command is reproduced verbatim, line for line", async () => {
  // "Verbatim" is not "the page mentions npx". Each non-blank line inside each
  // fence of the README's section must appear as a rendered code line, in the
  // README's order, with its bytes unchanged.
  const { commands } = await readmeInstallers();
  const page = pageAt(await distContentPages(), "about/install");
  const rendered = codeLines(mainOf(page.html));

  assert.ok(rendered.length > 0, "no code lines were extracted — the extractor is not working");

  let cursor = -1;
  const missing = [];
  for (const line of commands) {
    const want = line.trim();
    const at = rendered.findIndex((r, i) => i > cursor && r === want);
    if (at === -1) missing.push(want);
    else cursor = at;
  }
  assert.deepEqual(
    missing,
    [],
    `these README command lines are not reproduced on /about/install/, in order:\n` +
      missing.join("\n"),
  );
  // Population, both sides. The page may render MORE code lines than the
  // README's install section has — it is a whole page — but it cannot render
  // fewer and still be reproducing all of them, and a rendered set smaller than
  // the source set is the signature of a truncated extraction rather than a
  // passing comparison.
  assert.ok(
    rendered.length >= commands.length,
    `${commands.length} README command lines were checked against only ${rendered.length} ` +
      `rendered code lines`,
  );
  assert.ok(commands.length >= 8, `only ${commands.length} command lines found in the README`);
});

test("AC9: the installer COUNT on the page is measured, not typed", async () => {
  // §11: "hand-type '10 plugins, 23 skills' on a landing page: No." The install
  // page states how many routes it reproduces; that number must be the number
  // of installers actually in the README, so adding a fourth changes the page
  // rather than silently contradicting it.
  const { headings } = await readmeInstallers();
  const page = pageAt(await distContentPages(), "about/install");
  const text = toText(mainOf(page.html));
  assert.ok(
    text.includes(`The ${headings.length} routes below`),
    `the page does not state the derived installer count (${headings.length})`,
  );
  // …and it does not state a different one.
  for (let n = 1; n <= 9; n += 1) {
    if (n === headings.length) continue;
    assert.ok(!text.includes(`The ${n} routes below`), `the page also claims ${n} routes`);
  }
});

test("AC9 control: the verbatim comparison fails on a single perturbed character", async () => {
  // POSITIVE control. Every assertion above is a containment that currently
  // holds, and a containment check with a broken extractor holds vacuously.
  // This proves the comparison can see a one-character drift.
  const { commands } = await readmeInstallers();
  const page = pageAt(await distContentPages(), "about/install");
  const rendered = codeLines(mainOf(page.html));

  const perturbed = commands.map((l) => l.trim().replace(/skills/, "sk1lls"));
  const changed = perturbed.filter((l, i) => l !== commands[i].trim());
  assert.ok(changed.length > 0, "the perturbation changed nothing — this control is asleep");

  const survivors = changed.filter((l) => rendered.includes(l));
  assert.deepEqual(
    survivors,
    [],
    `the perturbed line ${survivors[0]} matched a rendered line, so the comparison ` +
      `is not comparing what it claims to`,
  );
  // …and the UNperturbed forms of those same lines do match, so the control is
  // isolating the perturbation rather than the extractor.
  for (const l of changed) {
    const original = commands.find((c) => c.trim().replace(/skills/, "sk1lls") === l).trim();
    assert.ok(rendered.includes(original), `the unperturbed line is not rendered either: ${original}`);
  }
});

test("AC9: the page says where its bytes came from", async () => {
  // A lift that does not name its source is indistinguishable from a copy
  // somebody typed. The provenance row is what makes "the README is the source"
  // a fact a reader can check rather than a claim this suite makes.
  const page = pageAt(await distContentPages(), "about/install");
  const rows = fieldRows(mainOf(page.html));
  const source = rows.find((r) => r.label.trim() === "source");
  assert.ok(source, "/about/install/ renders no source row");
  assert.match(source.note, /lifted verbatim/, "the source row does not say the page is a lift");
  assert.ok(toText(source.dd).includes("README.md"), "the source row does not name README.md");
});

// ── AC10 ────────────────────────────────────────────────────────────────────

/**
 * The length ceiling for /about/standards/, in characters of rendered text.
 *
 * A PROXY, and the criterion says so: "no restated normative text (reviewed,
 * plus a length ceiling as a proxy)". Nothing about a character count can tell
 * a pointer from a paraphrase. What it can do is make the paraphrase expensive,
 * because a page cannot restate two specifications and stay short.
 *
 * PRICED: the page measures 1527 characters today. The ceiling is 2200 — under
 * 1.5x, so it is a bound somebody would hit rather than a formality, and the
 * test below asserts that relationship rather than trusting this comment. If
 * this page needs more room, the question to answer first is whether the
 * material belongs on it at all: the specifications are published elsewhere by
 * other people, and this page is a pointer to them.
 */
const STANDARDS_CEILING = 2200;

test("AC10: /about/standards/ links both standards, at their own homes", async () => {
  const page = pageAt(await distContentPages(), "about/standards");
  const main = mainOf(page.html);
  const hrefs = [...main.matchAll(/<a\b[^>]*?\shref="([^"]*)"/g)].map((m) => m[1]);
  for (const host of ["agent-plugins.org", "agentskills.io"]) {
    const hit = hrefs.filter((h) => h.startsWith("https://") && h.includes(host));
    assert.ok(hit.length > 0, `the standards page does not link ${host}. Links: ${hrefs.join(", ")}`);
  }
  // Linked, not merely named: the two hosts are different documents at
  // different homes, and a reader has to be able to get to each.
  assert.notEqual(
    hrefs.find((h) => h.includes("agent-plugins.org")),
    hrefs.find((h) => h.includes("agentskills.io")),
    "both standards resolve to the same URL",
  );
});

test("AC10: the skills-only claim is a MEASUREMENT, and the measurement is zero", async () => {
  // The claim has two halves and both are checked against the repository:
  // the page must say zero MCP servers, and there must in fact be zero. A page
  // that said "0" while a plugin shipped an mcp.json would be the fabrication
  // this whole site is built to avoid.
  const { plugins } = await sourceRoutes();
  const withMcp = [];
  for (const p of plugins) {
    try {
      await readFile(join(repoRoot, "plugins", p, "mcp.json"), "utf8");
      withMcp.push(p);
    } catch {
      /* Agent Plugins §6.1 fixes the location; absence is the normal case. */
    }
  }
  // Independently measured, with its denominator.
  assert.deepEqual(withMcp, [], `${withMcp.length} of ${plugins.length} plugins declare an mcp.json`);

  const page = pageAt(await distContentPages(), "about/standards");
  const text = toText(mainOf(page.html));
  assert.ok(text.includes("skills-only"), "the page does not state the catalog is skills-only");
  assert.ok(
    text.includes(`${withMcp.length} MCP servers`),
    `the page does not state the measured MCP-server count (${withMcp.length})`,
  );
  assert.ok(
    text.includes(`${withMcp.length} of the ${plugins.length} plugins declare an mcp.json`),
    `the page states no denominator for the MCP count (${withMcp.length} of ${plugins.length})`,
  );
  // And it names the location the standard fixes, so "zero MCP servers" is a
  // statement about a defined place rather than a vague absence.
  assert.ok(text.includes("mcp.json"), "the page does not name the fixed location it probed");
});

test("AC10: the standards page restates no normative text — proxy, not proof", async () => {
  const page = pageAt(await distContentPages(), "about/standards");
  const text = toText(mainOf(page.html));

  // Half one: the length ceiling, with the measurement and the headroom in the
  // failure message so a future reader is not left guessing which number moved.
  assert.ok(
    text.length <= STANDARDS_CEILING,
    `/about/standards/ is ${text.length} characters against a ceiling of ` +
      `${STANDARDS_CEILING}. Read the note above STANDARDS_CEILING before raising it.`,
  );
  // The ceiling is a bound rather than a formality: it is within 1.5x of the
  // page as it stands, so it constrains the next edit.
  assert.ok(
    STANDARDS_CEILING < text.length * 1.5,
    `the ceiling (${STANDARDS_CEILING}) is more than 1.5x the page (${text.length}); ` +
      `it has stopped being a constraint and should be retightened, not inherited`,
  );

  // Half two: RFC 2119 requirement language. A pointer page does not need it;
  // a paraphrase of a specification cannot avoid it.
  const hits = normativeHits(text);
  assert.deepEqual(
    hits,
    [],
    `/about/standards/ uses requirement language: ${hits.join(", ")}. The specifications ` +
      `are the normative documents; link them instead of restating them.`,
  );
});

test("AC10 control: the normative-language detector fires, and does not fire on the page's own prose", async () => {
  // POSITIVE, one sample per keyword, so a detector that lost an alternative
  // cannot hide behind the others.
  for (const sample of [
    "A conforming client MUST ignore unknown fields.",
    "Implementations SHALL NOT rewrite the identifier.",
    "The name should be lowercase and the version must be semver.",
    "A plugin is required to declare a manifest.",
    "Clients MAY cache the index.",
  ]) {
    assert.ok(
      normativeHits(sample).length > 0,
      `the detector does not fire on requirement language: ${sample}`,
    );
  }
  // NEGATIVE, and these are near misses drawn from the page's actual copy: it
  // uses the word "normative", describes what the build "found", and says what
  // the standards "fix". None of that is a restated requirement.
  const page = pageAt(await distContentPages(), "about/standards");
  for (const sample of [
    "the specifications are the normative documents",
    "a paraphrase of a requirement is a second and worse copy of it",
    "Agent Plugins fixes two locations inside a plugin root",
    "Those are counts from the build that produced this page",
  ]) {
    assert.ok(
      toText(mainOf(page.html)).includes(sample),
      `this control quotes copy the page no longer has: ${sample}`,
    );
    assert.deepEqual(
      normativeHits(sample),
      [],
      `the detector fires on the page's own legitimate prose: ${sample}`,
    );
  }
});

// ── The five pages, and their counts ────────────────────────────────────────

test("the five site pages exist, and exactly three of them are lifts", async () => {
  const pages = await distContentPages();
  for (const route of SITE_ROUTES) pageAt(pages, route);

  // A provenance row renders exactly when the page lifts bytes. Derived by
  // reading the artifact, then compared against the routes that are lifts.
  const lifting = SITE_ROUTES.filter((route) => {
    const rows = fieldRows(mainOf(pageAt(pages, route).html));
    return rows.some((r) => /lifted verbatim/.test(r.note));
  });
  assert.deepEqual(
    lifting,
    ["", "about/install", "about/contributing"],
    "the set of site pages claiming to lift repository bytes has changed",
  );
  // …and the two authored pages say nothing about a source, because there is
  // none to name. "source: this site" would be a label carrying no information.
  for (const route of SITE_ROUTES.filter((r) => !lifting.includes(r))) {
    const rows = fieldRows(mainOf(pageAt(pages, route).html));
    assert.deepEqual(
      rows.filter((r) => r.label.trim() === "source"),
      [],
      `${route} is site-authored and renders a source row`,
    );
  }
});

test("§11: every count on the landing page is the measured one", async () => {
  // "Hand-type '10 plugins, 23 skills' on a landing page: No." Checked against
  // the source tree, not against the loader.
  const { plugins, skills, references } = await sourceRoutes();
  const text = toText(mainOf(pageAt(await distContentPages(), "").html));

  assert.ok(text.includes(`${plugins.length} plugins`), `the landing page miscounts plugins`);
  assert.ok(text.includes(`${skills.length} skills`), `the landing page miscounts skills`);
  assert.ok(
    text.includes(`${references.length} reference documents`),
    `the landing page miscounts reference pages (${references.length})`,
  );
  // NON-VACUITY: the numbers are real, not all zero or all the same.
  assert.ok(plugins.length > 0 && skills.length > plugins.length && references.length > 0);
  // NEGATIVE: the page does not also state a NEIGHBOURING count, which is what
  // a stale hand-typed number looks like after the catalog grows by one.
  for (const off of [-1, 1]) {
    assert.ok(
      !text.includes(`${skills.length + off} skills`),
      `the landing page states ${skills.length + off} skills as well as ${skills.length}`,
    );
  }
});

/**
 * RFC 2119 requirement language, as it appears in restated specification prose.
 *
 * Uppercase keywords are the specification's own convention. The lowercase
 * forms are included because a paraphrase usually drops the capitals — that is
 * most of what makes it a paraphrase — and "should be", "must be" and "is
 * required to" are how it reads afterwards.
 */
function normativeHits(text) {
  const patterns = [
    /\b(MUST|SHALL|SHOULD|REQUIRED|RECOMMENDED|OPTIONAL|MAY)\b/,
    /\b(must|shall)\s+(not\s+)?\w+/,
    /\bis required to\b/i,
    /\bshould\s+(not\s+)?(be|have|use|declare|render|contain)\b/i,
  ];
  return patterns.filter((re) => re.test(text)).map((re) => text.match(re)[0]);
}
