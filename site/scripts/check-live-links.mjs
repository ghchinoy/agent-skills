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

import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = join(here, "..");

/** The deployed URL of site A. Overridable with --url; docs.yml passes the URL
 *  the deploy step itself reported. */
export const DEFAULT_URL = "https://ghchinoy.github.io/agent-skills/";

/** Waits, in seconds, BEFORE attempts 2..N. Attempt 1 runs immediately.
 *  Total bounded wait: 250s of sleeping across 6 attempts. */
const ATTEMPT_DELAYS = [10, 20, 30, 60, 130];

/** Per-request timeout. A hang is a failure, not a wait forever. */
const FETCH_TIMEOUT_MS = 30_000;

/** A path under the base that must NOT exist. The 404 it produces is what
 *  proves the 200s elsewhere are load-bearing. */
export const NEGATIVE_CONTROL = "__no-such-page-negative-control__/";

// ── pure helpers (unit-tested in tests/live-links.test.mjs) ─────────────────

/** Minimal `--flag value` parsing. Unknown flags are an error, not ignored. */
export function parseArgs(argv) {
  const out = { url: DEFAULT_URL, dist: "dist", attempts: ATTEMPT_DELAYS.length + 1 };
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
      default:
        throw new Error(`unknown argument: ${argv[i]}`);
    }
    if (value === undefined) throw new Error(`${flag} needs a value`);
  }
  if (!out.url) throw new Error("--url must not be empty");
  if (!Number.isInteger(out.attempts) || out.attempts < 1) {
    throw new Error(`--attempts must be a positive integer, got ${out.attempts}`);
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
 * Every reference on a page that has to resolve, tagged with the shape that
 * produced it so a failure names it.
 *
 *  - `<a href>`      navigation — the half links.test.mjs originally covered
 *  - `src=`          any element — images, scripts, iframes
 *  - `<link href>`   stylesheets, the favicon, canonical, sitemap
 *
 * Kept deliberately identical in coverage to `hrefsIn` + `assetRefsIn` in
 * tests/links.test.mjs. A live check narrower than the local one would let a
 * whole class of breakage through while reporting green.
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
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "user-agent": "agent-skills-site-live-link-check" },
    });
    const isText = /^(text\/|application\/(xml|json|javascript))/.test(
      res.headers.get("content-type") ?? "",
    );
    return {
      ok: true,
      status: res.status,
      contentType: res.headers.get("content-type") ?? "",
      body: isText ? await res.text() : "",
      bytes: isText ? undefined : (await res.arrayBuffer()).byteLength,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

// ── the check itself ────────────────────────────────────────────────────────

/**
 * One full pass. Returns `{ failures, stats }`; the caller decides whether a
 * non-empty `failures` is fatal or merely means "try again in a minute".
 */
async function runOnce({ liveUrl, distDir }) {
  const { origin, base } = originAndBase(liveUrl);
  const failures = [];
  const stats = {
    distPages: 0,
    livePagesFetched: 0,
    bytesIdentical: 0,
    refsSeen: 0,
    urlsChecked: 0,
    fragmentsChecked: 0,
    offsiteSkipped: 0,
  };

  const files = await walk(distDir);
  const htmlFiles = files.filter((f) => f.endsWith(".html"));
  if (htmlFiles.length === 0) {
    failures.push(`no HTML files found in ${distDir} — nothing to check against`);
    return { failures, stats };
  }
  stats.distPages = htmlFiles.length;

  // Fetch each page ONCE and reuse it: it is both a page to verify and the
  // source of the references to verify.
  const fetched = new Map();
  const fetchCached = async (url) => {
    if (!fetched.has(url)) fetched.set(url, await get(url));
    return fetched.get(url);
  };

  // ── 1. every page the deployment should be serving, is ────────────────────
  const livePages = new Map(); // url -> html
  for (const file of htmlFiles) {
    const relPath = relative(distDir, file);
    const url = origin + routeForHtml(relPath, base);
    const res = await fetchCached(url);
    if (!res.ok) {
      failures.push(`UNREACHABLE ${url} (built as ${relPath}) — ${res.error}`);
      continue;
    }
    if (res.status !== 200) {
      failures.push(`HTTP ${res.status} ${url} (built as ${relPath})`);
      continue;
    }
    stats.livePagesFetched += 1;
    livePages.set(url, res.body);

    // Freshness. Byte-identical or the deployment is not this artifact.
    const expected = await readFile(file, "utf8");
    if (res.body === expected) stats.bytesIdentical += 1;
    else {
      failures.push(
        `STALE-OR-DIFFERENT ${url} — the live bytes differ from the deployed ` +
          `artifact (${expected.length} bytes built, ${res.body.length} served). ` +
          `Usually propagation lag; if it persists, the site being served is not this build.`,
      );
    }
  }

  // ── 2. every reference on every LIVE page resolves ────────────────────────
  for (const [pageUrl, html] of livePages) {
    for (const { kind, ref } of refsIn(html)) {
      stats.refsSeen += 1;
      const c = classify(ref, { origin, base }, pageUrl);
      if (c.verdict === "offsite") {
        stats.offsiteSkipped += 1;
        continue;
      }
      if (c.verdict === "escapes") {
        failures.push(`${pageUrl} -> ${kind} ${ref} — ${c.reason}`);
        continue;
      }
      if (c.verdict === "fragment") {
        stats.fragmentsChecked += 1;
        if (!idsIn(html).has(c.fragment)) {
          failures.push(`${pageUrl} -> ${kind} ${ref} — no element with id="${c.fragment}"`);
        }
        continue;
      }
      const res = await fetchCached(c.url);
      stats.urlsChecked += 1;
      if (!res.ok) {
        failures.push(`${pageUrl} -> ${kind} ${ref} — UNREACHABLE ${c.url}: ${res.error}`);
        continue;
      }
      if (res.status !== 200) {
        failures.push(`${pageUrl} -> ${kind} ${ref} — HTTP ${res.status} at ${c.url}`);
        continue;
      }
      if (c.fragment) {
        stats.fragmentsChecked += 1;
        if (!idsIn(res.body).has(c.fragment)) {
          failures.push(`${pageUrl} -> ${kind} ${ref} — no element with id="${c.fragment}" at ${c.url}`);
        }
      }
    }
  }

  // ── 3. controls ───────────────────────────────────────────────────────────
  // Without these a run that checked nothing, or a host that answers 200 to
  // everything, would both report success.
  if (stats.urlsChecked === 0) {
    failures.push("CONTROL: zero URLs were checked — the reference extractor matched nothing");
  }
  if (stats.livePagesFetched === 0) {
    failures.push("CONTROL: zero live pages were fetched");
  }
  const control = await get(`${origin}${base}/${NEGATIVE_CONTROL}`);
  if (!control.ok) {
    failures.push(`CONTROL: the negative-control request failed outright — ${control.error}`);
  } else if (control.status === 200) {
    failures.push(
      `CONTROL: ${origin}${base}/${NEGATIVE_CONTROL} returned 200. This URL was never built, ` +
        `so every other 200 in this run is meaningless — the check cannot fail.`,
    );
  }

  return { failures, stats };
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

  let last;
  for (let attempt = 1; attempt <= args.attempts; attempt += 1) {
    if (attempt > 1) {
      const wait = ATTEMPT_DELAYS[Math.min(attempt - 2, ATTEMPT_DELAYS.length - 1)];
      console.log(`\n-- attempt ${attempt - 1} had ${last.failures.length} failure(s); ` +
        `waiting ${wait}s for Pages propagation before attempt ${attempt} --`);
      await sleep(wait);
    }
    last = await runOnce({ liveUrl: args.url, distDir });
    console.log(
      `attempt ${attempt}: pages ${last.stats.livePagesFetched}/${last.stats.distPages} served, ` +
        `${last.stats.bytesIdentical} byte-identical, ${last.stats.urlsChecked} URLs checked, ` +
        `${last.stats.fragmentsChecked} fragments, ${last.stats.offsiteSkipped} off-site refs skipped, ` +
        `${last.failures.length} failure(s)`,
    );
    if (last.failures.length === 0) break;
  }

  console.log("");
  for (const [k, v] of Object.entries(last.stats)) console.log(`  ${k}: ${v}`);
  console.log("");

  if (last.failures.length > 0) {
    console.error(`FAIL: ${last.failures.length} problem(s) on the live deployment:`);
    for (const f of last.failures) console.error(`  - ${f}`);
    return 1;
  }
  console.log(
    `PASS: ${last.stats.urlsChecked} internal URLs and ${last.stats.livePagesFetched} pages ` +
      `resolve on the live deployment, all byte-identical to the deployed artifact.`,
  );
  return 0;
}

// Only run when executed directly, so the helpers above can be unit-tested.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main(process.argv.slice(2));
}
