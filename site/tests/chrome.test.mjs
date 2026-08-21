// chrome.test.mjs — the strings the SITE puts around the content: the
// masthead title and the sidebar.
//
// There was no coverage of either before this file. That is how R1 happened:
// changing the page title to the body H1 silently changed the sidebar too,
// because a Starlight entry with no `label` inherits its page's title, and
// nothing asserted what the sidebar said. Two invariants now hold it down.
//
//   1. Every skill entry's label is the DECLARED `name` — the identifier
//      `npx skills add … --skill <name>` takes (proposal §6.3). Not the page
//      title, which is deliberately the body H1 (see src/sidebar.mjs for the
//      full ruling and rationale).
//   2. Group order, and skill order within a group, follow marketplace.json
//      exactly. Phase 3 AC 2 fans this out to 23 skills across 10 plugins; the
//      assertions below are written against N plugins, not against one.
//
// Everything expected here is parsed from marketplace.json and the SKILL.md
// files by this file, with its own JSON/YAML reads. It never asks the loader
// or the sidebar module what the answer should be — only what it produced.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parse as parseYaml } from "yaml";

import { BASE, distContentPages, read, repoRoot, siteRoot, toText } from "./_helpers.mjs";

import { buildSidebar } from "../src/sidebar.mjs";

/** The site title the owner fixed. Written out here, not imported from the
 *  config, so that a test can catch the config changing it. */
const SITE_TITLE = "Agent Skills Catalog";

// ── Expectations, computed from the source ──────────────────────────────────

/** marketplace.json, parsed here. */
async function marketplace() {
  return JSON.parse(await readFile(join(repoRoot, ".claude-plugin", "marketplace.json"), "utf8"));
}

/** The declared `name` of one skill, read from its own SKILL.md frontmatter. */
async function declaredName(plugin, dir) {
  const raw = await readFile(
    join(repoRoot, "plugins", plugin, "skills", dir, "SKILL.md"),
    "utf8",
  );
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  assert.ok(m, `${plugin}/${dir}: no frontmatter`);
  const name = parseYaml(m[1]).name;
  assert.equal(typeof name, "string", `${plugin}/${dir}: no declared name`);
  return name;
}

