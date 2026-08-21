// live-check-e2e.test.mjs — the AC3 checker, run for real against a server we
// control and deliberately break.
//
// WHY THIS FILE EXISTS. Review found that the byte comparison inside
// check-live-links.mjs was a gate nothing asserted: REMOVING it entirely left
// the whole suite green. Its unit tests cover the pure decision-making —
// classification, URL mapping, hashing — and pure tests cannot notice when the
// code that CALLS them is deleted. Same class as the workflow findings: correct
// about the parts, silent about whether they are wired to anything.
//
// So this drives the real `runOnce` against a loopback server serving the real
// `dist`, and asserts that specific breakages produce specific failures. If a
// future change strips or weakens the comparison, the clean case still passes
// and these go red.
//
// The two axes review separated are asserted SEPARATELY here, because they are
// independent defects that happened to share a symptom:
//
//   AXIS 1, REACHABILITY — a file the deploy shipped is not served at all. Only
//   the artifact sweep can see this; the reference crawl never requests it.
//   Asserted by dropping an unreferenced file.
//
//   AXIS 2, SUFFICIENCY OF 200 — a file is served, returns 200, and is the
//   wrong bytes. Coverage does not touch this one: the file is fetched and
//   reachable. Asserted by serving same-length wrong content, which also
//   defeats the length comparison originally specified for this fix.
//
// NO EXTERNAL NETWORK. The server is 127.0.0.1 on an ephemeral port, so this is
// safe on a pull request alongside the offline tests.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { runOnce } from "../scripts/check-live-links.mjs";
import { BASE, dist, walk } from "./_helpers.mjs";

/** Enough of a static server to be honest about content types. get() decides
 *  text-vs-binary from the header, so getting these wrong would make HTML
 *  compare as an empty string and the whole file vacuous. */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".pf_meta": "application/octet-stream",
  ".pf_fragment": "application/octet-stream",
  ".pf_index": "application/octet-stream",
  ".txt": "text/plain; charset=utf-8",
};
const mimeFor = (p) => MIME[p.slice(p.lastIndexOf("."))] ?? "application/octet-stream";

/**
 * Serve `dist` at BASE, with optional sabotage.
 *
 * @param {(rel: string) => boolean} [opts.drop]    404 these files.
 * @param {(rel: string) => boolean} [opts.corrupt] serve these with the SAME
 *   number of bytes and different content.
 */
