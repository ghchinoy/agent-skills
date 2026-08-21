// live-links.test.mjs — the pure half of the AC3 live checker.
//
// scripts/check-live-links.mjs is the only gate that can establish Phase 2's
// acceptance criterion 3, and it is the only gate in this repo that needs the
// network. That makes it the easiest one to get quietly wrong: a reference
// extractor that matches nothing, or a classifier that files every internal URL
// as "external, skip", both produce a confident PASS having checked nothing.
//
// So the decision-making is factored out of the network code and tested here,
// offline, with controls. What is left in the script is fetching, retrying and
// counting — and the script carries its own runtime controls for those: it
// fails if zero URLs were checked, and it fetches a URL that was never built
// and fails if the server answers 200.
//
// These tests do not hit the network and are safe on a pull request.

import { test } from "node:test";
import assert from "node:assert/strict";

import { relative } from "node:path";

import {
  DEFAULT_URL,
  NEGATIVE_CONTROL,
  classify,
  idsIn,
  liveUrlForFile,
  originAndBase,
  parseArgs,
  redirectVerdict,
  refsIn,
  requestTimeoutMs,
  routeForHtml,
  sha256,
  summaryLine,
} from "../scripts/check-live-links.mjs";
import { BASE, dist, distContentPages, walk } from "./_helpers.mjs";

const LIVE = { origin: "https://ghchinoy.github.io", base: "/agent-skills" };
const PAGE = "https://ghchinoy.github.io/agent-skills/plugins/okf-authoring/okf-author/";

test("the default URL is this site's, at the base the build uses", () => {
  const { origin, base } = originAndBase(DEFAULT_URL);
  assert.equal(base, BASE, "the checker's default URL does not carry the site's base path");
  assert.equal(origin, "https://ghchinoy.github.io");
  // A trailing slash on the URL must not become part of the base, or every
  // internal path would be compared against "/agent-skills/" and none would
  // match a page at "/agent-skills".
  assert.equal(originAndBase("https://x.test/a/b/").base, "/a/b");
  assert.equal(originAndBase("https://x.test/a/b").base, "/a/b");
  assert.equal(originAndBase("https://x.test/").base, "");
});

test("refsIn covers all three reference shapes the local gate covers", () => {
  // links.test.mjs was widened in review from `<a href>` to `src=` and
  // `<link href>` after a broken favicon on every page sat in that gap for a
  // phase. A live check narrower than the local one would be a regression, so
  // the coverage is asserted rather than intended.
  const html = [
    '<a href="/agent-skills/x/">nav</a>',
    '<img src="/agent-skills/i.png" alt="">',
    '<script src="/agent-skills/s.js"></script>',
    '<link rel="shortcut icon" href="/agent-skills/favicon.svg">',
  ].join("\n");
  assert.deepEqual(refsIn(html), [
    { kind: "<a href>", ref: "/agent-skills/x/" },
    { kind: "<img src>", ref: "/agent-skills/i.png" },
    { kind: "<script src>", ref: "/agent-skills/s.js" },
    { kind: "<link href>", ref: "/agent-skills/favicon.svg" },
  ]);
  // Entities decoded, so a query string is fetched as authored.
  assert.deepEqual(refsIn('<a href="/a?x=1&amp;y=2">q</a>'), [
    { kind: "<a href>", ref: "/a?x=1&y=2" },
  ]);
  // NEGATIVE control: the extractor is not simply matching every quoted string.
  assert.deepEqual(refsIn('<div class="href=/nope"><p>text</p></div>'), []);
  assert.deepEqual(refsIn("<a>no href at all</a>"), []);
});

