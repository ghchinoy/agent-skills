#!/usr/bin/env node
// check-blob-links.mjs — PHASE 4 ACCEPTANCE CRITERION 5.
//
//   "All 12 script blob links return 200."
//
// A status code is not a property of this repository, so no test in tests/ can
// establish it. tests/resources.test.mjs proves the SET: exactly the scripts on
// disk are linked, each at a distinct blob URL ending in its real filename.
// That is everything the filesystem can say. Whether GitHub serves those URLs
// is a question only a request answers, and this script asks it.
//
// The split follows check-live-links.mjs, and for the same reason: the
// DECISION-MAKING lives in a function the offline suite imports and tests, and
// what is left here is fetching, retrying and reporting. `blobTargets()` below
// is the function tests/resources.test.mjs calls, so the URLs this script
// requests are provably the URLs that suite asserted — not a second derivation
// that could drift from the first.
//
// TWO FAILURE MODES IT IS BUILT TO AVOID:
//
//  1. A CHECK THAT CANNOT FIRE. "All 12 returned 200" is consistent with a
//     runner that returns 200 for everything, and with one that requested
//     nothing at all. So the run asserts it found a non-zero number of URLs,
//     every fetch failure is a recorded failure and never a skip, and a
//     NEGATIVE CONTROL requests a path fabricated inside a REAL skill
//     directory. If that comes back 200, the 200s above mean nothing and this
//     script exits 1 having found no broken link.
//
//  2. AN OFF-SITE URL THE LOCAL CHECKER DELIBERATELY SKIPS. check-live-links
//     classifies off-site references as counted-not-fetched, on purpose: the
//     live check is about the deployment, and it must not go red because
//     github.com had a bad minute. These blob URLs sit exactly in that gap,
//     which is why AC5 exists at all and why this is a separate script with its
//     own exit code rather than a widening of that one.
//
// Usage:
//   node scripts/check-blob-links.mjs
//   node scripts/check-blob-links.mjs --dist dist --attempts 3
//
// Exit code 0 only when every derived URL returned 200 AND every negative
// control did not. Anything else — including "github.com did not respond" —
// exits 1.

import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = join(here, "..");

/** Every `.html` under `dir`, at any depth. */
async function htmlFiles(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await htmlFiles(p)));
    else if (e.name.endsWith(".html")) out.push(p);
  }
  return out;
}

/**
 * The script blob URLs the BUILT SITE links, derived from the built HTML.
 *
 * DERIVED FROM dist/, NOT FROM THE LOADER AND NOT FROM A LIST. The criterion is
 * about links a reader can click, so the population is the rows a reader is
 * served. A URL the loader computed and the template dropped is not a link, and
 * must not be requested here — a green run over URLs nobody can reach would be
 * the exact false assurance this script exists to refuse.
 *
 * Keyed on the `data-resource-group="scripts"` block and the
 * `data-resource-name` rows inside it, which is how EntryMeta.astro makes a
 * resource row addressable. A row without an href yields `url: null` and is
 * reported as a failure rather than filtered away.
 *
 * @param {string} distDir
 * @returns {Promise<{page: string, name: string, url: string|null}[]>}
 */
export async function blobTargets(distDir) {
  const out = [];
  for (const file of await htmlFiles(distDir)) {
    const html = await readFile(file, "utf8");
    const page = file.slice(distDir.length + 1);
    // Each resource group is one <div data-resource-group="…">…</div>. Matched
    // non-greedily so two groups on one page stay separate.
    for (const block of html.matchAll(
      /<div\b[^>]*\bdata-resource-group="scripts"[^>]*>([\s\S]*?)<\/div>/g,
    )) {
      for (const row of block[1].matchAll(
        /<li\b[^>]*\bdata-resource-name="([^"]*)"[^>]*>([\s\S]*?)<\/li>/g,
      )) {
        const href = /href="([^"]*)"/.exec(row[2]);
        out.push({ page, name: row[1], url: href ? href[1] : null });
      }
    }
  }
  return out.sort((a, b) => (a.url ?? "" < (b.url ?? "") ? -1 : 1));
}

/**
 * Requests fabricated siblings of the real URLs — the negative control.
 *
 * Built by MUTATING A URL THAT IS ABOUT TO BE ASSERTED 200, rather than by
 * writing a plausible-looking URL by hand. A hand-written control tests a URL
 * whose 404 may have nothing to do with the ones under test; this one differs
 * from a passing URL in the filename alone, so a 404 here and a 200 there is a
 * statement about the file and not about the host, the ref or the repository.
 */
export function negativeControlsFor(urls) {
  if (urls.length === 0) return [];
  const first = urls[0];
  return [
    // Same directory, a file that is not there.
    first.replace(/\/[^/]+$/, "/definitely-not-a-real-script-9f3c.sh"),
    // Same skill, the group AC7 says is empty of this file.
    first.replace(/\/scripts\/[^/]+$/, "/references/definitely-not-a-real-file-9f3c.yml"),
  ];
}

async function status(url, attempts) {
  let last = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      // GET, not HEAD: a host may answer HEAD from a cache or refuse it
      // outright, and a 405 on HEAD would read as a broken link.
      const res = await fetch(url, { redirect: "follow" });
      return res.status;
    } catch (err) {
      last = err;
      if (i + 1 < attempts) await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  // A network error is a FAILURE, never a skip. Returned as a string so it
  // cannot compare equal to 200 by accident.
  return `request failed: ${last?.message ?? "unknown"}`;
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? fallback : args[i + 1];
  };
  const distDir = join(siteRoot, arg("dist", "dist"));
  const attempts = Number(arg("attempts", "3"));

  const targets = await blobTargets(distDir);
  const failures = [];

  // THE SET, PRINTED. A count alone cannot show which file went missing.
  console.log(`derived ${targets.length} script blob links from ${distDir}:`);
  for (const t of targets) console.log(`  ${t.page}  ${t.name}  ${t.url ?? "(NO HREF)"}`);
  if (targets.length === 0) failures.push("no script blob links were derived — nothing was checked");

  const urls = [...new Set(targets.filter((t) => t.url).map((t) => t.url))];
  for (const t of targets) {
    if (!t.url) failures.push(`${t.page}: the row for ${t.name} has no href`);
  }

  console.log("\nrequesting:");
  for (const url of urls) {
    const code = await status(url, attempts);
    console.log(`  ${code}  ${url}`);
    if (code !== 200) failures.push(`${url} returned ${code}`);
  }

  console.log("\nnegative controls (a 200 here invalidates every 200 above):");
  for (const url of negativeControlsFor(urls)) {
    const code = await status(url, attempts);
    console.log(`  ${code}  ${url}`);
    if (code === 200) failures.push(`negative control ${url} returned 200`);
    if (typeof code === "string") failures.push(`negative control ${url}: ${code}`);
  }

  if (failures.length > 0) {
    console.error(`\nFAILED (${failures.length}):`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`\nOK — ${urls.length} script blob links returned 200, controls did not.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
