#!/usr/bin/env node
// check-live-links.mjs — PHASE 2 ACCEPTANCE CRITERION 3.
//
//   "Every internal link and asset resolves under /agent-skills/ ON THE LIVE
//    DEPLOYMENT, not just in dist/."
//
// tests/links.test.mjs already proves this against the filesystem. That test
// cannot prove this criterion, and the difference is not pedantry: a base-path
// mistake, a file the Pages artifact dropped, a route GitHub serves differently
// from a local directory listing, all pass a filesystem walk and 404 in a
// browser. So this script fetches.
//
// THREE FAILURE MODES IT IS BUILT TO AVOID, all of which have precedent on this
// project:
//
//  1. A CHECK THAT RUNS TOO EARLY. Pages propagation is not instant. Reporting
//     a 404 that will be a 200 in forty seconds is a false red, and a
//     false red trains people to ignore the gate. Handled by `ATTEMPT_DELAYS`:
//     the whole check re-runs on a bounded schedule and only the last attempt's
//     failures are fatal.
//
//  2. A CHECK THAT CANNOT FIRE. A network error swallowed into a `continue`, or
//     a crawl that finds no URLs, both report success having verified nothing.
//     Handled three ways: every fetch failure is a recorded failure and never a
//     skip; the run asserts it checked a non-zero number of URLs and pages; and
//     a NEGATIVE CONTROL asserts a deliberately absent URL does NOT come back
//     200, which is what proves the 200s mean something.
//
//  3. A LIVE CHECK NARROWER THAN THE LOCAL ONE. links.test.mjs was widened in
//     review from `<a href>` to also cover `src=` and `<link href>`, after a
//     broken favicon reference on every page sat inside the gap for a phase.
//     `refsIn()` here covers the same three shapes on purpose, and
//     tests/live-links.test.mjs holds them to it.
//
//     The same mistake recurred one level up, and Phase 2 review caught it: a
//     crawl driven by page references only ever requests what a page mentions.
//     22 of the artifact's 39 files were never fetched — the whole `pagefind/`
//     search bundle, `sitemap-0.xml`, and two dynamically-imported `_astro`
//     chunks — so this script PASSED against a deployment whose search was
//     entirely dead, and against one serving every stylesheet as an empty 200.
//     AC3 says "every internal link AND ASSET", so the reference pass is now
//     followed by an ARTIFACT SWEEP: every file in dist/ must be served, and
//     match the deployed bytes. Coverage is asserted as a number — all 39 of
//     39, not "more than we used to".
//
// It also compares the live bytes to the deployed artifact. Without that, a
// green run proves some site is up, not that THIS build is the one being
// served — and a stale deployment is exactly the thing a link check would
// otherwise report as healthy.
//
// Usage:
//   node scripts/check-live-links.mjs --url https://ghchinoy.github.io/agent-skills/
//   node scripts/check-live-links.mjs --url <url> --dist dist --attempts 6
//
// Exit code 0 only when every check passed. Anything else — including "the site
// did not respond" — exits 1.

import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// The site's single source of truth for origin and base path. See DEFAULT_URL.
import { BASE as SITE_BASE, SITE } from "../src/site.config.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = join(here, "..");

/**
 * The deployed URL of site A. Overridable with --url; docs.yml passes the URL
 * the deploy step itself reported.
 *
 * F9. THIS WAS A HAND-WRITTEN LITERAL, and it was the single outlier among the
 * site URL's three mirrors. The other two — `ORIGIN` and `BASE` in
 * tests/_helpers.mjs — are duplicated ON PURPOSE, as an oracle independent of
 * the value under test, and they are closed transitively through the artifact:
 * links.test.mjs asserts the BUILT dist/404.html canonical against them, and
 * that canonical is emitted from `SITE`. So those two cannot drift from the
 * source without a test going red. **That design works and must not be
 * "fixed".**
 *
 * This one had no such path. Its only assertion compared it against another
 * hard-coded copy of the same string, and a test that checks a constant against
 * its own twin cannot see the pair drift together away from their source. The
 * tree already knows how to couple constants — `node-version` to
 * `engines.node`, the checker's budget to the job timeout — so this was a
 * demonstrated internal inconsistency rather than a general absence of
 * checking, which is what makes it worth one import rather than an argument.
 *
 * Note the direction: this is PRODUCTION code, so it reads the single source of
 * truth. The duplicated copies live in the TESTS, where independence is the
 * point. Composing here does not weaken the oracle; it gives the oracle
 * something real to check, because live-links.test.mjs now compares a derived
 * value against independent literals rather than one literal against another.
 */
export const DEFAULT_URL = `${SITE}${SITE_BASE}/`;

/** Waits, in seconds, BEFORE attempts 2..N. Attempt 1 runs immediately.
 *  Total bounded wait: 250s of sleeping across 6 attempts. */
const ATTEMPT_DELAYS = [10, 20, 30, 60, 130];

/** Per-request timeout. A hang is a failure, not a wait forever. */
const FETCH_TIMEOUT_MS = 30_000;

/**
 * Overall wall-clock budget for the whole check, retries included.
 *
 * Per-request timeouts alone do not bound the run: against a server that
 * accepts connections and never answers, 39-odd sequential requests × 30s × 6
 * attempts is most of an hour of a runner holding the `pages` concurrency
 * group. `docs.yml` sets `timeout-minutes` as a backstop, but a job killed by
 * the runner prints no diagnosis. This budget makes the script bail on its own
 * and SAY SO, which is the difference between a failure and a mystery.
 */
const TOTAL_BUDGET_MS = 15 * 60_000;

