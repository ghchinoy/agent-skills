// links.test.mjs — ACCEPTANCE CRITERION 5 and the general link-integrity gate.
//
// AC5: "All three ../../references/... links in okf-author/SKILL.md (lines 25,
// 29, 127) resolve; 0 broken links."
//
// The expected set is read OUT OF THE SOURCE FILE by this test, with its own
// regex, at the lines the criterion names. It does not ask the loader what the
// links were — if it did, a loader that dropped a link would agree with itself
// and the test would pass on four-fifths of a page.

import { test } from "node:test";

// The live checker's exemption rule, imported rather than reimplemented. See
// isErrorDocCanonical below for why this import exists.
import { classify, errorDocExemption, liveUrlForFile } from "../scripts/check-live-links.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, normalize, relative } from "node:path";
import { existsSync, statSync } from "node:fs";

import {
  BASE,
  ORIGIN,
  PLUGIN,
  dist,
  distContentPages,
  distHtmlFiles,
  entitledSources,
  read,
  repoRoot,
} from "./_helpers.mjs";

const SKILLS = join(repoRoot, "plugins", PLUGIN, "skills");

/** Every `[label](target)` in a file, with 1-based SOURCE line numbers.
 *  Independent of the site's own markdown module on purpose. */
async function linksInSource(file) {
  const lines = (await readFile(file, "utf8")).split("\n");
  const out = [];
  const re = /(?<!!)\[[^\]]*\]\(\s*([^)\s]+)/g;
  let inFence = false;
  lines.forEach((text, i) => {
    if (/^\s*```/.test(text)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    // Blank out inline code spans so documented link SYNTAX is not counted.
    const scrubbed = text.replace(/`[^`]*`/g, (m) => " ".repeat(m.length));
    for (const m of scrubbed.matchAll(re)) out.push({ line: i + 1, target: m[1] });
  });
  return out;
}

test("AC5: the three escaping reference links are at lines 25, 29 and 127 of the source", async () => {
  const links = await linksInSource(join(SKILLS, "okf-author", "SKILL.md"));
  const escaping = links.filter((l) => l.target.startsWith("../../references/"));
  assert.deepEqual(escaping, [
    { line: 25, target: "../../references/okf-v0.2-spec-summary.md" },
    { line: 29, target: "../../references/trust-vocabulary.md" },
    { line: 127, target: "../../references/trust-vocabulary.md" },
  ]);
});

test("AC5: all three resolve on the rendered page to real built pages", async () => {
  const pages = await distContentPages();
  const page = pages.find((p) => p.route === `plugins/${PLUGIN}/okf-author`);
  assert.ok(page, "okf-author page was not built");

  // The two distinct destinations those three links must land on.
  const want = [
    `${BASE}/plugins/${PLUGIN}/references/okf-v0.2-spec-summary/`,
    `${BASE}/plugins/${PLUGIN}/references/trust-vocabulary/`,
  ];
  const body = mainOf(page.html);
  for (const href of want) {
    assert.ok(
      body.includes(`href="${href}"`),
      `okf-author page does not link to ${href}`,
    );
    assert.ok(
      existsSync(join(dist, href.slice(BASE.length + 1), "index.html")),
      `${href} is linked but no page was built there`,
    );
  }

  // Nothing survived unrewritten IN AN HREF. The literal string
  // "../../references/…" does still appear in the visible text of all three,
  // because the source writes each label as a code span showing the on-disk
  // path — that text is the author's, and rewriting it would be a fabrication
  // of a different kind. So the check is on targets, not on prose.
  const rawHrefs = [...body.matchAll(/href="([^"]*)"/g)]
    .map((m) => m[1])
    .filter((h) => h.includes("../"));
  assert.deepEqual(rawHrefs, [], "a raw relative target reached the rendered page");
  // ...and the trust-vocabulary link really does appear twice (lines 29 + 127),
  // so "0 broken links" is not achieved by silently dropping the second one.
  assert.equal(
    (body.match(new RegExp(`href="${want[1]}"`, "g")) || []).length,
    2,
    "the trust-vocabulary link should appear twice — lines 29 and 127",
  );
});

