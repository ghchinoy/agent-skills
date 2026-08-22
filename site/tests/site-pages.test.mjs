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
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import {
  SITE_ROUTES,
  codeOnlyLines,
  decodeEntities,
  distContentPages,
  fieldRows,
  mainOf,
  pageAt,
  rel,
  repoRoot,
  siteRoot,
  sourceRoutes,
  toText,
  walk,
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

// ── THE DETECTOR'S LOSS PROFILE, MEASURED AGAINST THE REAL SPECIFICATIONS ────
//
// READ THIS BEFORE TRUSTING A SILENCE FROM `normativeHits()`.
//
// The control below used to draw its positive samples from sentences someone
// wrote by READING THE REGEXES. Every one of them fired, and that green light
// meant less than it looked like: A POSITIVE CONTROL DERIVED FROM THE
// IMPLEMENTATION SHARES THE IMPLEMENTATION'S BLIND SPOT BY CONSTRUCTION. It
// could prove the patterns compile and fire. It could not prove the needle set
// covers the class, because it was built from the needle set — so for the thing
// it appeared to certify, IT COULD NOT FAIL. Same shape as C11: a check that
// passes by construction reports success either way.
//
// So the samples now come from the corpus the pages are actually at risk of
// paraphrasing: the two specifications, at the commits pinned in
// `specification-source.json`. That is a control that CAN go red. It did.
//
// ── WHAT THE MEASUREMENT FOUND, AND IT IS WORSE THAN ONE MISSED WORD ─────────
//
// Probed by running the four patterns over every keyword-bearing sentence in
// both specs:
//
//   agentplugins/agent-plugins-spec @ff8ab5e3  spec/1.0.0.md
//     119 sentences carry an RFC-2119 keyword;  11 are SILENT.
//   agentskills/agentskills @69ef37e9  docs/specification.mdx
//      15 sentences carry an RFC-2119 keyword;  13 are SILENT.
//
// THAT ASYMMETRY IS THE FINDING. It is not a quirk of sampling. Agent Plugins
// writes RFC-2119 keywords in UPPERCASE, which is the convention the detector
// was built around. Agent Skills writes its constraints in ordinary sentence
// case — "Must not start or end with a hyphen", "Should describe both what the
// skill does and when to use it", "May only contain unicode lowercase
// alphanumeric characters". The detector is effectively blind TO THE ENTIRE
// NORMATIVE STYLE OF ONE OF THE TWO SPECIFICATIONS THIS SITE DESCRIBES, and
// nothing said so, because the old samples were all in the other one's style.
//
// The silent classes, derived by probing rather than by reading:
//
//   1. TITLE CASE. "Must not …", "Should include …", "May only contain …".
//      Pattern 1 is uppercase-only; pattern 2 has no `i` flag. THESE ARE NOT
//      PARAPHRASES — they are literal RFC-2119 keywords, and they are how the
//      Agent Skills specification states every one of its constraints.
//   2. `should` + any verb outside the closed list {be,have,use,declare,
//      render,contain}. "should include", "should describe", "should ship".
//   3. `may`, `required`, `recommended`, `optional` in any non-uppercase form.
//      "Clients may not recurse deeper" is a literal MAY and is silent.
//   4. Contractions: "mustn't", "shouldn't" — no whitespace to match on.
//   5. Clause-final "…they must." — pattern 2 needs a following word.
//   6. Genuine paraphrase: "requires", "has to", "needs to", "is forbidden",
//      "is not permitted", "never". UNBOUNDED, and no needle set closes it.
//
// CLASSES 1–5 ARE BOUNDED AND CLOSEABLE. Class 6 is not, and adding words to
// chase it manufactures a green light that reads like coverage — the class
// stays open and the next paraphrase uses the next verb. That refusal is
// deliberate and is recorded rather than left as a silence.
//
// THE DETECTOR IS THEREFORE A PROXY AND THE TEST NAME SAYS SO. Its silence on
// the site's own pages is evidence, not proof. The only instrument that has
// ever caught an instance of class 6 here is a person reading a page for the
// CLAIM rather than for the STRING, which is how the one live defect in this
// phase was found — and it was found on a page this detector was not even
// pointed at.

/**
 * LEVEL 1 CONTROL (E-4 ladder): built from the detector's DECLARED INTENT.
 *
 * Every string here is an RFC-2119 keyword in a case the docstring above says
 * it covers, in a grammatical sentence. NOT ONE OF THEM WAS WRITTEN BY READING
 * THE REGEXES. If this list goes red, the function is not doing what it says it
 * does, and the answer is to fix the function or amend the declaration — never
 * to trim this list, which is the move that produced the original defect.
 *
 * WOULD A DEFECT IN THE THING THIS GUARDS MAKE IT FAIL? Yes, and it did: on
 * first run 16 of these 30 were silent, which is how the defect was found.
 */
const DECLARED_FORMS = (() => {
  const frames = {
    MUST: (k) => `The plugin manifest ${k} carry a name field.`,
    "MUST NOT": (k) => `A skill name ${k} start with a hyphen.`,
    SHALL: (k) => `The client ${k} resolve the path relative to the plugin root.`,
    "SHALL NOT": (k) => `The client ${k} recurse below that directory.`,
    SHOULD: (k) => `Authors ${k} include a description under 200 characters.`,
    "SHOULD NOT": (k) => `Authors ${k} rely on the ordering of the entries.`,
    REQUIRED: (k) => `The name field is ${k} in every manifest.`,
    RECOMMENDED: (k) => `Semantic versioning is ${k} for published plugins.`,
    MAY: (k) => `A plugin ${k} declare additional resource directories.`,
    OPTIONAL: (k) => `The homepage field is ${k}.`,
  };
  // The three cases the docstring contemplates: the specification's own
  // convention, the lowercase it says a paraphrase drops to, and the Title case
  // that decapitalisation actually produces at the start of a sentence.
  const cases = [(k) => k, (k) => k.toLowerCase(), (k) => k[0] + k.slice(1).toLowerCase()];
  return Object.entries(frames).flatMap(([k, f]) => cases.map((c) => f(c(k))));
})();

test("AC10 control (LEVEL 1): the detector does what its own docstring says it does", () => {
  const silent = DECLARED_FORMS.filter((s) => normativeHits(s).length === 0);
  assert.deepEqual(
    silent,
    [],
    `${silent.length} of ${DECLARED_FORMS.length} forms the docstring DECLARES COVERED are ` +
      "invisible to it. A declaration and an implementation are contradicting each other:\n  " +
      silent.join("\n  "),
  );
  // Non-vacuity: an empty generator would pass the assertion above in silence.
  assert.equal(DECLARED_FORMS.length, 30, "the declared-forms generator stopped generating");
});

/**
 * LEVEL 2 CONTROL (E-4 ladder): real sentences from the two specifications, at
 * the pinned commits — the corpus the detector is at risk against.
 *
 * `caught` and `silent` are a measured PARTITION, not a wish. Both halves are
 * asserted, so this fixture fails in two directions: if the detector regresses
 * and stops catching what it catches, and if someone improves it without
 * moving a sentence out of `silent`. A loss profile nobody re-measures is the
 * stale figure this project keeps rediscovering.
 */
const SPEC_SAMPLES = {
  caught: [
    // agentplugins/agent-plugins-spec @ff8ab5e3, spec/1.0.0.md
    "A plugin MUST include a manifest at `plugin.json` in the plugin root.",
    "If `plugin.json` does not resolve within the plugin root, the client MUST reject the plugin.",
    "Clients and plugin packages claiming conformance to Agent Plugins v1 MUST implement or follow" +
      " the requirements in this document.",
    "A client is not required to support every component type.",
    "The optional `extensions` field contains client-specific manifest data keyed by extension" +
      " namespace. See §8 for processing rules.",
    // agentskills/agentskills @69ef37e9, docs/specification.mdx. EVERY ONE OF
    // THESE SIX WAS IN `silent` UNTIL THE DOCSTRING WAS HONOURED. They were
    // never paraphrase — they are literal RFC-2119 keywords in Title case, and
    // the declaration always claimed them. Recording the move rather than
    // quietly deleting the old list: the profile said "invisible" about text
    // the function's own contract said it could see.
    "Must not start or end with a hyphen (`-`)",
    "Must not contain consecutive hyphens (`--`)",
    "Must match the parent directory name",
    "May only contain unicode lowercase alphanumeric characters (`a-z`, `0-9`) and hyphens (`-`)",
    "Should describe both what the skill does and when to use it",
    "Should include specific keywords that help agents identify relevant tasks",
  ],
  // WHAT IS ACTUALLY STILL INVISIBLE, and it is a different class from before.
  // These carry normative force and contain NO RFC-2119 keyword in any case, so
  // no keyword matcher reaches them however it is spelled. This is PARA-1 with
  // the docstring bug subtracted out — the residue that is genuinely a matcher
  // limit rather than a contract violation.
  silent: [
    "`plugin.json` cannot override these locations or contain inline component configuration.",
    "A change to either schema requires a new specification release.",
    "Client experiments cannot claim arbitrary top-level fields; they are contained under" +
      " reverse-domain keys in `extensions`.",
    "This gives plugin authors and clients one portable format version to understand, prevents" +
      " mixed-version packages, and lets `$schema` select the complete validation and" +
      " interpretation contract — including requirements that JSON Schema cannot express.",
    "Requires git, docker, jq, and access to the internet", // agentskills @69ef37e9
    // Not from a specification. THIS SENTENCE IS REMOVED FROM THE SITE AND IS
    // NOT RENDERED ANYWHERE — verified against dist/index.html, which contains
    // no occurrence of it and no occurrence of the word "requires"; the only
    // trace left in src/ is the comment at site-pages.mjs recording the
    // removal. It is retained here strictly as a CORPUS SAMPLE of the class,
    // because it is the only member anyone on this project has actually
    // shipped, and a class with no real exemplar drifts into the hypothetical.
    // Stated explicitly because a defect kept as test data without a note
    // saying it is dead is how a defect acquires tenure: the next reader finds
    // it in a fixture, assumes it is live, and either re-adds it or works
    // around it.
    "a SKILL.md at plugins/<plugin>/skills/<skill>/, discovered without recursing below that" +
      " directory, as Agent Plugins §7.1 requires.",
  ],
};

test("AC10 control: the detector's REAL loss profile, measured against the specifications", () => {
  // Half one: it is alive. Drawn from the corpus, not from the regexes.
  for (const sample of SPEC_SAMPLES.caught) {
    assert.ok(
      normativeHits(sample).length > 0,
      `the detector has REGRESSED — it no longer fires on real specification text: ${sample}`,
    );
  }

  // Half two: the recorded blindness is still exactly this blindness. If one of
  // these starts being caught, that is good news and this list is wrong; update
  // it deliberately rather than letting the profile rot.
  const nowCaught = SPEC_SAMPLES.silent.filter((s) => normativeHits(s).length > 0);
  assert.deepEqual(
    nowCaught,
    [],
    "the recorded loss profile is out of date: the detector now catches text this " +
      "file documents as invisible. Move these into `caught` and re-measure the " +
      "profile, so the next reader is told the truth about what a silence means:\n  " +
      nowCaught.join("\n  "),
  );

  // NON-VACUITY. Without this, emptying either list makes the whole control
  // pass — the gate-that-cannot-fail, one level up from the gate itself.
  assert.ok(SPEC_SAMPLES.caught.length >= 3, "the positive half has been emptied");
  assert.ok(SPEC_SAMPLES.silent.length >= 6, "the loss profile has been emptied");
});

// ── AC1, THE GREP HALF ──────────────────────────────────────────────────────
//
// AC1: "Plugin and skill counts computed at build time … No integer hand-typed
// in any `.astro`/`.ts`, grep-asserted."
//
// TWO INSTRUMENTS, AND THE GREP IS THE WEAKER ONE. Stated first so nobody reads
// a green grep as the proof:
//
//   LOAD-BEARING — the catalog perturbation in build-e2e.test.mjs. It plants a
//   real SKILL.md, rebuilds, and requires the rendered skill count to MOVE
//   while the plugin count stands still. That is level 1 against AC1's own
//   words: a count that is not computed at build time cannot pass it, whatever
//   the count is spelled like and whatever file it lives in.
//
//   CORROBORATING — this scan. It is a substring search and inherits every
//   substring search's limits. `20 + 3`, `"2" + "3"`, `0x17`, `Number("23")`
//   and a count read from a stale generated file ALL SURVIVE IT. Its silence
//   is worth having only because the perturbation is not silent.
//
// AC1'S STATED POPULATION IS TOO NARROW, AND THE NARROWING POINTS AWAY FROM THE
// DEFECT. AC1 names `.astro` and `.ts`. Every landing-page count on this site
// is produced in `src/loaders/site-pages.mjs` — a `.mjs` file. A grep restricted
// as written would sweep the two extensions where a hand-typed count is least
// likely and skip the one file where it would actually live. The population
// below is widened to every source extension under `src/`, and the widening is
// asserted rather than assumed: the test fails if the file that builds the
// landing page is not in the swept set.
//
// The values are parsed FROM THE CATALOG, independently of the site's own
// loaders. Importing the loader would make the scan agree with the loader by
// construction — if the loader hardcoded a count, the scan would hunt for the
// hardcoded value and find it exactly where it is allowed to be.

/** Plugin and skill counts, parsed from the catalog without the site's code. */
async function freshCounts() {
  const marketplace = JSON.parse(
    await readFile(join(repoRoot, ".claude-plugin/marketplace.json"), "utf8"),
  );
  let skills = 0;
  for (const plugin of marketplace.plugins) {
    const dir = join(repoRoot, plugin.source.replace(/^\.\//, ""), "skills");
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        await stat(join(dir, entry.name, "SKILL.md"));
        skills += 1;
      } catch {
        /* a directory with no SKILL.md is not a skill */
      }
    }
  }
  return { plugins: marketplace.plugins.length, skills };
}

const SOURCE_EXTENSIONS = [".astro", ".ts", ".mjs", ".js"];

async function sourceFiles() {
  const all = await walk(join(siteRoot, "src"));
  return all.filter((p) => SOURCE_EXTENSIONS.some((e) => p.endsWith(e)));
}

/** `file:line` for every occurrence of `value` as a standalone number in code. */
function literalHits(text, label, value) {
  // Word-boundary and not part of a longer number: `1.10`, `2023` and `v23`
  // must not read as a hand-typed 23. Comments are already gone; string
  // literals are deliberately still here, because "23" in quotes is the exact
  // shape being hunted.
  const re = new RegExp(`(?<![\\w.])${value}(?![\\w.])`, "g");
  return codeOnlyLines(text)
    .filter(({ code }) => re.test(code) && (re.lastIndex = 0) === 0)
    .map(({ line }) => `${label}:${line}`);
}

test("AC1: no source file hand-types the plugin or skill count", async () => {
  const counts = await freshCounts();
  const files = await sourceFiles();

  // DENOMINATOR FIRST. A scan over an empty or wrongly-filtered file set reports
  // clean, and clean and never-ran are the same bytes.
  assert.ok(files.length >= 10, `the scan swept only ${files.length} source files`);
  const builder = files.find((p) => p.endsWith("loaders/site-pages.mjs"));
  assert.ok(
    builder,
    "the file that BUILDS the landing page is not in the swept population. This is " +
      "the exact narrowing AC1's own wording would have produced: it names .astro " +
      "and .ts, and every count on this site is produced in a .mjs.",
  );

  const offenders = [];
  for (const path of files) {
    const text = await readFile(path, "utf8");
    for (const [what, value] of Object.entries(counts)) {
      for (const hit of literalHits(text, rel(path, siteRoot), String(value))) {
        offenders.push(`${hit} contains ${value}, the current ${what} count`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `a source file contains the literal ${counts.plugins} or ${counts.skills} in code. ` +
      "If that is a count, it stops being true the moment the catalog changes and " +
      "nothing will say so. If it is a coincidence, this scan needs to be able to " +
      "tell the difference and currently cannot:\n  " +
      offenders.join("\n  "),
  );
});

test("AC1 control: the scan goes red on a planted count, in each source extension", async () => {
  // LEVEL 1 against AC1's own text — "no integer hand-typed" — rather than
  // against this scan's regex. The plant is what AC1 forbids, written the way
  // someone would actually write it, not a string reverse-engineered from the
  // matcher.
  const counts = await freshCounts();

  for (const [what, value] of Object.entries(counts)) {
    const planted = `const total = ${value};`;
    assert.deepEqual(
      literalHits(planted, "planted.mjs", String(value)),
      ["planted.mjs:1"],
      `a hand-typed ${what} count was not detected — the scan above proves nothing`,
    );
    // In a string, which is how it would reach a template.
    assert.deepEqual(
      literalHits(`const label = "${value} ${what}";`, "planted.astro", String(value)),
      ["planted.astro:1"],
      `a hand-typed ${what} count inside a string literal was not detected`,
    );
  }

  // NEGATIVE HALF, and it is what stops this being satisfied by a scan that
  // flags everything. Each of these legitimately appears in source and none is
  // a count.
  for (const benign of [
    'const v = "1.10";',
    "const year = 2023;",
    "const tag = 'v23';",
    "// 23 skills, said in a comment",
    "/* 10 plugins in a block comment */",
    "const url = 'https://example.test/x'; // 23",
  ]) {
    assert.deepEqual(
      literalHits(benign, "b.mjs", "23").concat(literalHits(benign, "b.mjs", "10")),
      [],
      `the scan flags a benign line and would be deleted for noise: ${benign}`,
    );
  }
});

// ── THE POPULATION FIX ──────────────────────────────────────────────────────
//
// The detector above was pointed at `/about/standards/` and nowhere else, so on
// the other four site pages THE SEARCH WAS NEVER RUN. An absence produced by
// not looking is byte-identical to an absence produced by looking, and this
// suite had the second kind of absence on one page and the first kind on four.
// That cost a real defect: a paraphrase of Agent Plugins §7.1 shipped into the
// LANDING page draft, where nothing was watching.
//
// Widening a POPULATION and widening a NEEDLE are opposite acts. Widening the
// needle to chase a paraphrase manufactures coverage over an unbounded class.
// Running an existing search where it was never run REMOVES A FILTER. Only the
// first is refused above; this is the second.
//
// ── WHY THIS IS NOT SIMPLY "SCAN ALL 59 PAGES" ──────────────────────────────
//
// It was measured before it was designed. The raw detector fires on 29 of the
// 59 rendered pages — and every one of those is a plugin or skill page whose
// text is LIFTED from a `SKILL.md` in this repository. A skill author writing
// "MUST" in their own skill is their content, rendered faithfully. It is not
// this site restating a specification, and failing on it would be a false
// positive that the next person silences by narrowing the scan back down.
//
// So the population is the five SITE-AUTHORED pages, and within them each hit
// is attributed INDIVIDUALLY: a hit is allowed only if the text around it
// appears verbatim in a source this repository declares — `README.md`,
// `CONTRIBUTING.md`, or a `SKILL.md`. Per hit, never per page. A page-level
// allowance would let genuinely new normative prose ride along on a page that
// happens to contain one legitimate lift, which is exactly how these
// exemptions rot.
//
// The two hits this currently attributes are real and worth naming: a skill's
// own `description` on `/skills/` ("…should be fully automated…") and a
// verbatim `CONTRIBUTING.md` line on `/about/contributing/` ("…must be
// executable…"). SUPPRESSING EITHER WOULD BE THE ANTI-FABRICATION RULE RUN
// BACKWARDS — hiding declared data to keep a test quiet is the same violation
// as inventing data.

/** Normalises rendered text and source markdown onto common ground. */
function flattenProse(s) {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[`*_#>|[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every prose source this repository DECLARES, as one normalised corpus. */
async function declaredProse() {
  const parts = [
    await readFile(join(repoRoot, "README.md"), "utf8"),
    await readFile(join(repoRoot, "CONTRIBUTING.md"), "utf8"),
  ];
  const { skills } = await sourceRoutes();
  for (const s of skills) parts.push(await readFile(s.skillMd, "utf8"));
  // Non-vacuity: an empty corpus would attribute nothing and the scan would
  // report every legitimate lift as a defect — loud, but for the wrong reason.
  const corpus = flattenProse(parts.join("\n"));
  assert.ok(corpus.length > 50000, `the declared-source corpus is only ${corpus.length} chars`);
  return corpus;
}

/** Block-level text of a rendered page, so a match cannot span two paragraphs. */
function proseBlocks(html) {
  const blocks = [];
  const re = /<(p|li|td|th|h[1-6]|dd|dt|figcaption|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(mainOf(html))) !== null) {
    const text = decodeEntities(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (text) blocks.push(text);
  }
  return blocks;
}

/**
 * Normative hits on a page that are NOT attributable to a declared source.
 *
 * The window is trimmed from BOTH ends, a word at a time, before giving up,
 * because a rendered list item concatenates site chrome with a declared value
 * on either side: "Automation Readiness Evaluator … from Automation Governance"
 * precedes the skill's own description, and "plugin keywords: readme, …"
 * follows it. A declared description is therefore an INFIX of the rendered
 * block, and a window anchored to either edge crosses a boundary into chrome
 * that appears in no source file.
 *
 * The 40-character floor is what stops this degenerating into a machine that
 * attributes everything: a window that has been trimmed down to a few common
 * words would match some source file by coincidence. Both directions of the
 * control below exist because an attributor that never fails is not an
 * attributor, it is a suppressor.
 */
function unattributedNormative(blocks, corpus) {
  const W = 70;
  const MIN = 40;
  const wordStarts = (s, from, to) => {
    const out = [from];
    for (let i = from; i < to; i++) if (s[i] === " ") out.push(i + 1);
    return out;
  };
  const out = [];
  for (const block of blocks) {
    for (const re of NORMATIVE_PATTERNS) {
      const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
      let m;
      while ((m = g.exec(block)) !== null) {
        const end = m.index + m[0].length;
        const lefts = wordStarts(block, Math.max(0, m.index - W), m.index);
        const rights = wordStarts(block, end, Math.min(block.length, end + W)).reverse();
        let attributed = false;
        for (const left of lefts) {
          for (const right of rights) {
            const window = flattenProse(block.slice(left, right));
            if (window.length >= MIN && corpus.includes(window)) {
              attributed = true;
              break;
            }
          }
          if (attributed) break;
        }
        if (!attributed) {
          out.push(`${m[0]} :: ${block.slice(Math.max(0, m.index - 60), Math.min(block.length, end + W))}`);
        }
      }
    }
  }
  return out;
}

test("AC3/AC10: NO site-authored normative language on ANY of the five site pages", async () => {
  const corpus = await declaredProse();
  const pages = await distContentPages();
  const offenders = [];
  let blocksScanned = 0;

  for (const route of SITE_ROUTES) {
    const blocks = proseBlocks(pageAt(pages, route).html);
    blocksScanned += blocks.length;
    for (const hit of unattributedNormative(blocks, corpus)) {
      offenders.push(`${route || "(landing)"}: ${hit}`);
    }
  }

  // The scan reports its own denominator. A scan that found no blocks would
  // report clean, and "clean" and "never ran" are the same bytes.
  assert.ok(
    blocksScanned >= 150,
    `the scan examined only ${blocksScanned} prose blocks across ${SITE_ROUTES.length} pages`,
  );

  assert.deepEqual(
    offenders,
    [],
    "a site page states a requirement in its own words. The specifications are " +
      "published elsewhere by other people; link out instead. Note this is a " +
      "PROXY — read the loss profile above before concluding the pages are clean:\n  " +
      offenders.join("\n  "),
  );
});

test("AC3/AC10 control: the site-authored scan can fail, and attribution can fail with it", async () => {
  const corpus = await declaredProse();

  // (a) Genuinely new normative prose, attributable to nothing, must be caught.
  assert.equal(
    unattributedNormative(["A conforming client MUST ignore unknown manifest fields."], corpus).length,
    1,
    "the scan does not flag invented normative prose — it would pass over a real defect",
  );

  // (b) Real declared text must be attributed, or every legitimate lift becomes
  // a false positive and the next person deletes the scan.
  assert.deepEqual(
    unattributedNormative(["Any helper scripts in scripts/ must be executable (chmod +x)."], corpus),
    [],
    "the scan flags a verbatim CONTRIBUTING.md line. Attribution is broken, and a " +
      "broken attribution is how a real gate gets removed for being noisy.",
  );

  // (c) THE DIRECTION THAT MATTERS MOST. Attribution must not be a blanket
  // pass: normative prose that merely SITS NEAR declared text is still ours.
  const smuggled =
    "Any helper scripts in scripts/ must be executable (chmod +x). Clients MUST NOT " +
    "recursively search deeper descendants of the skills directory.";
  assert.ok(
    unattributedNormative([smuggled], corpus).some((h) => h.includes("MUST")),
    "normative prose adjacent to an attributed lift was itself attributed — the " +
      "allowance is behaving as a page-level exemption rather than a per-hit one",
  );

  // (d) THE COST OF TRIMMING FROM BOTH ENDS, PRICED. Symmetric trimming shrinks
  // the window until it matches, so the question is whether it will shrink far
  // enough to match something that is merely SIMILAR to declared text. This is
  // the CONTRIBUTING.md line from (b) with ONE WORD CHANGED next to the
  // keyword. If attribution still swallows it, the trimming has stopped
  // distinguishing a lift from a rewrite and the whole scan is a rubber stamp.
  const rewritten = "Any helper scripts in scripts/ must be readable (chmod +x).";
  assert.equal(
    unattributedNormative([rewritten], corpus).length,
    1,
    "a one-word REWRITE of declared text was attributed to the declaration. " +
      "Trimming has degenerated into a suppressor: it now shrinks the window " +
      "until something matches, which is a green light manufactured by the " +
      "attributor rather than earned by the page.",
  );

  // (e) And the floor that makes (d) work is real rather than nominal: a window
  // trimmed below it must never attribute, however common its words.
  assert.equal(
    unattributedNormative(["It may be."], corpus).length,
    1,
    "a sub-threshold fragment was attributed — the 40-character floor is not holding",
  );
});

test("AC10 control: the detector does not fire on the page's own legitimate prose", async () => {
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
 *
 * ── THE PARAGRAPH ABOVE IS UNCHANGED, BECAUSE IT IS THE CONTRACT ─────────────
 *
 * It is left exactly as written, including the part that was false, because the
 * finding is that THE IMPLEMENTATION DID NOT DO WHAT ITS OWN DOCSTRING SAID.
 * Rewriting the declaration to match the code would have closed the gap from
 * the wrong end and destroyed the evidence.
 *
 * It says "the lowercase forms are included". They were not. Four of the seven
 * RFC-2119 keywords had NO lowercase pattern at all — `may`, `required`,
 * `recommended`, `optional` — and two more were gated behind closed lists:
 * `should` matched only in front of six hand-picked verbs, `required` only
 * inside the exact phrase "is required to". Probed with one grammatical
 * sentence per keyword in each case the docstring contemplates (uppercase, the
 * lowercase it names, and the Title case a decapitalised keyword becomes at the
 * start of a sentence): 16 of 30 DECLARED-COVERED forms were SILENT.
 *
 * The docstring's own three examples — "should be", "must be", "is required
 * to" — all passed. They are the regexes restated in prose. THE EXAMPLES WERE
 * DERIVED FROM THE IMPLEMENTATION AND THE GENERAL CLAIM ABOVE THEM WAS NOT,
 * so any control written by reading this function agreed with it, and the
 * agreement followed from shared construction rather than from evidence.
 *
 * THIS IS NOT A WIDENED NEEDLE. No word is matched here that the declaration
 * did not already claim; the fix is case-insensitivity, which is what "the
 * lowercase forms are included" means. A SYNONYM would be a widening:
 * "requires", "needs to", "has to" are not RFC-2119 keywords in another case,
 * they are different words. They stay OUT, deliberately, and the class they
 * belong to is carried as PARA-1 rather than papered over with more words.
 */
const NORMATIVE_PATTERNS = [
  // One pattern, not four. The former `is required to` and
  // `should (be|have|use|declare|render|contain)` entries are subsumed by it and
  // are DELETED rather than left as dead alternations that read like extra
  // coverage. A separate uppercase-only entry would double-report every
  // uppercase hit, so case is read off the matched text instead.
  /\b(must|shall|should|required|recommended|optional|may)\b/i,
];

function normativeHits(text) {
  return NORMATIVE_PATTERNS.filter((re) => re.test(text)).map((re) => text.match(re)[0]);
}