test("refsIn is not vacuous: it finds all three shapes in the REAL built pages", async () => {
  // The unit test above proves the regexes work on markup I wrote. This proves
  // they work on the markup Starlight emits, which is the only markup that
  // matters. If a renderer upgrade changed the attribute order or quoting, the
  // fixture test would still pass and this one would not.
  const pages = await distContentPages();
  assert.ok(pages.length > 0, "no built pages — run `npm run build` first");
  const kinds = new Set();
  let total = 0;
  for (const p of pages) {
    for (const r of refsIn(p.html)) {
      kinds.add(r.kind.replace(/^<\w+ src>$/, "src"));
      total += 1;
    }
  }
  assert.ok(total > 20, `only ${total} references found across ${pages.length} pages`);
  assert.ok(kinds.has("<a href>"), "no anchors found in the built pages");
  assert.ok(kinds.has("<link href>"), "no <link href> found in the built pages");
  assert.ok(kinds.has("src"), "no src= found in the built pages");
});

test("classify: internal references are checked, whatever form they take", () => {
  // Site-absolute, the form this site emits.
  assert.deepEqual(classify("/agent-skills/x/", LIVE, PAGE), {
    verdict: "check",
    url: "https://ghchinoy.github.io/agent-skills/x/",
    fragment: "",
  });
  // Same-origin ABSOLUTE. Starlight emits `<link rel="canonical">` in this
  // form; a checker that treated "starts with https://" as external would drop
  // it silently, which is the whole class of bug this gate exists for.
  assert.deepEqual(classify(`${LIVE.origin}/agent-skills/y/`, LIVE, PAGE), {
    verdict: "check",
    url: "https://ghchinoy.github.io/agent-skills/y/",
    fragment: "",
  });
  // Relative, resolved against the page it was found on.
  assert.equal(classify("../okf-validate/", LIVE, PAGE).url,
    "https://ghchinoy.github.io/agent-skills/plugins/okf-authoring/okf-validate/");
  // A cross-page fragment is fetched AND its id checked.
  assert.deepEqual(classify("/agent-skills/z/#heading", LIVE, PAGE), {
    verdict: "check",
    url: "https://ghchinoy.github.io/agent-skills/z/",
    fragment: "heading",
  });
});

test("classify: off-site references are counted, not fetched", () => {
  for (const ref of [
    "https://github.com/ghchinoy/agent-skills",
    "https://agentskills.io/clients",
    "mailto:someone@example.test",
    "tel:+1000",
    "data:image/svg+xml,<svg/>",
    "",
  ]) {
    assert.equal(classify(ref, LIVE, PAGE).verdict, "offsite", `${ref} should be off-site`);
  }
});

test("classify: a same-page fragment is resolved against the page itself", () => {
  const c = classify("#cli-is-opportunistic-never-required", LIVE, PAGE);
  assert.equal(c.verdict, "fragment");
  assert.equal(c.fragment, "cli-is-opportunistic-never-required");
});

test("classify control: a reference that escapes the base path is a FAILURE, not a skip", () => {
  // The signature project-Pages bug: a hand-built URL missing the base prefix.
  // It must not be waved through, and it specifically must not be waved through
  // just because github.io answers 200 for some other project at that path.
  const c = classify("/plugins/okf-authoring/", LIVE, PAGE);
  assert.equal(c.verdict, "escapes");
  assert.match(c.reason, /outside the base path \/agent-skills/);
  // The near miss: a path that merely STARTS with the same letters is still
  // outside the base and must be caught.
  assert.equal(classify("/agent-skills-extra/x/", LIVE, PAGE).verdict, "escapes");
  // …while the base path itself, and anything under it, is fine.
  assert.equal(classify("/agent-skills", LIVE, PAGE).verdict, "check");
  assert.equal(classify("/agent-skills/", LIVE, PAGE).verdict, "check");
});

test("routeForHtml maps built files to the paths Pages serves them at", () => {
  assert.equal(routeForHtml("index.html", BASE), "/agent-skills/");
  assert.equal(routeForHtml("404.html", BASE), "/agent-skills/404.html");
  assert.equal(
    routeForHtml("plugins/okf-authoring/index.html", BASE),
    "/agent-skills/plugins/okf-authoring/",
  );
  // Windows separators, because `relative()` produces them there and a wrong
  // route would be reported as a 404 on the live site.
  assert.equal(routeForHtml("plugins\\okf-authoring\\index.html", BASE),
    "/agent-skills/plugins/okf-authoring/");
});