test("AC5 control: the detector fires on an unrewritten target", () => {
  // Negative control for the assertion above: prove the "raw target" check is
  // capable of failing, on a body that genuinely contains one — and that it
  // does NOT fire on the code-span label, which is why it is scoped to hrefs.
  const broken = '<a href="../../references/trust-vocabulary.md">x</a>';
  const ok = '<a href="/agent-skills/x/"><code>../../references/trust-vocabulary.md</code></a>';
  const raw = (h) => [...h.matchAll(/href="([^"]*)"/g)].map((m) => m[1]).filter((s) => s.includes("../"));
  assert.equal(raw(broken).length, 1, "the href detector cannot fire — it is not a gate");
  assert.equal(raw(ok).length, 0, "the href detector fires on a legitimate code-span label");
});

test("0 broken links: every internal href in dist resolves to a built file", async () => {
  const files = await distHtmlFiles();
  const broken = [];
  for (const file of files) {
    const html = await read(file);
    const from = relative(dist, file).split("\\").join("/");
    for (const raw of hrefsIn(html)) {
      if (isExternal(raw)) continue;
      const href = toSitePath(raw);
      const [path] = href.split("#");
      if (isErrorDocCanonical(from, path, html)) continue;
      if (path === "") continue; // pure fragment
      if (!path.startsWith("/")) {
        broken.push(`${from} -> ${href} (relative href; the site emits absolute ones)`);
        continue;
      }
      if (!path.startsWith(BASE + "/") && path !== BASE) {
        broken.push(`${from} -> ${href} (escapes the base path ${BASE})`);
        continue;
      }
      if (!resolvesInDist(path)) broken.push(`${from} -> ${href}`);
    }
  }
  assert.deepEqual(broken, [], `broken internal links:\n${broken.join("\n")}`);
});

test("0 broken links control: a fabricated href is caught by the same resolver", () => {
  assert.equal(resolvesInDist(`${BASE}/plugins/${PLUGIN}/no-such-skill/`), false);
  assert.equal(resolvesInDist(`${BASE}/plugins/${PLUGIN}/okf-author/`), true);
});

// ── The ASSET half of the gate ──────────────────────────────────────────────
// `hrefsIn()` matches `<a href>` and nothing else, which left `src=` and
// `<link href>` outside the gate entirely. A real defect hid in that gap for a
// whole phase: Starlight emits `<link rel="shortcut icon"
// href="/agent-skills/favicon.svg">` on every page and no such file was
// shipped, so all 7 pages 404-ed on their icon while a test named "0 broken
// links" reported zero. Fixed both ways — the asset now exists, and the class
// of reference is now checked. Phase 2 AC3 ("every internal link AND ASSET
// resolves") and Phase 4 AC3 (an inline `process-flow.webp`) depend on this
// half, not on the anchor half.

test("0 broken assets: every src= and <link href> in dist resolves to a built file", async () => {
  const files = await distHtmlFiles();
  const broken = [];
  let checked = 0;
  for (const file of files) {
    const html = await read(file);
    const from = relative(dist, file).split("\\").join("/");
    for (const { kind, ref: rawRef } of assetRefsIn(html)) {
      if (isExternal(rawRef) || rawRef === "") continue;
      const ref = toSitePath(rawRef);
      const [path] = ref.split("#");
      if (path === "") continue;
      if (isErrorDocCanonical(from, path, html)) continue;
      checked += 1;
      if (!path.startsWith("/")) {
        broken.push(`${from} -> ${kind} ${ref} (relative; the site emits absolute ones)`);
        continue;
      }
      if (!path.startsWith(BASE + "/") && path !== BASE) {
        broken.push(`${from} -> ${kind} ${ref} (escapes the base path ${BASE})`);
        continue;
      }
      if (!resolvesInDist(path)) broken.push(`${from} -> ${kind} ${ref}`);
    }
  }
  // A gate that checked nothing would also report zero broken.
  assert.ok(checked > 0, "no asset references were found at all — the extractor is not matching");
  assert.deepEqual(broken, [], `broken asset references:\n${broken.join("\n")}`);
});

