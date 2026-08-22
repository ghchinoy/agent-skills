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

import {
  BASE,
  distContentPages,
  read,
  repoRoot,
  siteRoot,
  sourceRoutes,
  toText,
} from "./_helpers.mjs";

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

/**
 * The sidebar split into its PLUGIN groups and its site groups.
 *
 * RE-POINTED IN PHASE 3. Phase 1's sidebar was plugin groups and nothing else,
 * so `sidebar` and "the plugin groups" were the same list and the tests below
 * could index one for the other. Phase 3 adds a `Start` group above them and a
 * `Project` group below (proposal §6.3).
 *
 * The split is DERIVED — a group is a plugin group when its first item is a
 * `plugins/<name>` slug — rather than sliced at a fixed index, and the plugin
 * groups are required to be one contiguous run. A `slice(1, -1)` would have
 * been shorter and would have quietly reclassified a third site group as a
 * plugin.
 */
function splitSidebar(sidebar) {
  const isPluginGroup = (g) => /^plugins\/[^/]+$/.test(g.items?.[0]?.slug ?? "");
  const pluginGroups = sidebar.filter(isPluginGroup);
  const siteGroups = sidebar.filter((g) => !isPluginGroup(g));
  assert.ok(pluginGroups.length > 0, "no plugin groups in the sidebar at all");
  const first = sidebar.findIndex(isPluginGroup);
  const last = sidebar.length - 1 - [...sidebar].reverse().findIndex(isPluginGroup);
  assert.equal(
    last - first + 1,
    pluginGroups.length,
    "the plugin groups are not one contiguous run — a site group is interleaved",
  );
  return { pluginGroups, siteGroups, first, last };
}

// ── The sidebar the config actually hands Starlight ─────────────────────────