test("routeForHtml round-trips every page this build actually produced", async () => {
  const pages = await distContentPages();
  for (const p of pages) {
    const route = routeForHtml(p.rel, BASE);
    assert.equal(route, `${BASE}/${p.route}/`.replace(/\/+$/, "/"));
    assert.ok(route.startsWith(`${BASE}/`), `${p.rel} maps outside the base path`);
  }
});

test("idsIn finds the anchors the pages really declare", async () => {
  const pages = await distContentPages();
  const page = pages.find((p) => p.route.endsWith("okf-author"));
  const ids = idsIn(page.html);
  assert.ok(ids.has("cli-is-opportunistic-never-required"), "expected heading id missing");
  assert.equal(ids.has("an-id-nobody-emitted"), false);
});

test("parseArgs: defaults, overrides, and refusal", () => {
  assert.deepEqual(parseArgs([]), {
    url: DEFAULT_URL,
    dist: "dist",
    attempts: 6,
    deadlineMinutes: 15,
  });
  assert.equal(parseArgs(["--url", "https://x.test/y/"]).url, "https://x.test/y/");
  assert.equal(parseArgs(["--url=https://x.test/y/"]).url, "https://x.test/y/");
  assert.equal(parseArgs(["--dist", "other"]).dist, "other");
  assert.equal(parseArgs(["--attempts", "1"]).attempts, 1);
  // A typo in a flag must stop the run. Silently ignoring `--urll` would run
  // the whole check against the default URL and report a green that answers a
  // different question than the one asked.
  assert.throws(() => parseArgs(["--urll", "x"]), /unknown argument/);
  assert.throws(() => parseArgs(["--attempts", "0"]), /positive integer/);
  // The overall budget is settable, and has to stay inside the job timeout —
  // tests/workflows.test.mjs asserts the DEFAULT does. A run that asked for
  // zero minutes would report "out of budget" for every URL and call it a day.
  assert.equal(parseArgs(["--deadline-minutes", "3"]).deadlineMinutes, 3);
  assert.throws(() => parseArgs(["--deadline-minutes", "0"]), /must be positive/);
  assert.throws(() => parseArgs(["--deadline-minutes", "x"]), /must be positive/);
  assert.throws(() => parseArgs(["--url", ""]), /must not be empty/);
});

test("the negative control targets a path the build cannot produce", async () => {
  // The script's runtime control fetches this and fails if it returns 200. That
  // only means something if no page is ever built there.
  const pages = await distContentPages();
  assert.ok(NEGATIVE_CONTROL.length > 0);
  for (const p of pages) {
    assert.ok(
      !`${p.route}/`.includes(NEGATIVE_CONTROL),
      `a real page exists at the negative control path ${NEGATIVE_CONTROL}`,
    );
  }
});

// ── Fix round 1: the artifact sweep's pure parts ────────────────────────────

test("liveUrlForFile maps every shape in the artifact, not just the HTML", () => {
  // The reference crawl only ever requested what a page linked to, so 22 of the
  // artifact's 39 files were never fetched — the whole search bundle among them.
  // The sweep is artifact-driven instead, which means it needs a URL for file
  // shapes the crawl never had to think about.
  assert.equal(liveUrlForFile("index.html", BASE), `${BASE}/`);
  assert.equal(liveUrlForFile("plugins/index.html", BASE), `${BASE}/plugins/`);

  // Assets are served where they sit. No directory-route rewriting.
  assert.equal(liveUrlForFile("pagefind/pagefind.js", BASE), `${BASE}/pagefind/pagefind.js`);
  assert.equal(liveUrlForFile("sitemap-0.xml", BASE), `${BASE}/sitemap-0.xml`);
  assert.equal(liveUrlForFile("_astro/x.css", BASE), `${BASE}/_astro/x.css`);
  assert.equal(liveUrlForFile("favicon.svg", BASE), `${BASE}/favicon.svg`);

  // A file whose name merely CONTAINS .html is not an HTML route.
  assert.equal(liveUrlForFile("assets/a.html.js", BASE), `${BASE}/assets/a.html.js`);

  // Windows separators, since relative() is platform-dependent and a backslash
  // in a URL path is not a separator at all.
  assert.equal(liveUrlForFile("pagefind\\pagefind.js", BASE), `${BASE}/pagefind/pagefind.js`);
});