test("0 broken assets: the favicon every page references is actually shipped", async () => {
  // The specific defect above, pinned by name rather than only by the sweep,
  // so a regression says what broke instead of just "something 404s".
  let rendered = 0;
  let referenced = 0;
  for (const file of await distHtmlFiles()) {
    const html = await read(file);
    // The root redirect stub is a <meta refresh> and nothing else — it has no
    // Starlight <head> and so no icon link. Every document Starlight actually
    // renders (the 5 content pages and its 404) does have one.
    if (!/<main\b/i.test(html)) continue;
    rendered += 1;
    const icons = assetRefsIn(html).filter((r) => /favicon/i.test(r.ref));
    assert.equal(icons.length, 1, `${relative(dist, file)} emits ${icons.length} favicon references, expected 1`);
    assert.ok(
      resolvesInDist(icons[0].ref.split("#")[0]),
      `${relative(dist, file)} references ${icons[0].ref}, which is not in dist`,
    );
    referenced += 1;
  }
  // RE-POINTED IN PHASE 3: the literal 6 was "the 5 content pages plus the
  // 404". The claim is unchanged — EVERY rendered document carries exactly one
  // favicon reference and it resolves — but the population is now counted
  // rather than typed, so a page added without a favicon cannot pass by being
  // outside a hardcoded total.
  const expected = (await distContentPages()).length + 1;
  assert.equal(rendered, expected, `expected every content page plus the 404 to be rendered`);
  assert.ok(rendered > 1, "only one document rendered — this check is nearly vacuous");
  assert.equal(referenced, rendered);
});

test("0 broken assets control: the widened gate fires on a missing asset, and the old one could not", () => {
  // POSITIVE control — a missing asset of each newly-covered shape is caught.
  const missingIcon = '<link rel="shortcut icon" href="/agent-skills/favicon-nobody-shipped.svg" type="image/svg+xml"/>';
  const missingImage = '<img src="/agent-skills/skill-assets/process-flow.webp" alt="x">';
  for (const html of [missingIcon, missingImage]) {
    const refs = assetRefsIn(html);
    assert.equal(refs.length, 1, "the widened extractor did not see the reference at all");
    assert.equal(
      resolvesInDist(refs[0].ref),
      false,
      `the asset gate cannot fire — it accepts ${refs[0].ref}`,
    );
  }

  // NEAR-MISS NEGATIVE control — the SAME shapes, pointing at things that do
  // exist, are not reported. Without this the test above would pass on an
  // extractor that called everything broken.
  const realIcon = '<link rel="shortcut icon" href="/agent-skills/favicon.svg" type="image/svg+xml"/>';
  const realPage = '<img src="/agent-skills/plugins/okf-authoring/okf-author/" alt="x">';
  for (const html of [realIcon, realPage]) {
    const refs = assetRefsIn(html);
    assert.equal(refs.length, 1);
    assert.equal(resolvesInDist(refs[0].ref), true, `the asset gate false-positives on ${refs[0].ref}`);
  }

  // And the reason this finding survived a phase: the anchor extractor is
  // structurally blind to both shapes. This assertion is the regression test
  // for the GAP, not for the favicon.
  assert.deepEqual(hrefsIn(missingIcon), [], "hrefsIn should still be anchors-only");
  assert.deepEqual(hrefsIn(missingImage), [], "hrefsIn should still be anchors-only");
});