/**
 * How many requests are in flight at once.
 *
 * The artifact sweep took the run from 8 requests per attempt to 39, and
 * SEQUENTIALLY that is a 3.3x blow-up of the worst case, not an increment: 39 x
 * 30s x 6 attempts plus the retry sleeps is over an hour of a runner holding
 * the `pages` concurrency group. The happy path was never the problem — a
 * measured 0.131s per request is about 3 seconds for the whole sweep. It is the
 * unreachable-host case that scales, and it scales with the request COUNT.
 *
 * Pooling fixes the worst case rather than capping it: 8 at a time puts the
 * doubled coverage BELOW the old sequential runtime. Each pass prefetches its
 * distinct URLs through the pool and then evaluates them from cache, so the
 * concurrency buys latency and nothing else — every verdict is still computed
 * in artifact order, and the failure list is byte-identical to what the
 * sequential version produced.
 */
const CONCURRENCY = 8;

/** Set once in main(); Infinity keeps the helpers usable from unit tests. */
let deadlineAt = Infinity;
const remainingMs = () => deadlineAt - Date.now();

/**
 * The budget ACTUALLY IN FORCE, for the diagnostics that report it.
 *
 * F6. Three messages used to interpolate `TOTAL_BUDGET_MS / 60_000` — the
 * DEFAULT — while the deadline itself came from `args.deadlineMinutes`. Pass
 * `--deadline-minutes 5` and the run would stop correctly at five minutes and
 * announce a fifteen-minute budget. Latent in CI, because docs.yml never passes
 * the flag; the reason it is still worth fixing is that the flag exists for the
 * operator debugging a stuck deploy by hand, which is exactly the moment a
 * message that misstates the rule it just enforced does the most damage.
 *
 * Same shape as the F2 fix below and the same remedy: one value, set once,
 * every reader taking it from there rather than re-deriving it.
 */
let budgetMs = TOTAL_BUDGET_MS;
const budgetMinutes = () => budgetMs / 60_000;

/** A path under the base that must NOT exist. The 404 it produces is what
 *  proves the 200s elsewhere are load-bearing. */
export const NEGATIVE_CONTROL = "__no-such-page-negative-control__/";

// ── pure helpers (unit-tested in tests/live-links.test.mjs) ─────────────────

/** Minimal `--flag value` parsing. Unknown flags are an error, not ignored. */
export function parseArgs(argv) {
  const out = {
    url: DEFAULT_URL,
    dist: "dist",
    attempts: ATTEMPT_DELAYS.length + 1,
    deadlineMinutes: TOTAL_BUDGET_MS / 60_000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].split(/=(.*)/s);
    const value = inline !== undefined ? inline : argv[++i];
    switch (flag) {
      case "--url":
        out.url = value;
        break;
      case "--dist":
        out.dist = value;
        break;
      case "--attempts":
        out.attempts = Number(value);
        break;
      case "--deadline-minutes":
        out.deadlineMinutes = Number(value);
        break;
      default:
        throw new Error(`unknown argument: ${argv[i]}`);
    }
    if (value === undefined) throw new Error(`${flag} needs a value`);
  }
  if (!out.url) throw new Error("--url must not be empty");
  if (!Number.isInteger(out.attempts) || out.attempts < 1) {
    throw new Error(`--attempts must be a positive integer, got ${out.attempts}`);
  }
  if (!(out.deadlineMinutes > 0)) {
    throw new Error(`--deadline-minutes must be positive, got ${out.deadlineMinutes}`);
  }
  return out;
}

/**
 * The origin and base path implied by the live URL.
 * `https://ghchinoy.github.io/agent-skills/` -> origin + "/agent-skills".
 *
 * Derived from the URL rather than imported from src/site.config.mjs on
 * purpose: this script's job is to check what was PUBLISHED, and reading the
 * expected answer out of the source it is checking is how a test agrees with
 * itself. The base it derives is tied back to the build by the byte comparison.
 */
export function originAndBase(liveUrl) {
  const u = new URL(liveUrl);
  const base = u.pathname.replace(/\/+$/, "");
  return { origin: u.origin, base };
}

/** dist-relative HTML path -> the live path that should serve it. */
export function routeForHtml(relPath, base) {
  const p = relPath.split("\\").join("/");
  if (p === "index.html") return `${base}/`;
  if (p.endsWith("/index.html")) return `${base}/${p.slice(0, -"index.html".length)}`;
  return `${base}/${p}`;
}

/**
 * ANY dist-relative path -> the live path that should serve it.
 *
 * HTML goes through `routeForHtml` (directory routes, not `/index.html`);
 * everything else is served at its own path. Used by the artifact sweep, which
 * is the part that does not care what the pages happen to reference.
 */
export function liveUrlForFile(relPath, base) {
  const p = relPath.split("\\").join("/");
  return p.endsWith(".html") ? routeForHtml(p, base) : `${base}/${p}`;
}

/**
 * How long this request may take: the per-request cap, or whatever is left of
 * the overall budget, whichever is smaller. `0` means the budget is spent and
 * the caller must not issue the request at all.
 */
export function requestTimeoutMs(budgetLeft, cap = FETCH_TIMEOUT_MS) {
  if (!Number.isFinite(budgetLeft)) return cap;
  if (budgetLeft <= 0) return 0;
  return Math.min(cap, budgetLeft);
}

/**
 * Did following redirects take us somewhere that should have failed?
 *
 * `get()` follows redirects and records only the FINAL status, so an internal
 * link that 3xx-hops out of `/agent-skills/` — or off the origin entirely —
 * would otherwise be recorded as a clean 200. `classify()` runs on the AUTHORED
 * reference, before any hop, so it cannot see this on its own.
 *
 * Returns null when the hop is fine (no redirect, or a redirect that stays
 * inside the base), or a reason string naming what it left.
 */
