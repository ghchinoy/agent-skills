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
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, normalize, relative } from "node:path";
import { existsSync, statSync } from "node:fs";

import {
  BASE,
  PLUGIN,
  dist,
  distContentPages,
  distHtmlFiles,
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
    for (const href of hrefsIn(html)) {
      if (isExternal(href)) continue;
      const [path] = href.split("#");
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

test("0 dangling anchors: every in-page fragment names an id that exists", async () => {
  const pages = await distContentPages();
  const byRoute = new Map(pages.map((p) => [`/${p.route}/`.replace(/\/+$/, "/"), p.html]));
  const dangling = [];
  for (const p of pages) {
    for (const href of hrefsIn(p.html)) {
      if (isExternal(href) || !href.includes("#")) continue;
      const [path, frag] = href.split("#");
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
  const gh = new Set();
  for (const p of pages) {
    for (const href of hrefsIn(mainOf(p.html))) {
      if (href.startsWith("https://github.com/")) gh.add(href);
    }
  }
  assert.ok(gh.size > 0, "no GitHub source links were rendered at all");

  // Every off-site link is either MINTED by the build (a source permalink,
  // which must point at this repository at the pinned ref) or DECLARED in the
  // repo (plugin.json's author.url and repository fields, which must appear
  // byte-identically and must not be invented). Nothing else is allowed.
  const manifest = JSON.parse(
    await readFile(join(repoRoot, "plugins", PLUGIN, "plugin.json"), "utf8"),
  );
  const declaredUrls = new Set(
    JSON.stringify(manifest)
      .match(/https?:\/\/[^"\\]+/g)
      ?.map((u) => u.replace(/\/$/, "")) ?? [],
  );

  for (const href of gh) {
    if (/\/(blob|tree)\//.test(href)) {
      assert.ok(
        href.startsWith("https://github.com/ghchinoy/agent-skills/"),
        `minted source link points at an unexpected repository: ${href}`,
      );
      assert.match(
        href,
        /\/(blob|tree)\/main\//,
        `GitHub link is not a blob/tree at the pinned ref: ${href}`,
      );
      continue;
    }
    assert.ok(
      declaredUrls.has(href.replace(/\/$/, "")),
      `off-site link ${href} is neither a minted source permalink nor a URL declared in plugin.json`,
    );
  }
  // The example-bundle DIRECTORY link is a /tree/ URL, not /blob/ — an I5
  // detail that is wrong in a way nothing else would catch.
  const bundle = [...gh].find((h) => h.includes("example-bundle"));
  assert.ok(bundle, "the assets/example-bundle/ link was not rendered");
  assert.match(bundle, /\/tree\/main\/plugins\/okf-authoring\/skills\/okf-author\/assets\/example-bundle\/?$/);
});

// ── helpers ─────────────────────────────────────────────────────────────────

function hrefsIn(html) {
  return [...html.matchAll(/<a\b[^>]*?\shref="([^"]*)"/g)].map((m) => decodeAmp(m[1]));
}

function idsIn(html) {
  return new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
}

function decodeAmp(s) {
  return s.replace(/&amp;/g, "&");
}

function isExternal(href) {
  return /^(https?:|mailto:|tel:|data:|\/\/)/.test(href);
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