test("0 dangling anchors: every in-page fragment names an id that exists", async () => {
  const pages = await distContentPages();
  const byRoute = new Map(pages.map((p) => [`/${p.route}/`.replace(/\/+$/, "/"), p.html]));
  const dangling = [];
  for (const p of pages) {
    for (const href of hrefsIn(p.html)) {
      if (isExternal(href) || !toSitePath(href).includes("#")) continue;
      const [path, frag] = toSitePath(href).split("#");
      if (!frag || frag === "top") continue;
      const targetRoute = path === "" ? `/${p.route}/` : path.slice(BASE.length) || "/";
      const html = path === "" ? p.html : byRoute.get(targetRoute);
      if (!html) continue; // cross-page target; the resolver test above covers it
      if (!idsIn(html).has(decodeURIComponent(frag))) {
        dangling.push(`${p.route} -> ${href}`);
      }
    }
  }
  assert.deepEqual(dangling, [], `dangling anchors:\n${dangling.join("\n")}`);
});

test("0 dangling anchors control: the id index really is populated and can miss", async () => {
  const pages = await distContentPages();
  const page = pages.find((p) => p.route === `plugins/${PLUGIN}/okf-author`);
  const ids = idsIn(page.html);
  // The in-page link at source line 20 targets this heading; it is the reason
  // the check above is not vacuous.
  assert.ok(ids.has("cli-is-opportunistic-never-required"), "expected heading id missing");
  assert.equal(ids.has("an-id-nobody-emitted"), false);
});

test("off-site links point at the real repository, at a pinned ref", async () => {
  // The blob/tree links the loader mints for scripts/ and assets/ are the one
  // place the site sends a reader off-site. They must be shaped correctly, and
  // must not be silently pointing at some other repo.
  const pages = await distContentPages();
  const gh = [];
  for (const p of pages) {
    for (const href of hrefsIn(mainOf(p.html))) {
      if (href.startsWith("https://github.com/")) gh.push({ route: p.route, href });
    }
  }
  assert.ok(gh.length > 0, "no GitHub source links were rendered at all");

  // Every off-site link is either MINTED by the build (a source permalink,
  // which must point at this repository at the pinned ref) or PRESENT IN THE
  // PAGE'S OWN SOURCES (plugin.json's author.url and repository fields; a URL
  // written in a lifted README or CONTRIBUTING section), in which case it must
  // appear byte-identically and must not be invented. Nothing else is allowed.
  //
  // RE-POINTED IN PHASE 3, AND STRENGTHENED. The declared set used to be built
  // from ONE plugin's manifest and applied to every page, which at fan-out
  // would have let any plugin's URL excuse a link on any other plugin's page.
  // It is now resolved PER PAGE against `entitledSources()`, so a URL is
  // allowed only where its own source says it. That is what surfaced the new
  // case: https://github.com/vercel-labs/skills is on /about/install/ because
  // the README's install section links it, and on no other page.
  let minted = 0;
  let sourced = 0;
  // A MINTED link is one this build constructed: it points into THIS
  // repository, at a blob or tree. Phase 3 had to add the repository test to
  // that definition, because a blob URL is not by itself a sign the build made
  // it — plugins/agent-plugin-authoring's SKILL.md body links
  // github.com/agentplugins/agent-plugins-spec/blob/main/spec/1.0.0.md, which
  // is an author's citation of another project's file. It goes down the
  // source-attribution branch, where it is checked against the document that
  // wrote it. A genuinely misminted link — ours, wrong ref — still fails the
  // ref assertion, and a minted link at an unexpected repository now fails the
  // attribution branch instead, because no source of that page would contain
  // it.
  const OURS = "https://github.com/ghchinoy/agent-skills/";
  for (const { route, href } of gh) {
    if (href.startsWith(OURS) && /\/(blob|tree)\//.test(href)) {
      assert.match(
        href,
        /\/(blob|tree)\/main\//,
        `GitHub link is not a blob/tree at the pinned ref: ${href}`,
      );
      minted += 1;
      continue;
    }
    const bare = href.replace(/\/$/, "");
    const sources = await entitledSources(route);
    assert.ok(
      sources.some((s) => s.includes(bare)),
      `off-site link ${href} on /${route}/ is neither a minted source permalink nor a URL ` +
        `written in any source that page renders`,
    );
    sourced += 1;
  }
  // Both branches must have run, or one of them is untested.
  assert.ok(minted > 0, "no minted permalink was rendered — that branch is vacuous");
  assert.ok(sourced > 0, "no source-declared off-site link was rendered — that branch is vacuous");
  // The example-bundle DIRECTORY link is a /tree/ URL, not /blob/ — an I5
  // detail that is wrong in a way nothing else would catch.
  const bundle = gh.find(({ href }) => href.includes("example-bundle"));
  assert.ok(bundle, "the assets/example-bundle/ link was not rendered");
  assert.match(
    bundle.href,
    /\/tree\/main\/plugins\/okf-authoring\/skills\/okf-author\/assets\/example-bundle\/?$/,
  );
});