export function redirectVerdict(requestedUrl, finalUrl, { origin, base }) {
  if (!finalUrl || finalUrl === requestedUrl) return null;
  let u;
  try {
    u = new URL(finalUrl);
  } catch {
    return `redirected to an unparseable URL (${finalUrl})`;
  }
  if (u.origin !== origin) return `redirected off-origin to ${finalUrl}`;
  if (u.pathname !== base && !u.pathname.startsWith(`${base}/`)) {
    return `redirected outside the base path ${base} to ${finalUrl}`;
  }
  return null;
}

/**
 * Every reference on a page that has to resolve, tagged with the shape that
 * produced it so a failure names it.
 *
 *  - `<a href>`      navigation — the half links.test.mjs originally covered
 *  - `src=`          any element — images, scripts, iframes
 *  - `<link href>`   stylesheets, the favicon, canonical, sitemap
 *
 * Kept deliberately identical in coverage to `hrefsIn` + `assetRefsIn` in
 * tests/links.test.mjs. A live check narrower than the local one would let a
 * whole class of breakage through while reporting green — and the local one
 * being narrower is exactly the defect that produced the exemption below.
 */
export function refsIn(html) {
  const out = [];
  for (const m of html.matchAll(/<a\b[^>]*?\shref="([^"]*)"/g)) {
    out.push({ kind: "<a href>", ref: decodeAmp(m[1]) });
  }
  for (const m of html.matchAll(/<([a-zA-Z][\w-]*)\b[^>]*?\ssrc="([^"]*)"/g)) {
    out.push({ kind: `<${m[1].toLowerCase()} src>`, ref: decodeAmp(m[2]) });
  }
  for (const m of html.matchAll(/<link\b[^>]*?\shref="([^"]*)"/g)) {
    out.push({ kind: "<link href>", ref: decodeAmp(m[1]) });
  }
  return out;
}

/** The page's `rel=canonical` href, or "". Attribute order varies by emitter,
 *  so both orders are matched rather than the one Astro happens to produce. */
export function canonicalOf(html) {
  const m =
    /<link\b[^>]*\srel="canonical"[^>]*\shref="([^"]*)"/.exec(html) ??
    /<link\b[^>]*\shref="([^"]*)"[^>]*\srel="canonical"/.exec(html);
  return m ? decodeAmp(m[1]) : "";
}

/**
 * THE ONE REFERENCE ON THIS SITE THAT IS NOT REQUIRED TO RESOLVE, and the
 * reasoning is narrow on purpose.
 *
 * Starlight's built-in 404 page emits `rel=canonical` pointing at
 * `<base>/404/`. Nothing is built at `404/` — the error document is emitted as
 * `404.html` — and GitHub Pages does not resolve `/foo/` to `foo.html`, so that
 * URL returns 404 on the live site and always will. The crawl reaches it
 * because Pages serves `404.html` itself at 200.
 *
 * Why this is an exemption and not a bug to fix here: a `rel=canonical` is an
 * identity DECLARATION, not a resource. No browser ever fetches it, so it is
 * not what "every internal link and asset resolves" is about. And the error
 * document has no canonical location by nature — Pages serves it AT every URL
 * that does not exist. Correcting the tag means either emitting a synthetic
 * entry from the content loader, which risks the exhaustive route enumeration
 * AC2 depends on, or overriding Starlight's Head component. Both are larger and
 * riskier than the tag is worth; the oddity is recorded in the phase report as
 * a site defect rather than silently accommodated.
 *
 * THE NARROWNESS IS THE POINT. All three of page, rel and target must match, so
 * this cannot quietly become "404 pages are not checked" or "canonicals are not
 * checked". Exemptions are COUNTED and reported, and a run that exempts more
 * than one reference fails.
 */
export function errorDocExemption(ref, html, pageUrl, { origin, base }) {
  if (pageUrl !== `${origin}${base}/404.html`) return null;
  if (ref !== `${origin}${base}/404/`) return null;
  // Derived from the document rather than asserted about it: this reference is
  // exempt because it IS the page's canonical, not because it looks like one.
  if (canonicalOf(html) !== ref) return null;
  return "the error document's canonical, which names a route Pages cannot serve";
}

/** Every `id="..."` on a page, for fragment resolution. */
export function idsIn(html) {
  return new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
}

function decodeAmp(s) {
  return s.replace(/&amp;/g, "&");
}

/**
 * What to do with one reference found on the page at `pageUrl`.
 *
 *   { verdict: "check",    url, fragment }  fetch it; it must return 200
 *   { verdict: "fragment", url, fragment }  same page, check the id only
 *   { verdict: "offsite" }                  another origin; counted, not fetched
 *   { verdict: "escapes",  url }            same origin, OUTSIDE the base path —
 *                                           a FAILURE, not a skip: on project
 *                                           Pages that is the classic
 *                                           missing-base bug, and it may still
 *                                           200 because some other project's
 *                                           site is served there.
 *
 * A same-origin absolute URL (Starlight emits `<link rel="canonical">` as one)
 * is internal and IS checked. Treating "starts with https://" as external would
 * silently drop it.
 */
export function classify(ref, { origin, base }, pageUrl) {
  const trimmed = ref.trim();
  if (trimmed === "") return { verdict: "offsite", reason: "empty" };
  if (/^(mailto:|tel:|data:|javascript:)/i.test(trimmed)) {
    return { verdict: "offsite", reason: "non-http scheme" };
  }
  let resolved;
  try {
    resolved = new URL(trimmed, pageUrl);
  } catch {
    return { verdict: "escapes", url: trimmed, reason: "unparseable reference" };
  }
  if (resolved.origin !== origin) return { verdict: "offsite", reason: resolved.origin };

  const fragment = resolved.hash ? decodeURIComponent(resolved.hash.slice(1)) : "";
  const url = `${resolved.origin}${resolved.pathname}${resolved.search}`;
  if (resolved.pathname !== base && !resolved.pathname.startsWith(`${base}/`)) {
    return { verdict: "escapes", url, reason: `outside the base path ${base}` };
  }
  const samePage = url === pageUrl.split("#")[0];
  if (samePage && fragment) return { verdict: "fragment", url, fragment };
  return { verdict: "check", url, fragment };
}