async function serveDist(opts = {}) {
  const files = await walk(dist);
  const byUrlPath = new Map();
  for (const abs of files) {
    const rel = relative(dist, abs).split("\\").join("/");
    byUrlPath.set(`${BASE}/${rel}`, { abs, rel });
  }

  const resolve = (pathname) => {
    // Directory routes: /agent-skills/ and /agent-skills/x/ serve index.html.
    if (pathname.endsWith("/")) return byUrlPath.get(`${pathname}index.html`);
    return byUrlPath.get(pathname);
  };

  const server = createServer(async (req, res) => {
    const { pathname } = new URL(req.url, "http://127.0.0.1");
    const hit = resolve(pathname);
    if (!hit || opts.drop?.(hit.rel)) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    let body = await readFile(hit.abs);
    if (opts.corrupt?.(hit.rel)) {
      // Same length, different bytes. A length check cannot tell these apart;
      // that is the point of the scenario.
      body = Buffer.from(body);
      body[0] = body[0] ^ 0xff;
    }
    res.writeHead(200, { "content-type": mimeFor(hit.rel) });
    res.end(body);
  });

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}${BASE}/`,
    close: () => new Promise((r) => server.close(r)),
  };
}

const run = async (opts) => {
  const srv = await serveDist(opts);
  try {
    return await runOnce({ liveUrl: srv.url, distDir: dist });
  } finally {
    await srv.close();
  }
};

/** A file the crawl DOES reference, and one it does not. Chosen from the real
 *  artifact rather than hard-coded, so a build change cannot make these tests
 *  quietly test nothing. */
async function pickTargets() {
  const rels = (await walk(dist)).map((f) => relative(dist, f).split("\\").join("/"));
  const unreferenced = rels.find((r) => r.startsWith("pagefind/") && r.endsWith(".js"));
  const asset = rels.find((r) => r.startsWith("_astro/") && r.endsWith(".css"));
  const page = rels.find((r) => r.endsWith("index.html"));
  assert.ok(unreferenced, "no pagefind JS in dist — the axis-1 scenario would test nothing");
  assert.ok(asset, "no _astro CSS in dist — the axis-2 scenario would test nothing");
  assert.ok(page, "no HTML in dist");
  return { unreferenced, asset, page };
}

test("the live checker passes against a server that serves the artifact correctly", async () => {
  // THE CONTROL FOR EVERY OTHER TEST HERE. Without it, a checker that failed
  // unconditionally would make all the breakage tests below pass.
  const { failures, stats } = await run();
  assert.deepEqual(failures, [], `clean serve should produce no failures:\n${failures.join("\n")}`);

  const total = (await walk(dist)).length;
  assert.equal(stats.artifactFiles, total, "the sweep did not consider every file in dist");
  assert.equal(stats.artifactVerified, total, "coverage is not complete against a correct server");
  assert.equal(stats.bytesIdentical, stats.distPages, "not every page was byte-compared");
  assert.ok(stats.urlsChecked > 0 && stats.livePagesFetched > 0);
});

test("AXIS 1: a shipped file that is never referenced and never served is caught", async () => {
  // The reference crawl cannot see this: nothing links to the pagefind bundle,
  // so before the artifact sweep existed this exact scenario — site search
  // completely dead — exited 0.
  const { unreferenced } = await pickTargets();
  const { failures, stats } = await run({ drop: (rel) => rel === unreferenced });

  const named = failures.filter((f) => f.includes(unreferenced));
  assert.ok(named.length > 0, `dropping ${unreferenced} produced no failure naming it`);
  assert.ok(
    named.some((f) => f.startsWith("ARTIFACT") && /HTTP 404/.test(f)),
    `expected an ARTIFACT 404 for ${unreferenced}, got:\n${named.join("\n")}`,
  );
  // Only the sweep can produce an ARTIFACT failure, so this is also the proof
  // that coverage — not the crawl — is what caught it.
  assert.equal(stats.artifactVerified, stats.artifactFiles - 1);
  assert.ok(
    failures.some((f) => f.startsWith("CONTROL:") && /artifact files verified/.test(f)),
    "the coverage control did not fire on an unverified file",
  );
});

test("AXIS 2: a shipped file served as 200 with the wrong bytes is caught", async () => {
  // Coverage does not touch this one. The file is requested, reachable, and
  // returns 200 — the CRITERION is what has to be strong enough. Same length as
  // the real file, so a length comparison passes it.
  const { asset } = await pickTargets();
  const { failures, stats } = await run({ corrupt: (rel) => rel === asset });

  const named = failures.filter((f) => f.includes(asset));
  assert.ok(named.length > 0, `serving ${asset} corrupted produced no failure naming it`);
  assert.ok(
    named.some((f) => f.startsWith("ARTIFACT") && /bytes differ/.test(f)),
    `expected an ARTIFACT byte-difference failure for ${asset}, got:\n${named.join("\n")}`,
  );
  assert.equal(stats.artifactVerified, stats.artifactFiles - 1);
});

test("AXIS 2 applies to the HTML pages too, not only the assets", async () => {
  // The freshness comparison on the 7 pages was likewise asserted by nothing —
  // removing it left the suite green. This is the red that stops that.
  const { page } = await pickTargets();
  const { failures } = await run({ corrupt: (rel) => rel === page });

  assert.ok(
    failures.some((f) => f.startsWith("STALE-OR-DIFFERENT")),
    `serving a modified ${page} produced no staleness failure:\n${failures.join("\n")}`,
  );
});

test("a server that answers 200 to everything cannot pass", async () => {
  // The negative control, end to end. If a host answers 200 for URLs that were
  // never built, every other 200 in the run is meaningless.
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<html><body>everything is fine</body></html>");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  try {
    const { failures } = await runOnce({
      liveUrl: `http://127.0.0.1:${port}${BASE}/`,
      distDir: dist,
    });
    assert.ok(
      failures.some((f) => f.startsWith("CONTROL:") && /never built/.test(f)),
      "the negative control did not fire against a server that 200s everything",
    );
  } finally {
    await new Promise((r) => server.close(r));
  }
});