/** The body H1 of one skill, which is what the PAGE is titled. */
async function bodyH1(plugin, dir) {
  const raw = await readFile(
    join(repoRoot, "plugins", plugin, "skills", dir, "SKILL.md"),
    "utf8",
  );
  const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  const m = body.match(/^#\s+(.+?)\s*$/m);
  return m ? m[1] : null;
}

/** Which plugins this build actually rendered — read off dist, so the test
 *  does not import the site's phase scope and then check it against itself. */
async function builtPlugins() {
  const seen = new Set();
  for (const p of await distContentPages()) {
    const m = /^plugins\/([^/]+)/.exec(p.route);
    if (m) seen.add(m[1]);
  }
  return seen;
}

/** `[{ plugin, skills: [declared name, …] }]` in marketplace.json order. */
async function expectedGroups() {
  const mp = await marketplace();
  const built = await builtPlugins();
  const out = [];
  for (const entry of mp.plugins) {
    if (!built.has(entry.name)) continue;
    const dirs = (entry.skills ?? []).map((p) => basename(String(p).replace(/\/+$/, "")));
    const skills = [];
    for (const dir of dirs) skills.push({ dir, name: await declaredName(entry.name, dir) });
    out.push({ plugin: entry.name, skills });
  }
  assert.ok(out.length > 0, "no built plugin matched marketplace.json — the fixture is wrong");
  return out;
}

// ── The sidebar the config actually hands Starlight ─────────────────────────

test("R1: every skill sidebar entry carries an explicit label, and it is the declared name", async () => {
  const expected = await expectedGroups();
  const sidebar = await buildSidebar(expected.map((g) => g.plugin));

  assert.equal(sidebar.length, expected.length, "wrong number of sidebar groups");
  for (const [i, group] of sidebar.entries()) {
    const want = expected[i];
    // items[0] is the plugin overview page, which legitimately inherits its
    // title (there is no second declared string for it). Every entry AFTER it
    // is a skill and must be labelled.
    const skillItems = group.items.slice(1);
    assert.equal(
      skillItems.length,
      want.skills.length,
      `${want.plugin}: wrong number of skill entries`,
    );
    for (const [j, item] of skillItems.entries()) {
      assert.equal(
        item.label,
        want.skills[j].name,
        `${want.plugin}: entry ${j} is labelled "${item.label}", not the declared name`,
      );
      assert.equal(item.slug, `plugins/${want.plugin}/${want.skills[j].dir}`);
    }
  }
});

test("R1: group order and within-group order follow marketplace.json exactly", async () => {
  const expected = await expectedGroups();
  const sidebar = await buildSidebar(expected.map((g) => g.plugin));

  // Group order — as slugs, because the group LABEL is a README display name
  // and that is a different fact under a different test.
  assert.deepEqual(
    sidebar.map((g) => g.items[0].slug),
    expected.map((g) => `plugins/${g.plugin}`),
    "sidebar groups are not in marketplace.json order",
  );
  // Within-group order.
  for (const [i, group] of sidebar.entries()) {
    assert.deepEqual(
      group.items.map((it) => it.slug),
      [
        `plugins/${expected[i].plugin}`,
        ...expected[i].skills.map((s) => `plugins/${expected[i].plugin}/${s.dir}`),
      ],
      `${expected[i].plugin}: skills are not in marketplace.json order`,
    );
  }
});

test("R1 control: the ordering and label assertions can fail", async () => {
  // Both assertions above are deepEqual against a computed list, so the
  // control has to show the comparison discriminating rather than accepting
  // anything. Prove it on mutations of the REAL sidebar.
  const expected = await expectedGroups();
  const sidebar = await buildSidebar(expected.map((g) => g.plugin));
  const wantSlugs = sidebar.map((g) => g.items.map((i) => i.slug));
  const wantLabels = sidebar.flatMap((g) => g.items.slice(1).map((i) => i.label));
  assert.ok(wantLabels.length >= 2, "need at least two skill entries to permute");

  // Reordered within a group -> different.
  const reordered = wantSlugs.map((slugs) =>
    slugs.length > 2 ? [slugs[0], slugs[2], slugs[1], ...slugs.slice(3)] : slugs,
  );
  assert.notDeepEqual(reordered, wantSlugs, "the order comparison cannot see a swap");

  // Relabelled -> different. This is the R1 regression itself: the label a
  // sidebar entry would inherit if it carried no `label` is the page title,
  // which for these skills is the body H1 and NOT the declared name.
  for (const g of expected) {
    for (const s of g.skills) {
      const h1 = await bodyH1(g.plugin, s.dir);
      assert.ok(h1, `${g.plugin}/${s.dir} has no H1 — this control needs one`);
      assert.notEqual(
        h1,
        s.name,
        `${g.plugin}/${s.dir}: H1 and declared name are identical, so this ` +
          `control proves nothing. Pick a different fixture.`,
      );
      assert.ok(wantLabels.includes(s.name), `sidebar lost the declared name ${s.name}`);
      assert.ok(
        !wantLabels.includes(h1),
        `sidebar shows the body H1 "${h1}" where §6.3 requires "${s.name}"`,
      );
    }
  }
});

// ── …and what actually reached the page ─────────────────────────────────────

test("R1: the RENDERED sidebar shows the declared names, in marketplace.json order", async () => {
  // The config object is one thing; what Starlight did with it is another.
  const expected = await expectedGroups();
  const pages = await distContentPages();
  const page = pages.find((p) => p.route === `plugins/${expected[0].plugin}`);
  assert.ok(page, "no plugin overview page was built");

  const links = sidebarLinks(page.html);
  assert.ok(links.length > 0, "no sidebar links were extracted at all — the extractor is broken");

  const wantOrder = expected.flatMap((g) => [
    { href: `${BASE}/plugins/${g.plugin}/`, text: null },
    ...g.skills.map((s) => ({ href: `${BASE}/plugins/${g.plugin}/${s.dir}/`, text: s.name })),
  ]);
  assert.deepEqual(
    links.map((l) => l.href),
    wantOrder.map((w) => w.href),
    "rendered sidebar hrefs are not in the expected order",
  );
  for (const [i, want] of wantOrder.entries()) {
    if (want.text === null) continue;
    assert.equal(
      links[i].text,
      want.text,
      `rendered sidebar shows "${links[i].text}" where §6.3 requires "${want.text}"`,
    );
  }
});

test("R1: the page title is the body H1 while the sidebar label is the name — both, in their own slots", async () => {
  // The other half of the EM ruling. Neither declared string is discarded.
  const expected = await expectedGroups();
  const pages = await distContentPages();
  for (const g of expected) {
    for (const s of g.skills) {
      const page = pages.find((p) => p.route === `plugins/${g.plugin}/${s.dir}`);
      assert.ok(page, `no page for ${g.plugin}/${s.dir}`);
      const h1 = await bodyH1(g.plugin, s.dir);
      const title = (page.html.match(/<title>([\s\S]*?)<\/title>/) ?? [])[1];
      assert.equal(
        toText(title ?? ""),
        `${h1} | ${SITE_TITLE}`,
        `${s.dir}: <title> is not the body H1 followed by the site title`,
      );
      // And the declared name is still on the page, in its own field row.
      // Loose on attributes: Astro appends a scoped hash class to <code>.
      assert.match(
        page.html,
        new RegExp(`<code\\b[^>]*>${s.name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}</code>`),
        `${s.dir}: the declared name is not rendered as a field value`,
      );
    }
  }
});

// ── R4: the site title ──────────────────────────────────────────────────────

test("R4: the masthead site title is exactly the string the owner fixed", async () => {
  const pages = await distContentPages();
  assert.ok(pages.length > 0);
  for (const p of pages) {
    const m = p.html.match(/<a\b[^>]*\bclass="site-title[^"]*"[^>]*>([\s\S]*?)<\/a>/);
    assert.ok(m, `${p.rel}: no masthead site title element`);
    assert.equal(toText(m[1]), SITE_TITLE, `${p.rel}: masthead title drifted`);
  }
});

test("R4: every page <title> ends with the site title", async () => {
  for (const p of await distContentPages()) {
    const m = p.html.match(/<title>([\s\S]*?)<\/title>/);
    assert.ok(m, `${p.rel}: no <title>`);
    assert.ok(
      toText(m[1]).endsWith(` | ${SITE_TITLE}`),
      `${p.rel}: <title> is "${toText(m[1])}"`,
    );
  }
});

test("R4 control: the assertion is exact, and the superseded title is gone from dist", async () => {
  // Positive control — "exact casing, exact wording" means the comparison has
  // to reject every near miss, not just an obviously different string.
  for (const near of [
    "Agent Skills & Plugins", // the superseded title
    "Agent Skills catalog", // wrong casing
    "Agent Skills Catalogue", // wrong spelling
    "The Agent Skills Catalog", // extra word
    "Agent Skills", // truncated
  ]) {
    assert.notEqual(near, SITE_TITLE, `"${near}" must not compare equal to the fixed title`);
  }

  // Negative control — and the real regression check: the superseded string
  // must not survive anywhere in the built output.
  for (const p of await distContentPages()) {
    assert.ok(
      !p.html.includes("Agent Skills &amp; Plugins") && !p.html.includes("Agent Skills & Plugins"),
      `${p.rel} still carries the superseded site title`,
    );
  }
  // …nor in the config that produces it.
  const config = await read(join(siteRoot, "astro.config.mjs"));
  assert.match(config, /title:\s*"Agent Skills Catalog"/, "astro.config.mjs does not set the fixed title");
});

// ── helpers ─────────────────────────────────────────────────────────────────

/**
 * The sidebar's content links, in document order, as `{ href, text }`.
 *
 * Scoped to the `#starlight__sidebar` pane and stopped before the social
 * links, so the GitHub icon and the mobile menu button are not counted.
 */
function sidebarLinks(html) {
  const start = html.indexOf('id="starlight__sidebar"');
  assert.notEqual(start, -1, "no sidebar pane in the built page");
  const end = html.indexOf("</nav>", start);
  const pane = html.slice(start, end === -1 ? undefined : end);
  const out = [];
  for (const m of pane.matchAll(/<a\b[^>]*\shref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)) {
    if (!m[1].startsWith(BASE + "/")) continue; // social links are absolute URLs
    out.push({ href: m[1], text: toText(m[2]) });
  }
  return out;
}