// ── fs + network ────────────────────────────────────────────────────────────

async function walk(dir) {
  const out = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

/**
 * One GET. Never throws: a transport error comes back as `{ ok: false, error }`
 * so the caller records it as a failure. Swallowing it into a skip is the
 * "gate that cannot fire" shape this script is written against.
 */
async function get(url) {
  const timeout = requestTimeoutMs(remainingMs());
  if (timeout === 0) {
    return {
      ok: false,
      error: `the check's ${budgetMinutes()}-minute overall budget ran out before this request`,
    };
  }
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(timeout),
      headers: { "user-agent": "agent-skills-site-live-link-check" },
    });
    const isText = /^(text\/|application\/(xml|json|javascript))/.test(
      res.headers.get("content-type") ?? "",
    );
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      ok: true,
      status: res.status,
      contentType: res.headers.get("content-type") ?? "",
      // Where we ENDED UP. Compared against where we asked for, so a redirect
      // chain out of the base path is a failure rather than an invisible 200.
      finalUrl: res.url,
      body: isText ? buf.toString("utf8") : "",
      bytes: buf.length,
      // Hashed for EVERY response, text or binary. See the artifact sweep: a
      // length comparison cannot tell a wasm blob from a same-sized error page.
      digest: sha256(buf),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

/**
 * Memoise `getFn(url)` in `cache`, storing the PROMISE rather than the result.
 *
 * Writing this as `cache.set(url, await getFn(url))` puts an await between the
 * has() and the set(). Sequentially there is no interleaving point, so it
 * dedupes perfectly and is not a bug — until the calls are pooled, at which
 * point every concurrent caller for the same URL sees has() false and issues
 * its own request. It degrades silently: nothing fails, the counters stay
 * plausible, and the only evidence is server-side. It would also cost the
 * coverage claim its denominator, which is measured by counting server hits.
 *
 * THE REJECTION GUARD IS THE REASON THIS IS A SEPARATE, EXPORTED FUNCTION.
 * Caching a promise memoises its rejection for the life of the run, so one
 * transport blip would be replayed to every later caller for that URL. `get()`
 * is written never to throw and that has been measured, but a cache whose
 * correctness depends on an invariant of a DIFFERENT function is one edit above
 * a try block away from being wrong. Converting here makes the dedupe correct
 * on its own terms — and pulling it out of the closure is what makes the guard
 * REACHABLE FROM A TEST. Left inline it was unfalsifiable: a synthetic throw
 * lands inside get()'s own try, so the promise never rejects and removing this
 * catch changed nothing observable. An untestable safeguard is indistinguishable
 * from an absent one.
 */
export function cacheThrough(cache, url, getFn) {
  if (!cache.has(url)) {
    cache.set(
      url,
      (async () => getFn(url))().catch((err) => ({
        ok: false,
        error: `request threw: ${err instanceof Error ? err.message : String(err)}`,
      })),
    );
  }
  return cache.get(url);
}

/**
 * Run `fn` over `items`, at most `limit` at a time.
 *
 * THIS FUNCTION NEVER PRODUCES A VERDICT, and that is a design constraint
 * rather than an accident. Callers pool the FETCHING and then evaluate the
 * results in artifact order, sequentially. Two problems that a concurrent
 * checker normally has are therefore structurally absent rather than mitigated:
 *
 *   Promise.all vs allSettled. A batch that aborts on the first rejection turns
 *   six broken assets into one reported failure — a worse instrument than a
 *   slow one. Here nothing is reported from inside the pool, so a lost
 *   in-flight error cannot lose a finding: the URL is simply re-awaited at its
 *   evaluation site, from the same cached promise, and reported there. The
 *   swallow below is what makes that true, and the sort-order guarantee too.
 *
 *   Determinism. A pool destroys the order results ARRIVE in. It cannot touch
 *   the order they are READ in. Sorting the failure list afterwards would also
 *   fix the symptom, at the cost of the page-by-page grouping that makes the
 *   output readable; evaluating in source order keeps both. Asserted by
 *   tests/live-check-e2e.test.mjs, which runs a multi-failure scenario twice
 *   and requires the two failure arrays to be identical.
 */
async function pooled(items, limit, fn) {
  const iter = items[Symbol.iterator]();
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const next = iter.next();
      if (next.done) return;
      // Deliberately swallowed: see above. The result is cached either way and
      // the caller decides what it means.
      await Promise.resolve(fn(next.value)).catch(() => {});
    }
  });
  // allSettled, not all: the workers already convert their own rejections, and
  // this is the second layer. One worker dying must not cancel the batch —
  // N findings collapsing into one is a worse instrument than a slow one.
  await Promise.allSettled(workers);
}

/** Content hash of a Buffer. Exported so the sweep's comparison is testable. */
export function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

// ── the check itself ────────────────────────────────────────────────────────

/**
 * Findings in reporting order, given `{ key, msg }` records.
 *
 * THERE IS NO TIEBREAKER, DELIBERATELY. An earlier version carried a raise-time
 * counter for equal keys. It was unreachable — every loop iteration raises at
 * most one finding, so keys are unique — and an unreachable branch is only
 * harmless while it stays unreachable. The day an ordinary edit raises two
 * findings in one iteration, that counter goes live and reintroduces
 * completion-order dependence in the exact place this design exists to remove
 * it, silently, while looking like the design handling the case. Mutation
 * confirmed it was dead: replacing it with Math.random() left the suite green.
 *
 * The premise is asserted instead. A duplicate key means the premise has broken
 * and that is worth hearing about, not papering over with a value that depends
 * on scheduling.
 *
 * EXPORTED SO THE ASSERTION IS REACHABLE. Left inside runOnce it was the same
 * defect one level up: deleting the uniqueness check changed nothing observable,
 * because nothing in the real run produces a duplicate key. A guard that cannot
 * be made to fire is indistinguishable from an absent one, so it is tested
 * directly with records the real passes cannot currently produce.
 */
