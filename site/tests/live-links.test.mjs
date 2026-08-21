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

import {
  DEFAULT_URL,
  NEGATIVE_CONTROL,
  classify,
  idsIn,
  originAndBase,
  parseArgs,
  refsIn,
  routeForHtml,
} from "../scripts/check-live-links.mjs";
import { BASE, distContentPages } from "./_helpers.mjs";

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
  assert.deepEqual(parseArgs([]), { url: DEFAULT_URL, dist: "dist", attempts: 6 });
  assert.equal(parseArgs(["--url", "https://x.test/y/"]).url, "https://x.test/y/");
  assert.equal(parseArgs(["--url=https://x.test/y/"]).url, "https://x.test/y/");
  assert.equal(parseArgs(["--dist", "other"]).dist, "other");
  assert.equal(parseArgs(["--attempts", "1"]).attempts, 1);
  // A typo in a flag must stop the run. Silently ignoring `--urll` would run
  // the whole check against the default URL and report a green that answers a
  // different question than the one asked.
  assert.throws(() => parseArgs(["--urll", "x"]), /unknown argument/);
  assert.throws(() => parseArgs(["--attempts", "0"]), /positive integer/);
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