// ── helpers ─────────────────────────────────────────────────────────────────

/** NAVIGATION references: `<a href>` only. Deliberately narrow — see
 *  `assetRefsIn` for the other half. */
function hrefsIn(html) {
  return [...html.matchAll(/<a\b[^>]*?\shref="([^"]*)"/g)].map((m) => decodeAmp(m[1]));
}

/**
 * ASSET references: every `src=` on any element, plus `href=` on `<link>`.
 * Returned with the shape that produced them so a failure names it.
 *
 * `<a href>` is deliberately excluded so the two gates stay separately
 * nameable. `srcset=` does not match `\ssrc="` and is not covered; this site
 * emits none, and a covered-by-accident shape is not covered.
 */
function assetRefsIn(html) {
  const out = [];
  for (const m of html.matchAll(/<([a-zA-Z][\w-]*)\b[^>]*?\ssrc="([^"]*)"/g)) {
    out.push({ kind: `<${m[1].toLowerCase()} src>`, ref: decodeAmp(m[2]) });
  }
  for (const m of html.matchAll(/<link\b[^>]*?\shref="([^"]*)"/g)) {
    out.push({ kind: "<link href>", ref: decodeAmp(m[1]) });
  }
  return out;
}

function idsIn(html) {
  return new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
}

function decodeAmp(s) {
  return s.replace(/&amp;/g, "&");
}

/**
 * True when a reference points somewhere this suite cannot resolve.
 *
 * THIS FUNCTION USED TO TREAT EVERY ABSOLUTE URL AS EXTERNAL, and that is the
 * defect that let a broken reference sit in dist through a full green run. The
 * artifact hard-codes its own origin into `rel=canonical` on every page, so
 * `^https?:` matched them and this suite skipped the entire class of
 * SAME-ORIGIN ABSOLUTE references. Meanwhile the live checker's `classify()`
 * resolves them and fetches them. Local green, live red — and the divergence,
 * not the one link it hid, is the actual bug. See `toSitePath` below.
 */