export function orderFindings(raised) {
  const seen = new Set();
  for (const r of raised) {
    const k = r.key.join(".");
    if (seen.has(k)) {
      throw new Error(
        `two findings share order key ${k} — reporting order would depend on ` +
          `completion order. Give the second one its own position in the key.`,
      );
    }
    seen.add(k);
  }
  return [...raised]
    .sort((a, b) => {
      for (let i = 0; i < Math.max(a.key.length, b.key.length); i += 1) {
        const d = (a.key[i] ?? -1) - (b.key[i] ?? -1);
        if (d !== 0) return d;
      }
      return 0;
    })
    .map((r) => r.msg);
}

/**
 * One full pass. Returns `{ failures, stats }`; the caller decides whether a
 * non-empty `failures` is fatal or merely means "try again in a minute".
 */
/**
 * One full pass. Exported so tests/live-check-e2e.test.mjs can drive it against
 * a loopback server: review found that REMOVING the byte comparison left the
 * whole suite green, so the comparison needs a test that goes red when it is
 * stripped, and only running the real thing against a deliberately-wrong server
 * can establish that.
 */
export async function runOnce({ liveUrl, distDir }) {
  const { origin, base } = originAndBase(liveUrl);
  // FINDINGS CARRY AN EXPLICIT ORDER KEY, ASSIGNED WHERE THEY ARE RAISED, and
  // the list is sorted by it before it is returned.
  //
  // The pool destroys the order results ARRIVE in. Evaluating in artifact order
  // after prefetching means nothing is currently reported from inside a pooled
  // callback, so push order is already deterministic — but that is an invariant
  // of how the three passes happen to be written today, and the failure mode if
  // someone breaks it is a list that silently reshuffles between attempts.
  // Attempts are diffed against each other; a reshuffling list makes "did this
  // change since the last attempt" unanswerable.
  //
  // Keying by (pass, position within pass) rather than sorting the strings
  // alphabetically keeps each page's findings together and the artifact sweep
  // in artifact order, which is what makes the output readable, while making
  // the order independent of WHEN anything completed.
  const raised = [];
  const fail = (key, msg) => {
    raised.push({ key, msg });
    return msg;
  };
  const report = () => orderFindings(raised);
  // Failures that CANNOT become green by waiting, because they are computed
  // from the artifact rather than from an answer the server gave. Retrying
  // these spends the full propagation schedule — 250 seconds of sleeping — to
  // print the identical list six times.
  const deterministic = new Set();
  const stats = {
    distPages: 0,
    livePagesFetched: 0,
    bytesIdentical: 0,
    refsSeen: 0,
    // REFERENCE OCCURRENCES that were resolved, which is NOT the number of HTTP
    // requests: the same stylesheet referenced from all 7 pages is 7 here and 1
    // on the wire. This counter used to be called `urlsChecked`, and every
    // person sizing this job — including its own author — read the resulting 99
    // as 99 requests when the run makes 19. A counter whose name overstates it
    // fivefold is a measurement defect, not a naming preference.
    refsResolved: 0,
    // DISTINCT HTTP requests actually issued. The number that governs runtime.
    httpRequests: 0,
    fragmentsChecked: 0,
    offsiteSkipped: 0,
    // References deliberately not required to resolve. See errorDocExemption:
    // this is expected to be exactly 1, and a control fails if it grows.
    exemptions: 0,
    // The artifact sweep. `artifactFiles` is every file the deploy shipped;
    // `artifactVerified` must equal it, and the gap is a failure, not a note.
    artifactFiles: 0,
    artifactVerified: 0,
  };

  // F2. ONE construction site for the result, so no return path can omit part
  // of the contract. The early return below used to be `{ failures, stats }`,
  // and `main` dereferences `last.deterministic.has(...)` — so on an empty dist
  // the process died with `Cannot read properties of undefined (reading 'has')`
  // and threw away the diagnostic written for precisely that case.
  //
  // The gate did not fail open: exit was still 1, so a crash still blocked the
  // deploy. What was lost was the explanation, on the one failure mode where an
  // operator most needs it — an empty dist means the artifact hand-off produced
  // nothing, which is the exact condition the three `site/dist` assertions in
  // docs.yml exist to guard. They got a Node stack trace instead of
  // "no HTML files found ... nothing to check against".
  //
  // A second identifier would have fixed the instance. A single construction
  // site fixes the class: divergence between return paths is now not
  // expressible, rather than merely tested for.
  const result = () => ({ failures: report(), stats, deterministic });

  const files = await walk(distDir);
  const htmlFiles = files.filter((f) => f.endsWith(".html"));
  if (htmlFiles.length === 0) {
    // F2b — FOUND BY THE F2 CONTROL, NOT BY THE F2 REVIEW. The empty-dist
    // failure was never registered as deterministic, so `main` treated "the
    // artifact contains no HTML" as a condition that might resolve itself and
    // sat through the full six-attempt propagation schedule — 250 seconds of
    // sleeping — re-walking a directory that cannot gain files while we wait.
    // Exit was still 1, so this cost time and not correctness, but it is the
    // most certainly-final failure the script can raise and it was the one
    // failure class treated as possibly transient.
    deterministic.add(
      fail([0, 0], `no HTML files found in ${distDir} — nothing to check against`),
    );
    return result();
  }
  stats.distPages = htmlFiles.length;

  // Fetch each page ONCE and reuse it: it is both a page to verify and the
  // source of the references to verify.
  // Caches the PROMISE, not the result, so pooled callers racing for the same
  // URL still make exactly one request. `fetched.size` is therefore the honest
  // count of distinct requests this run issued.
  const fetched = new Map();
  const fetchCached = (url) => cacheThrough(fetched, url, get);
  /** Warm the cache for a set of URLs, 8 at a time. */
  const prefetch = (urls) => pooled([...new Set(urls)], CONCURRENCY, (u) => fetchCached(u));

  // URLs whose CONTENT has been confirmed against the artifact, and URLs that
  // have already been named in a failure. The artifact sweep needs both: a 200
  // recorded by the reference pass proves the file EXISTS, not that it is the
  // file we deployed, and re-reporting a 404 that pass 1 already named would
  // just make one broken page look like two.
  const verifiedUrls = new Set();
  const reportedUrls = new Set();

  // ── 1. every page the deployment should be serving, is ────────────────────
  const livePages = new Map(); // url -> html
  const pageTargets = htmlFiles.map((file) => {
    const relPath = relative(distDir, file);
    return { file, relPath, url: origin + routeForHtml(relPath, base) };
  });
  await prefetch(pageTargets.map((t) => t.url));

  for (const [pageIndex, { file, relPath, url }] of pageTargets.entries()) {
    const res = await fetchCached(url);
    if (!res.ok) {
      fail([1, pageIndex], `UNREACHABLE ${url} (built as ${relPath}) — ${res.error}`);
      reportedUrls.add(url);
      continue;
    }
    if (res.status !== 200) {
      fail([1, pageIndex], `HTTP ${res.status} ${url} (built as ${relPath})`);
      reportedUrls.add(url);
      continue;
    }
    const hop = redirectVerdict(url, res.finalUrl, { origin, base });
    if (hop) {
      fail([1, pageIndex], `${url} (built as ${relPath}) — ${hop}`);
      reportedUrls.add(url);
      continue;
    }
    stats.livePagesFetched += 1;
    livePages.set(url, res.body);

    // Freshness. Byte-identical or the deployment is not this artifact.
    const expected = await readFile(file, "utf8");
    if (res.body === expected) {
      stats.bytesIdentical += 1;
      verifiedUrls.add(url);
    } else {
      reportedUrls.add(url);
      fail(
        [1, pageIndex],
        `STALE-OR-DIFFERENT ${url} — the live bytes differ from the deployed ` +
          `artifact (${expected.length} bytes built, ${res.body.length} served). ` +
          `Usually propagation lag; if it persists, the site being served is not this build.`,
      );
    }
  }

  // ── 2. every reference on every LIVE page resolves ────────────────────────
  // Collected first so the distinct URLs can be fetched through the pool, then
  // evaluated in source order. Same verdicts, same order, fewer round trips.
  const refWork = [];
  for (const [pageUrl, html] of livePages) {
    for (const r of refsIn(html)) refWork.push({ pageUrl, html, ...r });
  }
  // EACH REFERENCE IS DECIDED ONCE, and the prefetch and the evaluation read
  // the SAME decision.
  //
  // These were two separate calls to classify() — one inside the prefetch
  // filter, one in the loop below — and the exemption was applied only in the
  // loop. The exemption therefore suppressed the VERDICT and not the REQUEST:
  // the run still fetched the error document's canonical, ignored the answer,
  // and reported a distinct-request count one higher than its own
  // classification implied. Nothing failed, which is the point — it was
  // visible only by counting hits on the server and diffing them against the
  // artifact. Two spellings of one decision drift; one spelling cannot.
  const decided = refWork.map((w) => {
    const c = classify(w.ref, { origin, base }, w.pageUrl);
    return { ...w, c, exempt: c.verdict === "check" && errorDocExemption(c.url, w.html, w.pageUrl, { origin, base }) };
  });
  await prefetch(
    decided.filter((d) => d.c.verdict === "check" && !d.exempt).map((d) => d.c.url),
  );

  for (const [refIndex, { pageUrl, kind, ref, c, exempt }] of decided.entries()) {
    const html = livePages.get(pageUrl);
    stats.refsSeen += 1;
    if (c.verdict === "offsite") {
      stats.offsiteSkipped += 1;
      continue;
    }
    // Narrow, counted, and reported. Not a silent skip.
    if (exempt) {
      stats.exemptions += 1;
      continue;
    }
    if (c.verdict === "escapes") {
      const msg = fail([2, refIndex], `${pageUrl} -> ${kind} ${ref} — ${c.reason}`);
      deterministic.add(msg);
      continue;
    }
    if (c.verdict === "fragment") {
      stats.fragmentsChecked += 1;
      if (!idsIn(html).has(c.fragment)) {
        fail([2, refIndex], `${pageUrl} -> ${kind} ${ref} — no element with id="${c.fragment}"`);
      }
      continue;
    }
    const res = await fetchCached(c.url);
    stats.refsResolved += 1;
    if (!res.ok) {
      fail([2, refIndex], `${pageUrl} -> ${kind} ${ref} — UNREACHABLE ${c.url}: ${res.error}`);
      reportedUrls.add(c.url);
      continue;
    }
    if (res.status !== 200) {
      fail([2, refIndex], `${pageUrl} -> ${kind} ${ref} — HTTP ${res.status} at ${c.url}`);
      reportedUrls.add(c.url);
      continue;
    }
    const hop = redirectVerdict(c.url, res.finalUrl, { origin, base });
    if (hop) {
      fail([2, refIndex], `${pageUrl} -> ${kind} ${ref} — ${hop}`);
      reportedUrls.add(c.url);
      continue;
    }
    if (c.fragment) {
      stats.fragmentsChecked += 1;
      if (!idsIn(res.body).has(c.fragment)) {
        fail([2, refIndex], `${pageUrl} -> ${kind} ${ref} — no element with id="${c.fragment}" at ${c.url}`);
      }
    }
  }

  // ── 3. EVERY file the deploy shipped is actually served, and matches ──────
  //
  // The pass above is reference-driven, so it only ever sees what a page links
  // to. This one is artifact-driven and does not care: it walks dist/ and
  // requires each file to be served at its own URL with the deployed bytes.
  // That is what closes "site search is completely dead" and "every stylesheet
  // is an empty 200" — both of which the reference pass reported as PASS.
  //
  // A file the reference pass already fetched is NOT thereby verified. That
  // pass checks pages byte-for-byte but only checks assets for a 200 — so the
  // first version of this sweep skipped every referenced stylesheet and still
  // passed the "every .css served as an empty 200" scenario, catching only the
  // unreferenced ones. Only a completed CONTENT comparison counts here.
  stats.artifactFiles = files.length;
  const sweepTargets = files.map((file) => {
    const relPath = relative(distDir, file).split("\\").join("/");
    return { file, relPath, url: origin + liveUrlForFile(relPath, base) };
  });
  // 39 requests sequentially against a dead host is the runtime problem U2
  // identified. Pooled, and still evaluated in artifact order below.
  await prefetch(sweepTargets.filter((t) => !reportedUrls.has(t.url)).map((t) => t.url));

  for (const [fileIndex, { file, relPath, url }] of sweepTargets.entries()) {
    const expected = await readFile(file);

    if (verifiedUrls.has(url)) {
      stats.artifactVerified += 1;
      continue;
    }
    if (reportedUrls.has(url)) {
      // Already named in a failure above. Not verified, but not worth saying
      // twice — one broken file should not read as two.
      continue;
    }

    const res = await fetchCached(url);
    if (!res.ok) {
      fail([3, fileIndex], `ARTIFACT ${relPath} — UNREACHABLE ${url}: ${res.error}`);
      continue;
    }
    if (res.status !== 200) {
      fail(
        [3, fileIndex],
        `ARTIFACT ${relPath} — HTTP ${res.status} at ${url}. The deploy shipped this file ` +
          `and the live site does not serve it.`,
      );
      continue;
    }
    const hop = redirectVerdict(url, res.finalUrl, { origin, base });
    if (hop) {
      fail([3, fileIndex], `ARTIFACT ${relPath} — ${hop}`);
      continue;
    }
    // HASH, not length. The brief specified "200 plus a length match"; a length
    // match is weaker than the byte-identity this same script already demands
    // of every HTML page above, and two different standards in one file invites
    // the question of which is the real gate. A same-length wrong file — a CDN
    // error body, a truncated asset padded by an intermediary, a stale build of
    // the same file — passes a length check and fails this one.
    //
    // TWO SPELLINGS, ONE CRITERION, DELIBERATELY. The HTML pass above compares
    // utf8 STRINGS; this compares sha256 of raw BYTES. Both are full byte
    // identity and they agree on every verdict — the difference is that this
    // pass also covers binaries, where there is no meaningful string to compare.
    // The HTML path was left as it is rather than churned for symmetry. This
    // note exists so the next reader does not mistake the duplication for the
    // two-standards problem it was written to remove: the standard is the same
    // for all 39 files, and applying it to only 7 was the actual defect.
    if (res.digest !== sha256(expected)) {
      fail(
        [3, fileIndex],
        `ARTIFACT ${relPath} — served at ${url} but the bytes differ from the deployed file ` +
          `(${expected.length} bytes deployed, ${res.bytes} served). A 200 with the wrong ` +
          `content is a file that is present and broken.`,
      );
      continue;
    }
    verifiedUrls.add(url);
    stats.artifactVerified += 1;
  }

  // ── 4. controls ───────────────────────────────────────────────────────────
  // Without these a run that checked nothing, or a host that answers 200 to
  // everything, would both report success.
  //
  // The negative control is issued FIRST, so that every request this run can
  // make has been made before any counter is read or asserted on. Reading
  // httpRequests before it made the zero-requests control assert on a figure
  // the run had not finished producing.
  const control = await fetchCached(`${origin}${base}/${NEGATIVE_CONTROL}`);
  stats.httpRequests = fetched.size;

  if (stats.refsResolved === 0) {
    fail([4, 0], "CONTROL: zero references were resolved — the reference extractor matched nothing");
  }
  if (stats.httpRequests === 0) {
    fail([4, 1], "CONTROL: zero HTTP requests were issued — this run checked nothing");
  }
  // The exemption is allowed to exist and is NOT allowed to spread.
  if (stats.exemptions > 1) {
    fail(
      [4, 2],
      `CONTROL: ${stats.exemptions} references were exempted from resolving. Exactly one ` +
        `is expected (the error document's canonical) — the exemption has widened.`,
    );
  }
  if (stats.livePagesFetched === 0) {
    fail([4, 3], "CONTROL: zero live pages were fetched");
  }
  // COVERAGE, as a number rather than a hope. Anything the deploy shipped that
  // this run did not verify is named individually, so "39 of 39" cannot quietly
  // become "17 of 39" again the next time an asset stops being referenced.
  if (stats.artifactVerified !== stats.artifactFiles) {
    fail(
      [4, 4],
      `CONTROL: ${stats.artifactVerified} of ${stats.artifactFiles} artifact files verified — ` +
        `${stats.artifactFiles - stats.artifactVerified} shipped file(s) were not confirmed served`,
    );
  }
  // The negative control is a REAL request and is counted like one. A runtime
  // figure that quietly omits a request is the U3 defect in miniature: this
  // reported 40 against 41 on the wire until a counting server caught it.
  if (!control.ok) {
    fail([4, 5], `CONTROL: the negative-control request failed outright — ${control.error}`);
  } else if (control.status === 200) {
    fail(
      [4, 6],
      `CONTROL: ${origin}${base}/${NEGATIVE_CONTROL} returned 200. This URL was never built, ` +
        `so every other 200 in this run is meaningless — the check cannot fail.`,
    );
  }

  return result();
}