test("liveUrlForFile covers every file the build actually emits", async () => {
  // A mapping tested only against hand-written examples is tested against the
  // author's imagination. This walks the REAL dist and asserts the sweep can
  // address all of it — including the file types that caused the finding.
  const files = await walk(dist);
  assert.ok(files.length > 30, `dist has only ${files.length} files — did the build run?`);

  const urls = files.map((f) => liveUrlForFile(relative(dist, f).split("\\").join("/"), BASE));
  for (const u of urls) {
    assert.ok(u.startsWith(`${BASE}/`), `${u} is not under the base path`);
    assert.ok(!u.includes("\\"), `${u} contains a backslash`);
    assert.ok(!u.includes("//"), `${u} has a doubled slash`);
    assert.ok(!/index\.html$/.test(u), `${u} addresses index.html directly instead of its route`);
  }
  assert.equal(new Set(urls).size, urls.length, "two artifact files map to the same URL");

  // The specific blind spots, named. If the build stops emitting these the test
  // should be updated deliberately, not pass by silently covering nothing.
  assert.ok(urls.some((u) => u.includes("/pagefind/")), "no pagefind files in dist");
  assert.ok(urls.some((u) => u.endsWith(".xml")), "no sitemap in dist");
  assert.ok(urls.some((u) => u.endsWith(".js")), "no JS in dist");
});

test("sha256 distinguishes same-length content", () => {
  // Axis 2, in one assertion. The brief specified a LENGTH match; these two
  // buffers are the same length and are not the same file. A length check
  // cannot tell a corrupted asset from a correct one, and this same script
  // already demands full byte identity of every HTML page.
  const a = Buffer.from("body{color:red}");
  const b = Buffer.from("body{color:731}");
  assert.equal(a.length, b.length);
  assert.notEqual(sha256(a), sha256(b));

  // And it is stable, or the comparison would fail at random.
  assert.equal(sha256(a), sha256(Buffer.from("body{color:red}")));
  // An empty 200 — the corrupt-asset scenario — is not any real file.
  assert.notEqual(sha256(Buffer.alloc(0)), sha256(a));
});

test("redirectVerdict catches a hop that leaves the site", () => {
  const at = { origin: "https://ghchinoy.github.io", base: BASE };
  const url = `https://ghchinoy.github.io${BASE}/okf-validate/`;

  // No redirect, and a redirect that stays inside the base: both fine.
  assert.equal(redirectVerdict(url, url, at), null);
  assert.equal(redirectVerdict(url, `https://ghchinoy.github.io${BASE}/okf-validate`, at), null);
  assert.equal(redirectVerdict(url, undefined, at), null);

  // Off-origin, and off-base. get() follows redirects and records only the
  // FINAL status, so without this a link that 302s to a working page elsewhere
  // is an invisible 200.
  assert.match(redirectVerdict(url, "https://example.com/x", at), /off-origin/);
  assert.match(redirectVerdict(url, "https://ghchinoy.github.io/outside/", at), /outside the base/);

  // NEAR MISS: a sibling path that merely starts with the same characters is
  // NOT inside the base. A prefix test without the boundary would pass this.
  assert.match(
    redirectVerdict(url, "https://ghchinoy.github.io/agent-skills-extra/", at),
    /outside the base/,
  );
  // The base root itself is inside the base.
  assert.equal(redirectVerdict(url, `https://ghchinoy.github.io${BASE}`, at), null);

  assert.match(redirectVerdict(url, "not a url", at), /unparseable/);
});