function isExternal(href) {
  if (/^(mailto:|tel:|data:|javascript:)/i.test(href)) return true;
  if (/^\/\//.test(href)) return true; // protocol-relative: another origin
  if (!/^https?:/i.test(href)) return false; // relative or root-relative: ours
  try {
    return new URL(href).origin !== ORIGIN;
  } catch {
    return true;
  }
}

/**
 * An absolute same-origin reference, reduced to the site-absolute path the
 * resolver below understands. Anything else is returned unchanged.
 *
 * Kept separate from `isExternal` so the two questions stay separate: "is this
 * ours" and "where does it point". Folding them together is roughly how the
 * origin check went missing in the first place.
 */
function toSitePath(ref) {
  if (!/^https?:/i.test(ref)) return ref;
  try {
    const u = new URL(ref);
    return `${u.pathname}${u.hash}`;
  } catch {
    return ref;
  }
}

/**
 * The one reference on this site not required to resolve.
 *
 * THIS IS AN ADAPTER, NOT A COPY, and it used to be a copy. The local gate
 * speaks in dist-relative filenames and site-absolute paths; the live gate
 * speaks in absolute URLs. Reconciling those two vocabularies by writing the
 * rule out twice is how the two gates drift, and mutation proved it was already
 * happening: deleting the live checker's "the reference must BE the page's
 * canonical" clause left the whole suite green, because the only test of that
 * clause was exercising this copy instead. The copy was correct and the thing
 * it was standing in for was unguarded — the same defect this phase keeps
 * finding, arriving inside the fix for it.
 *
 * So there is one implementation, in scripts/check-live-links.mjs, and this
 * translates. BASE and ORIGIN are still the suite's own duplicated constants,
 * passed in, so the deliberate drift check on the VALUES survives: what is
 * shared is the decision, not the numbers it is made about.
 */
function isErrorDocCanonical(fromFile, path, html) {
  return (
    errorDocExemption(`${ORIGIN}${path}`, html, `${ORIGIN}${BASE}/${fromFile}`, {
      origin: ORIGIN,
      base: BASE,
    }) !== null
  );
}

/** True when a site-absolute path corresponds to something actually built:
 *  either a file at that exact path, or a directory with an index.html. */
function resolvesInDist(path) {
  const relPath = path.slice(BASE.length).replace(/^\/+/, "").replace(/\/+$/, "");
  const target = relPath === "" ? dist : join(dist, normalize(relPath));
  if (!target.startsWith(dist)) return false; // a ../ escape is a broken link
  let st;
  try {
    st = statSync(target);
  } catch {
    return false;
  }
  if (st.isDirectory()) return existsSync(join(target, "index.html"));
  return st.isFile();
}

/** The page body only — excludes the masthead, sidebar and search UI, whose
 *  links belong to Starlight rather than to the content under test. */
function mainOf(html) {
  const m = html.match(/<main\b[\s\S]*?<\/main>/i);
  return m ? m[0] : html;
}

// ── U1: the class this suite could not see ─────────────────────────────────
//
// THESE TWO TESTS WERE WRITTEN DURING THE U1 FIX AND NEVER LANDED. The patch
// script that appended them exited early on an unrelated import mismatch, the
// import was fixed by hand, and the append was never re-run. Every suite run
// afterwards was green, because what was missing was the CONTROL and not the
// fix: `isExternal` was correctly origin-aware the whole time and nothing
// asserted it. Reverting it to the broken form left the suite green, which is
// how this was found — by mutation, from a committed baseline, not by reading.
// The fix-round lesson generalises past this file: A PARTIALLY APPLIED PATCH
// LEAVES THE CODE LOOKING FINISHED AND THE EVIDENCE MISSING.

test("CONTROL: an absolute same-origin reference to an unbuilt route is caught", () => {
  // THE POINT OF THIS TEST IS THAT IT DOES NOT USE THE 404 PAGE. The only real
  // instance of this class in the artifact is the error document's canonical,
  // and that is exempted by name a few lines above — so proving the class fix
  // through the 404 case alone would leave an exemption carved exactly where
  // the evidence used to be, and no way to tell the fix still worked.
  const unbuilt = `${ORIGIN}${BASE}/no-such-route-synthetic-control/`;
  const built = `${ORIGIN}${BASE}/plugins/${PLUGIN}/`;

  // The assertion that was false before the fix: isExternal returned true for
  // both of these, so this suite skipped the entire class.
  assert.equal(isExternal(unbuilt), false, "a same-origin absolute URL is not external");
  assert.equal(isExternal(built), false);

  // ...and they reduce to paths the resolver can answer for.
  assert.equal(resolvesInDist(toSitePath(unbuilt)), false, "an unbuilt route must not resolve");
  assert.equal(resolvesInDist(toSitePath(built)), true, "a built route must resolve");

  // The exemption cannot swallow it: wrong file, wrong target, no canonical.
  const html = '<link rel="canonical" href="' + ORIGIN + BASE + '/404/"/>';
  assert.equal(isErrorDocCanonical("index.html", toSitePath(unbuilt), html), false);
  assert.equal(isErrorDocCanonical("404.html", toSitePath(unbuilt), html), false);

  // Genuinely external references stay external.
  assert.equal(isExternal("https://github.com/ghchinoy/agent-skills"), true);
  assert.equal(isExternal("//cdn.example.com/x.js"), true);
  assert.equal(isExternal("mailto:x@example.com"), true);
  assert.equal(isExternal(`${BASE}/x/`), false);
});

test("CONTROL: the error-document exemption is exactly one reference wide", async () => {
  const html = await read(join(dist, "404.html"));
  const target = `${BASE}/404/`;

  assert.equal(isErrorDocCanonical("404.html", target, html), true);

  // And on nothing else: not another page, not another target, and not when
  // the page's canonical says something different from the reference.
  assert.equal(isErrorDocCanonical("index.html", target, html), false);
  assert.equal(isErrorDocCanonical("404.html", `${BASE}/404`, html), false);
  assert.equal(isErrorDocCanonical("404.html", `${BASE}/plugins/`, html), false);
  assert.equal(
    isErrorDocCanonical("404.html", target, '<link rel="canonical" href="/elsewhere/"/>'),
    false,
    "the exemption fired on a page whose canonical is not the exempted URL",
  );

  // F1 — THE CASE THAT ISOLATES CLAUSE 2, AND THE REASON THIS TEST'S TITLE WAS
  // A PROMISE IT DID NOT KEEP.
  //
  // The exemption has three clauses: the page must be 404.html, the target must
  // be <base>/404/, and the reference must BE that page's own canonical. Review
  // deleted clause 2 and all 171 tests stayed green. Every wrong-target case
  // above passes HTML whose canonical is /404/, so clause 3 rejects them all
  // and clause 2 is never the reason for a single one — a control correct about
  // the cases it names and blind to the clause it is named after. Same defect
  // as everything else this phase, now inside the control written to prevent it.
  //
  // Isolating clause 2 requires the other two to be SATISFIED: the page is
  // 404.html, and the canonical genuinely equals the reference. The only thing
  // wrong is that the target is not <base>/404/. Without clause 2 this returns
  // true and a genuinely dangling canonical on the error document is absorbed
  // by the exemption while the run exits 0.
  const elsewhere = `${BASE}/plugins/`;
  assert.equal(
    isErrorDocCanonical(
      "404.html",
      elsewhere,
      `<link rel="canonical" href="${ORIGIN}${elsewhere}"/>`,
    ),
    false,
    "clause 2 is not doing anything: the error document exempted a self-consistent " +
      "canonical pointing somewhere other than <base>/404/, which is how a real " +
      "dangling canonical would get absorbed",
  );

  // ...and the same input with the target corrected IS exempt, which is what
  // makes the assertion above about clause 2 rather than about the page or the
  // canonical. Without this pair the case could pass for either of the other
  // two reasons and nobody would know which.
  assert.equal(
    isErrorDocCanonical("404.html", target, `<link rel="canonical" href="${ORIGIN}${target}"/>`),
    true,
    "the positive half of the clause-2 pair stopped holding",
  );

  // The artifact still declares what we think it declares. If Starlight ever
  // stops emitting this, the exemption should be deleted, not left lying about.
  assert.match(
    html,
    new RegExp(`rel="canonical"[^>]*href="${ORIGIN}${BASE}/404/"`),
    "dist/404.html no longer declares the canonical this exemption exists for",
  );
});

// ── SWEEP 2: the two gates must agree, and be shown to ─────────────────────

test("the local gate and the live gate classify the artifact's references identically", async () => {
  // WHY THIS EXISTS. `isExternal` and `toSitePath` above are a partial
  // reimplementation of the live checker's `classify()`. The exemption next to
  // them WAS a full reimplementation, and mutation showed the copy was absorbing
  // the only test coverage the original had; that one is now an adapter over the
  // real function. These two cannot be adapters as cheaply — `classify` answers
  // in absolute URLs against a page URL, and this suite resolves against the
  // filesystem — so the copies stay and this test is what holds them together.
  //
  // Stating the correspondence precisely, because "they agree" is not a
  // property until you say about what:
  //
  //   isExternal(ref) === true   <=>   classify(...).verdict === "offsite"
  //   and when internal, toSitePath(ref) names the same path+hash that
  //   classify resolved.
  //
  // Note what the second clause makes visible: "escapes" — same origin, outside
  // the base path — is INTERNAL to both, which is right. That is the classic
  // missing-base bug on project Pages, and it must resolve locally or fail, not
  // be waved through as somebody else's origin.
  //
  // THE CORPUS IS THE REAL ARTIFACT, not a hand-written list, so the agreement
  // is asserted over exactly the inputs that ship. Hand-written edge cases are
  // below, separately, because they are a different claim.
  const files = await distHtmlFiles();
  let compared = 0;

  for (const file of files) {
    const relPath = relative(dist, file).split("\\").join("/");
    const html = await read(file);
    const pageUrl = ORIGIN + liveUrlForFile(relPath, BASE);

    const refs = [...hrefsIn(html), ...[...assetRefsIn(html)].map((a) => a.ref)];
    for (const ref of refs) {
      // Both call sites guard the empty reference before asking either
      // question, so it is out of scope for the correspondence rather than a
      // disagreement. `isExternal("")` is false and `classify("")` says
      // offsite; neither is ever consulted.
      if (ref.trim() === "") continue;

      const c = classify(ref, { origin: ORIGIN, base: BASE }, pageUrl);
      compared += 1;

      assert.equal(
        isExternal(ref),
        c.verdict === "offsite",
        `the two gates disagree about ${ref} on ${relPath}: isExternal=${isExternal(ref)}, ` +
          `classify=${c.verdict}. One of them is skipping a reference the other checks.`,
      );

      if (c.verdict === "offsite") continue;
      const local = toSitePath(ref);
      const [path, frag = ""] = local.split("#");
      const expectedPath = new URL(c.url).pathname;
      // A relative reference is resolved by classify and left alone by
      // toSitePath, so compare only where toSitePath claims to have an answer:
      // absolute same-origin references, which are the class this whole fix is
      // about.
      if (/^https?:/i.test(ref)) {
        assert.equal(
          path,
          expectedPath,
          `the two gates resolve ${ref} differently: local=${path}, live=${expectedPath}`,
        );
        assert.equal(frag, c.fragment ?? "", `fragment mismatch on ${ref}`);
      }
    }
  }

  // The agreement is worthless if there was nothing to agree about. 100+ refs
  // is the artifact's own scale; the floor is deliberately far below it so this
  // fails on "the corpus vanished", not on ordinary content churn.
  assert.ok(compared >= 50, `only ${compared} references compared — the corpus is not the artifact`);
});

test("CONTROL: the agreement test can see a disagreement", () => {
  // The test above is a comparison, and a comparison between two things that
  // are both wrong in the same way passes. This is the assertion that it is
  // comparing at all: a deliberately weaker local gate — the ORIGINAL defect,
  // "anything absolute is external" — must disagree with classify on exactly
  // the class that defect hid.
  const wasBroken = (href) => /^(https?:|mailto:|tel:|data:|\/\/)/.test(href);
  const page = `${ORIGIN}${BASE}/index.html`;
  const selfRef = `${ORIGIN}${BASE}/plugins/${PLUGIN}/`;

  assert.equal(wasBroken(selfRef), true, "the old gate called a same-origin URL external");
  assert.equal(
    classify(selfRef, { origin: ORIGIN, base: BASE }, page).verdict,
    "check",
    "classify checks it",
  );
  // ...so the correspondence above is false under the old implementation, which
  // is what makes it a test rather than a restatement.
  assert.notEqual(wasBroken(selfRef), classify(selfRef, { origin: ORIGIN, base: BASE }, page).verdict === "offsite");

  // And the current implementation gets it right, which is the same claim the
  // corpus loop makes, asserted here on a single named input so a failure says
  // which one.
  assert.equal(isExternal(selfRef), false);
  assert.equal(classify(selfRef, { origin: ORIGIN, base: BASE }, page).verdict === "offsite", false);
});