/**
 * The PASS line, DERIVED from the counters.
 *
 * The previous version was hand-written: "99 internal URLs and 7 pages resolve
 * ... all byte-identical to the deployed artifact". 99 were checked and 7 were
 * byte-compared, and the word "all" attached to both — the tool over-claiming
 * about itself, in the line that lands in the CI log AS AC3's evidence. §12
 * binds evidence output, not only rendered pages.
 *
 * The fix is not a truer sentence. A sentence that happens to match today's
 * numbers is the same defect one release later: correct about the instance,
 * silent about the class. So every number here comes from a stat, and the SCOPE
 * WORDS ARE COMPUTED — "all" appears only when verified === files, and a run
 * that compares fewer files than it ships says so by construction, without
 * anyone remembering to update this text.
 */
export function summaryLine(stats) {
  const claims = [];

  if (stats.artifactFiles === 0) {
    claims.push("NO deployed files were compared");
  } else if (stats.artifactVerified === stats.artifactFiles) {
    claims.push(
      `all ${stats.artifactFiles} deployed files are served byte-identical to the artifact`,
    );
  } else {
    claims.push(
      `${stats.artifactVerified} of ${stats.artifactFiles} deployed files are served ` +
        `byte-identical to the artifact ` +
        `(${stats.artifactFiles - stats.artifactVerified} NOT byte-compared)`,
    );
  }

  // A reference check is a STATUS check. That is a weaker claim than byte
  // identity and gets its own clause and its own verb, so the two can never
  // again be collapsed under one "all".
  //
  // Both numbers, both named. Occurrences and requests differ by 5x here, and
  // reporting only the larger one is how "99 URLs checked" came to mean 19.
  claims.push(
    `${stats.refsResolved} internal reference occurrence(s) resolve ` +
      `(${stats.httpRequests} distinct HTTP request(s))`,
  );
  if (stats.exemptions > 0) {
    claims.push(`${stats.exemptions} reference(s) exempted by name`);
  }

  // Conditional clauses, so a zero is never reported as a checked zero.
  if (stats.fragmentsChecked > 0) {
    claims.push(`${stats.fragmentsChecked} fragment(s) resolve to an element on the target page`);
  }
  if (stats.offsiteSkipped > 0) {
    claims.push(`${stats.offsiteSkipped} off-site reference(s) were NOT checked`);
  }

  return `PASS: ${claims.join("; ")}.`;
}