test("requestTimeoutMs keeps every request inside the overall budget", () => {
  // 39 sequential requests × 30s × 6 attempts is most of an hour. The per-
  // request cap does not bound the run; this does.
  assert.equal(requestTimeoutMs(Infinity, 30_000), 30_000, "unbudgeted runs use the per-request cap");
  assert.equal(requestTimeoutMs(120_000, 30_000), 30_000, "plenty of budget left: use the cap");
  assert.equal(requestTimeoutMs(5_000, 30_000), 5_000, "less budget than the cap: use the budget");

  // CONTROL: exhausted must be exactly 0, which is the caller's signal to not
  // issue the request at all. A negative would become an instant-abort signal
  // and a confusing "timeout" failure instead of an honest "out of budget".
  assert.equal(requestTimeoutMs(0, 30_000), 0);
  assert.equal(requestTimeoutMs(-10_000, 30_000), 0);
});

// ── N1: the PASS line is derived, not written ──────────────────────────────

const STATS = {
  distPages: 7,
  livePagesFetched: 7,
  bytesIdentical: 7,
  refsSeen: 120,
  refsResolved: 106,
  httpRequests: 19,
  fragmentsChecked: 96,
  offsiteSkipped: 33,
  artifactFiles: 39,
  artifactVerified: 39,
};

test("the PASS line only says all when everything was actually compared", () => {
  // The old line read "99 internal URLs and 7 pages resolve ... all
  // byte-identical to the deployed artifact". 99 were status-checked and 7 were
  // byte-compared, and "all" attached to both. This line lands in the CI log AS
  // AC3's evidence, so the tool was over-claiming about itself.
  const full = summaryLine(STATS);
  assert.match(full, /all 39 deployed files are served byte-identical/);

  // The scope word is COMPUTED. One unverified file and "all" is gone, with the
  // shortfall named — no one has to remember to update a sentence.
  const short = summaryLine({ ...STATS, artifactVerified: 38 });
  assert.doesNotMatch(short, /\ball\b/);
  assert.match(short, /38 of 39/);
  assert.match(short, /1 NOT byte-compared/);

  // Nothing was compared at all: the strongest claim available is none.
  const none = summaryLine({ ...STATS, artifactFiles: 0, artifactVerified: 0 });
  assert.match(none, /NO deployed files were compared/);
  assert.doesNotMatch(none, /\ball\b/);
});

test("the PASS line keeps status checks and byte comparisons as separate claims", () => {
  const line = summaryLine(STATS);
  // The occurrences resolve. They are not claimed byte-identical, which was
  // the defect — and the DISTINCT REQUEST COUNT is stated alongside, because
  // reporting only the larger number is how "99 URLs checked" came to mean 19.
  assert.match(line, /106 internal reference occurrence\(s\) resolve/);
  assert.match(line, /19 distinct HTTP request/);
  assert.doesNotMatch(line, /all 106/);
  assert.doesNotMatch(line, /106[^.;]*byte-identical/);
  // Off-site references are reported as NOT checked rather than folded in.
  assert.match(line, /33 off-site reference\(s\) were NOT checked/);

  // A zero is never printed as a checked zero — the clause disappears, so a
  // stale "0 fragments" can never sit in the evidence line looking verified.
  const noFrags = summaryLine({ ...STATS, fragmentsChecked: 0, offsiteSkipped: 0 });
  assert.doesNotMatch(noFrags, /fragment/);
  assert.doesNotMatch(noFrags, /off-site/);
});

test("CONTROL: skewing any counter the PASS line reports changes the sentence", () => {
  // The point of deriving the line is that it cannot drift from the numbers.
  // If a counter can move without the sentence moving, that counter is being
  // reported by a literal and the defect has come back.
  const base = summaryLine(STATS);
  for (const key of ["artifactFiles", "artifactVerified", "refsResolved", "httpRequests", "fragmentsChecked", "offsiteSkipped"]) {
    const skewed = summaryLine({ ...STATS, [key]: STATS[key] - 1 });
    assert.notEqual(skewed, base, `changing ${key} did not change the PASS line`);
  }

  // And every number in the sentence traces to a stat, so nothing is invented.
  for (const n of base.match(/\d+/g) ?? []) {
    assert.ok(
      Object.values(STATS).includes(Number(n)) || Number(n) === 0,
      `${n} appears in the PASS line but is not one of the counters`,
    );
  }
});