test("R1: every skill sidebar entry carries an explicit label, and it is the declared name", async () => {
  const expected = await expectedGroups();
  const { pluginGroups } = splitSidebar(await buildSidebar(expected.map((g) => g.plugin)));

  assert.equal(pluginGroups.length, expected.length, "wrong number of sidebar groups");
  for (const [i, group] of pluginGroups.entries()) {
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
  const { pluginGroups } = splitSidebar(await buildSidebar(expected.map((g) => g.plugin)));

  // Group order — as slugs, because the group LABEL is a README display name
  // and that is a different fact under a different test.
  assert.deepEqual(
    pluginGroups.map((g) => g.items[0].slug),
    expected.map((g) => `plugins/${g.plugin}`),
    "sidebar groups are not in marketplace.json order",
  );
  // AC2 names the two ends of that order explicitly, so they are asserted
  // explicitly: alphabetical order would put agent-aware-cli first and
  // repo-authoring last, and declared order puts ai-pop first and
  // gcp-management last. Both strings are read out of marketplace.json above,
  // not typed here — this only pins WHICH position each occupies.
  const declared = expected.map((g) => g.plugin);
  assert.equal(pluginGroups[0].items[0].slug, `plugins/${declared[0]}`);
  assert.equal(
    pluginGroups.at(-1).items[0].slug,
    `plugins/${declared.at(-1)}`,
  );
  assert.notDeepEqual(
    declared,
    [...declared].sort(),
    "marketplace.json order is now alphabetical, so this test can no longer tell the two apart",
  );
  // Within-group order.
  for (const [i, group] of pluginGroups.entries()) {
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
  const { pluginGroups } = splitSidebar(await buildSidebar(expected.map((g) => g.plugin)));
  const wantSlugs = pluginGroups.map((g) => g.items.map((i) => i.slug));
  const wantLabels = pluginGroups.flatMap((g) => g.items.slice(1).map((i) => i.label));
  assert.ok(wantLabels.length >= 2, "need at least two skill entries to permute");

  // Reordered within a group -> different.
  const reordered = wantSlugs.map((slugs) =>
    slugs.length > 2 ? [slugs[0], slugs[2], slugs[1], ...slugs.slice(3)] : slugs,
  );
  assert.notDeepEqual(reordered, wantSlugs, "the order comparison cannot see a swap");

  // Relabelled -> different. This is the R1 regression itself: the label a
  // sidebar entry would inherit if it carried no `label` is the page title,
  // which for these skills is the body H1 and NOT the declared name.
  //
  // RE-POINTED IN PHASE 3, and the reason is a real source fact rather than a
  // convenience. Phase 1's two skills both had a body H1 that differed from
  // their `name`, so the control could require one of every skill. At full
  // fan-out that is false: grill-with-beads declares no H1 at all (I2), so for
  // that skill there is no competing string and nothing for this control to
  // discriminate. The discriminating population is therefore DERIVED below and
  // its size is asserted, so "the control found nothing to test" cannot pass
  // as "the control passed".
  let discriminating = 0;
  let noH1 = 0;
  for (const g of expected) {
    for (const s of g.skills) {
      // Every skill, H1 or not, must carry its declared name in the nav.
      assert.ok(wantLabels.includes(s.name), `sidebar lost the declared name ${s.name}`);

      const h1 = await bodyH1(g.plugin, s.dir);
      if (h1 === null) {
        noH1 += 1;
        continue;
      }
      if (h1 === s.name) continue; // no competing string; nothing to tell apart
      discriminating += 1;
      assert.ok(
        !wantLabels.includes(h1),
        `sidebar shows the body H1 "${h1}" where §6.3 requires "${s.name}"`,
      );
    }
  }
  const total = expected.reduce((n, g) => n + g.skills.length, 0);
  assert.ok(
    discriminating >= 20,
    `only ${discriminating} of ${total} skills have a body H1 that differs from their ` +
      `declared name, so this control is nearly vacuous — retune it`,
  );
  assert.equal(noH1, 1, `skills with no body H1 at all: expected exactly I2's one, got ${noH1}`);
});

test("R1: the sidebar's Start and Project groups link the five site pages", async () => {
  // NEW IN PHASE 3. The plugin groups are asserted above; these are the groups
  // that are not plugins, and without this they would be unasserted entirely —
  // `splitSidebar()` would classify anything at all as a site group and the
  // tests above would not notice.
  const { siteGroups } = splitSidebar(await buildSidebar());
  assert.deepEqual(
    siteGroups.map((g) => g.label),
    ["Start", "Project"],
    "the site groups are not Start and Project",
  );
  assert.deepEqual(
    siteGroups.flatMap((g) => g.items.map((i) => i.slug)),
    ["index", "about/install", "about/standards", "skills", "about/contributing"],
    "the site groups do not link exactly the five site pages",
  );
  // Every one of them is labelled: these pages have titles that are lifted
  // from repo documents, and an inherited label would put the README's H1 in
  // the nav as a second site name.
  for (const g of siteGroups) {
    for (const i of g.items) {
      assert.equal(typeof i.label, "string", `${i.slug} has no explicit sidebar label`);
      assert.ok(i.label.length > 0);
    }
  }
  // The skill total in the "All skills (N)" label is COUNTED, not typed.
  const { skills } = await sourceRoutes();
  const all = siteGroups[0].items.find((i) => i.slug === "skills");
  assert.equal(all.label, `All skills (${skills.length})`);
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

  // RE-POINTED IN PHASE 3: the rendered sidebar now opens with the Start group
  // and closes with Project, so the catalog links are the run BETWEEN them.
  // That run is identified by href shape and then required to be contiguous,
  // for the same reason `splitSidebar()` derives its split rather than slicing.
  const isPluginLink = (l) => l.href.startsWith(`${BASE}/plugins/`);
  const pluginLinks = links.filter(isPluginLink);
  const firstPlugin = links.findIndex(isPluginLink);
  const lastPlugin = links.length - 1 - [...links].reverse().findIndex(isPluginLink);
  assert.equal(
    lastPlugin - firstPlugin + 1,
    pluginLinks.length,
    "the rendered catalog links are not one contiguous run",
  );
  assert.deepEqual(
    links.slice(0, firstPlugin).map((l) => l.href),
    [`${BASE}/`, `${BASE}/about/install/`, `${BASE}/about/standards/`, `${BASE}/skills/`],
    "the rendered Start group is not the four site links, in order",
  );
  assert.deepEqual(
    links.slice(lastPlugin + 1).map((l) => l.href),
    [`${BASE}/about/contributing/`],
    "the rendered Project group is not Contributing alone",
  );

  const wantOrder = expected.flatMap((g) => [
    { href: `${BASE}/plugins/${g.plugin}/`, text: null },
    ...g.skills.map((s) => ({ href: `${BASE}/plugins/${g.plugin}/${s.dir}/`, text: s.name })),
  ]);
  assert.deepEqual(
    pluginLinks.map((l) => l.href),
    wantOrder.map((w) => w.href),
    "rendered sidebar hrefs are not in the expected order",
  );
  for (const [i, want] of wantOrder.entries()) {
    if (want.text === null) continue;
    assert.equal(
      pluginLinks[i].text,
      want.text,
      `rendered sidebar shows "${pluginLinks[i].text}" where §6.3 requires "${want.text}"`,
    );
  }
});

test("R1: the page title is the body H1 while the sidebar label is the name — both, in their own slots", async () => {
  // The other half of the EM ruling. Neither declared string is discarded.
  //
  // RE-POINTED IN PHASE 3 for the documented fallback, not to accommodate a
  // failure. src/sidebar.mjs states the rule as "page title = the body H1,
  // `name` as fallback where no H1 exists", and Phase 1 had no skill in the
  // second case so the test only ever exercised the first. grill-with-beads is
  // the second case, and the fallback is now asserted as its own branch with
  // its population counted — one, out of twenty-three.
  const expected = await expectedGroups();
  const pages = await distContentPages();
  let fellBack = 0;
  for (const g of expected) {
    for (const s of g.skills) {
      const page = pages.find((p) => p.route === `plugins/${g.plugin}/${s.dir}`);
      assert.ok(page, `no page for ${g.plugin}/${s.dir}`);
      const h1 = await bodyH1(g.plugin, s.dir);
      if (h1 === null) fellBack += 1;
      const title = (page.html.match(/<title>([\s\S]*?)<\/title>/) ?? [])[1];
      assert.equal(
        toText(title ?? ""),
        `${h1 ?? s.name} | ${SITE_TITLE}`,
        h1 === null
          ? `${s.dir}: declares no body H1, so <title> must fall back to the declared name`
          : `${s.dir}: <title> is not the body H1 followed by the site title`,
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
  assert.equal(
    fellBack,
    1,
    `skills titled by the fallback rather than a body H1: expected exactly one ` +
      `(I2's grill-with-beads), got ${fellBack}`,
  );
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
  // must not survive in the site's CHROME.
  //
  // RE-POINTED IN PHASE 3, AND THIS ONE IS A NARROWING, SO HERE IS WHY. The
  // assertion was "the string appears nowhere in dist", which held while the
  // site rendered two skills of one plugin. It is false at fan-out for a
  // reason that has nothing to do with the site title: "Agent Skills &
  // Plugins" is the repository's own README H1 and the subject of
  // CONTRIBUTING.md's "# Contributing to Agent Skills & Plugins", and
  // /about/contributing/ lifts that document verbatim. Deleting the string
  // from the page would be the site editing the repo's prose, which is the one
  // thing this site does not do.
  //
  // So the claim is narrowed to what it was always ABOUT — the superseded
  // string must not appear as this site's name — and the narrowing is bounded
  // two ways: every occurrence outside <main> is a failure on every page, and
  // the pages allowed to contain it inside <main> are DERIVED from which
  // source documents contain it, not listed here.
  const SUPERSEDED = /Agent Skills (&amp;|&) Plugins/;
  const carriers = [];
  for (const p of await distContentPages()) {
    // "Chrome" here is everything the SITE puts around the content: the
    // masthead, the sidebar, the footer. It excludes <main>, and it excludes
    // the three places that carry the PAGE title — <title> and the two social
    // metas — because a page title is content too: /about/contributing/'s is
    // CONTRIBUTING.md's own H1, lifted. R4's other two tests already pin what
    // the page title may be and that it is suffixed with the site title.
    const siteChrome = p.html
      .replace(/<main\b[\s\S]*?<\/main>/i, " ")
      .replace(/<title>[\s\S]*?<\/title>/i, " ")
      .replace(/<meta\b[^>]*\b(?:property|name)="[^"]*title"[^>]*>/gi, " ");
    assert.ok(
      !SUPERSEDED.test(siteChrome),
      `${p.rel} carries the superseded site title in its chrome`,
    );
    if (SUPERSEDED.test(p.html)) carriers.push(p.route);
  }
  // The exclusions above must not be quietly eating the whole document: the
  // detector still fires on a masthead that really does carry the string.
  const planted = `<html><head><title>x</title></head><body>
    <a class="site-title" href="/">Agent Skills &amp; Plugins</a>
    <main>body</main></body></html>`;
  assert.ok(
    SUPERSEDED.test(
      planted
        .replace(/<main\b[\s\S]*?<\/main>/i, " ")
        .replace(/<title>[\s\S]*?<\/title>/i, " ")
        .replace(/<meta\b[^>]*\b(?:property|name)="[^"]*title"[^>]*>/gi, " "),
    ),
    "the chrome detector cannot see a masthead that carries the superseded title",
  );
  // Which pages MAY contain it, derived. Exactly two pages take their title
  // from a repo document's H1 — the landing page from README.md, the
  // contributing page from CONTRIBUTING.md — and both of those H1s name the
  // repository, which is still called "Agent Skills & Plugins". The site being
  // called something else does not make the repository's own H1 wrong, and
  // rewriting it on the way through would be the site editing its source.
  const h1Of = (md) => (md.match(/^\s*#\s+(.+)$/m) ?? [])[1]?.trim() ?? "";
  const lifted = {
    "": h1Of(await readFile(join(repoRoot, "README.md"), "utf8")),
    "about/contributing": h1Of(await readFile(join(repoRoot, "CONTRIBUTING.md"), "utf8")),
  };
  const permitted = Object.entries(lifted)
    .filter(([, title]) => SUPERSEDED.test(title))
    .map(([route]) => route)
    .sort();
  assert.equal(
    permitted.length,
    2,
    "neither lifted H1 contains the superseded title any more — re-tighten this test",
  );
  assert.deepEqual(
    carriers.sort(),
    permitted,
    "the superseded title appears in the body of a page that does not lift a " +
      "document whose H1 contains it",
  );
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