async function main(argv) {
  const args = parseArgs(argv);
  const distDir = join(siteRoot, args.dist);
  try {
    if (!(await stat(distDir)).isDirectory()) throw new Error("not a directory");
  } catch (err) {
    console.error(`FAIL: --dist ${distDir} is not readable (${err.message}).`);
    console.error("The live check compares the served bytes against the deployed artifact and");
    console.error("cannot run without it. This is a failure, not a skip.");
    return 1;
  }

  console.log(`live URL : ${args.url}`);
  console.log(`artifact : ${distDir}`);

  budgetMs = args.deadlineMinutes * 60_000;
  deadlineAt = Date.now() + budgetMs;

  let last;
  for (let attempt = 1; attempt <= args.attempts; attempt += 1) {
    if (attempt > 1) {
      const wait = ATTEMPT_DELAYS[Math.min(attempt - 2, ATTEMPT_DELAYS.length - 1)];
      // Do not start a wait we cannot afford to finish, and do not start an
      // attempt with no time to run it in. Stopping early with the last
      // attempt's failures is a report; being killed by the job timeout is not.
      if (remainingMs() < wait * 1000 + 30_000) {
        console.log(
          `\n-- stopping after attempt ${attempt - 1}: ${Math.round(remainingMs() / 1000)}s left of ` +
            `the ${budgetMinutes()}-minute budget, not enough for another attempt --`,
        );
        break;
      }
      console.log(`\n-- attempt ${attempt - 1} had ${last.failures.length} failure(s); ` +
        `waiting ${wait}s for Pages propagation before attempt ${attempt} --`);
      await sleep(wait);
    }
    last = await runOnce({ liveUrl: args.url, distDir });
    console.log(
      `attempt ${attempt}: pages ${last.stats.livePagesFetched}/${last.stats.distPages} served, ` +
        `${last.stats.bytesIdentical} byte-identical, ${last.stats.refsResolved} refs resolved ` +
        `in ${last.stats.httpRequests} requests, ` +
        `${last.stats.fragmentsChecked} fragments, ${last.stats.offsiteSkipped} off-site refs skipped, ` +
        `${last.stats.artifactVerified}/${last.stats.artifactFiles} artifact files verified, ` +
        `${last.failures.length} failure(s)`,
    );
    if (last.failures.length === 0) break;

    // Every remaining failure is one that waiting cannot fix. Propagation is
    // the only reason to retry, and none of these are propagation.
    if (last.failures.every((f) => last.deterministic.has(f))) {
      console.log(
        `-- every failure is a build-side problem that retrying cannot change; ` +
          `stopping after attempt ${attempt} instead of waiting out the schedule --`,
      );
      break;
    }
  }

  console.log("");
  for (const [k, v] of Object.entries(last.stats)) console.log(`  ${k}: ${v}`);
  console.log("");

  if (last.failures.length > 0) {
    console.error(`FAIL: ${last.failures.length} problem(s) on the live deployment:`);
    for (const f of last.failures) console.error(`  - ${f}`);
    return 1;
  }
  console.log(summaryLine(last.stats));
  return 0;
}

// Only run when executed directly, so the helpers above can be unit-tested.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main(process.argv.slice(2));
}
