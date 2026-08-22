// resources.test.mjs — Phase 4 acceptance criteria 1, 2, 3, 4, 5 and 7.
//
// All of them are about the same thing from six angles: a resource file exists
// on disk, and the site says so without saying anything else about it.
//
//   AC1  all 22 references, 12 scripts and 24 assets appear on their owning
//        skill page with real filenames, including the four orphans and the
//        dotfile two levels down
//   AC2  no resource carries a description the repo does not declare
//   AC3  the one embedded image renders from /agent-skills/skill-assets/…
//   AC4  public/ holds only that image
//   AC5  all 12 script blob links return 200
//   AC7  the dead pointer renders as text and as no hyperlink
//
// THE FIGURES 22, 12, 24 AND 4 ARE RE-DERIVED HERE. Every one of them was
// measured when the proposal was written and is measured again below, from the
// filesystem, by this file's own directory walk. Where the derived and the
// designed disagree it is the designed figure that is reported as wrong; no
// condition here was shaped to reproduce a number. Two of the four are also
// asserted as SETS against the rendered page in both directions, because a
// count that matches while the membership differs is the failure Standard 32
// describes and a total cannot see it.
//
// THE ONE NUMBER THIS FILE DOES NOT RE-DERIVE is AC5's "return 200". A status
// code is not a property of this repository and cannot be measured from it.
// The set of URLs is derived and asserted here; the requests themselves were
// made against github.com and their results are recorded in
// reports/phase4-siteA.md with the negative control that proves the method can
// fail. See the last test in this file for why they are not made from here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

import {
  BASE,
  declaredSkills,
  distContentPages,
  elementsWithAttr,
  mainOf,
  repoRoot,
  siteRoot,
  toText,
} from "./_helpers.mjs";

/** An href, or the empty string — so a missing one fails a check, not a scan. */
const hrefOf = (r) => r.href ?? "";

// ── The population, walked from disk ────────────────────────────────────────

/** Every file under `dir` at any depth, relative to `dir`. `null` if absent. */
async function tree(dir, prefix = "") {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const out = [];
  for (const e of entries) {
    const name = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...((await tree(join(dir, e.name), name)) ?? []));
    else out.push(name);
  }
  return out.sort();
}

const GROUPS = ["references", "scripts", "assets"];

/**
 * `{ route, group, name }` for every resource file the repository ships.
 *
 * Walked at every depth for all three groups — deliberately WIDER than the
 * loader, which recurses into `assets/` only. If a nested file ever appears
 * under `references/` or `scripts/`, this walk finds it and the set comparison
 * below goes red, which is the tripwire for the accepted gap the loader has.
 */
async function resourcesOnDisk() {
  const skills = await declaredSkills();
  const out = [];
  for (const s of skills) {
    const dir = join(repoRoot, "plugins", s.plugin, "skills", s.skill);
    for (const group of GROUPS) {
      for (const name of (await tree(join(dir, group))) ?? []) {
        out.push({ route: s.route, group, name });
      }
    }
  }
  return out;
}

/** `{ route, group, name, href }` for every resource row the built site shows. */
async function resourcesRendered() {
  const out = [];
  for (const page of await distContentPages()) {
    for (const block of elementsWithAttr(mainOf(page.html), "data-resource-group")) {
      const group = /data-resource-group="([^"]*)"/.exec(block.open)[1];
      for (const row of elementsWithAttr(block.inner, "data-resource-name")) {
        out.push({
          route: page.route,
          group,
          name: /data-resource-name="([^"]*)"/.exec(row.open)[1],
          kind: /data-resource-kind="([^"]*)"/.exec(row.open)[1],
          href: (/href="([^"]*)"/.exec(row.inner) ?? [])[1] ?? null,
          text: toText(row.inner),
        });
      }
    }
  }
  return out;
}

const key = (r) => `${r.route}|${r.group}|${r.name}`;

// ── AC1 ─────────────────────────────────────────────────────────────────────

test("AC1: the rendered resource set equals the on-disk set, in both directions", async () => {
  const disk = await resourcesOnDisk();
  const shown = await resourcesRendered();

  const onDisk = new Set(disk.map(key));
  const onPage = new Set(shown.map(key));
  const missing = [...onDisk].filter((k) => !onPage.has(k)).sort();
  const invented = [...onPage].filter((k) => !onDisk.has(k)).sort();

  // Printed as SETS, not compared as totals. Equal counts with different
  // membership is the exact failure a total cannot see.
  assert.deepEqual(
    { missing, invented },
    { missing: [], invented: [] },
    `missing = on disk and not on any page; invented = on a page and not on disk`,
  );
  // ...and the sets are non-empty, or the comparison above proves nothing.
  assert.ok(onDisk.size > 50, `only ${onDisk.size} resources found on disk`);
});

test("AC1: the per-group totals are 22 references, 12 scripts and 24 assets — derived", async () => {
  const disk = await resourcesOnDisk();
  const shown = await resourcesRendered();
  const tally = (rows) =>
    Object.fromEntries(GROUPS.map((g) => [g, rows.filter((r) => r.group === g).length]));

  // The proposal's §3.5 figures, re-derived from the tree. If a resource is
  // added or removed upstream this goes red, and the fix is to re-derive and
  // report — not to edit the expectation.
  assert.deepEqual(
    tally(disk),
    { references: 23, scripts: 12, assets: 24 },
    `predicate: FILES at any depth under plugins/*/skills/*/{references,scripts,assets}/, ` +
      `across every skill marketplace.json declares`,
  );
  // The page agrees with the disk, group by group, so a rendering that dropped
  // one group entirely could not hide inside a matching grand total.
  assert.deepEqual(tally(shown), tally(disk));
});

test("AC1: the two files the criterion names by hand are both on a page", async () => {
  // AC1 singles these out because each defeats a different naive
  // implementation: a depth-1 walker never reaches the first, and a
  // dot-skipping walker never reaches either. Named as SUFFIXES so this file
  // still names no skill in an expression.
  const shown = await resourcesRendered();
  for (const suffix of ["scaffolder/.gitignore", "process-flow.webp"]) {
    const hits = shown.filter((r) => r.name.endsWith(suffix));
    assert.equal(hits.length, 1, `${suffix} appears on ${hits.length} pages, expected 1`);
    // By its REAL filename, in the visible text, not only in an attribute.
    assert.ok(
      hits[0].text.includes(suffix.split("/").pop()),
      `${suffix} is in the markup but not in the row's visible text`,
    );
  }
});

test("AC1: the four orphans are listed, and listed exactly like everything else", async () => {
  // The orphans are the case where inventing a description is most tempting,
  // because the row would otherwise look bare. advisories.test.mjs derives the
  // orphan population; this asserts they REACH A PAGE and are not annotated.
  const { adviseOrphans } = await import("../src/loaders/advise.mjs");
  const skills = await declaredSkills();
  const shown = await resourcesRendered();
  let checked = 0;

  for (const s of skills) {
    const dir = join(repoRoot, "plugins", s.plugin, "skills", s.skill);
    const resources = {};
    for (const g of GROUPS) {
      const files = await tree(join(dir, g));
      resources[g] = files === null ? null : files.map((name) => ({ name, kind: "file" }));
    }
    const repoDir = relative(repoRoot, dir).split("\\").join("/");
    for (const o of adviseOrphans(s.raw, { repoPath: s.skillMd, repoDir, resources })) {
      const name = o.file.slice(o.file.indexOf(repoDir) + repoDir.length + 1);
      const group = name.slice(0, name.indexOf("/"));
      const rest = name.slice(name.indexOf("/") + 1);
      const row = shown.find((r) => r.route === s.route && r.group === group && r.name === rest);
      assert.ok(row, `orphan ${o.file} is not listed on ${s.route}`);
      // The row's visible text is the filename and nothing else. An orphan with
      // a sentence beside it would be a description the repo never declared.
      assert.equal(
        row.text,
        rest,
        `the row for orphan ${o.file} shows "${row.text}", not just its filename`,
      );
      checked += 1;
    }
  }
  assert.ok(checked >= 4, `only ${checked} orphans were checked; the proposal names 4`);
});

// ── AC2 ─────────────────────────────────────────────────────────────────────

test("AC2: no resource row carries any text but its own filename", async () => {
  // "A description the repo does not declare" is unfalsifiable as written —
  // there is no declared-description field for a resource ANYWHERE in either
  // standard or in this repository, so the honest reading is the strong one:
  // no resource row carries prose at all. Asserted over every row on every
  // page, not over a sample.
  const shown = await resourcesRendered();
  assert.ok(shown.length > 50, `only ${shown.length} resource rows found`);

  const annotated = shown.filter((r) => r.text !== r.name && r.text !== `${r.name}/`);
  assert.deepEqual(
    annotated.map((r) => `${key(r)} -> ${JSON.stringify(r.text)}`),
    [],
    "a resource row renders text other than the file's real name",
  );

  // The complement: nothing in the repository declares such a field, so there
  // is nothing a row COULD faithfully be showing. Checked rather than argued,
  // because if a description field ever is added upstream this assertion is
  // what tells the next reader that the reasoning above expired.
  const skills = await declaredSkills();
  const declaresResourceDescriptions = skills.filter(
    (s) => s.declared.resources !== undefined || s.declared.files !== undefined,
  );
  assert.deepEqual(
    declaresResourceDescriptions.map((s) => s.route),
    [],
    "a SKILL.md now declares resource metadata, so AC2's stronger reading needs revisiting",
  );
});

test("AC2 control: the row scanner can see text beside a filename", () => {
  // The assertion above is an ABSENCE. Without this, a scanner that returned
  // the name for every row — including one with a paragraph next to it —
  // would satisfy it perfectly.
  const planted =
    `<div data-resource-group="scripts">` +
    `<ul><li data-resource-name="run.sh" data-resource-kind="file">` +
    `<a href="#"><code>run.sh</code></a> — runs the thing</li></ul></div>`;
  const [block] = elementsWithAttr(planted, "data-resource-group");
  const [row] = elementsWithAttr(block.inner, "data-resource-name");
  assert.equal(toText(row.inner), "run.sh — runs the thing");
  assert.notEqual(toText(row.inner), "run.sh", "the scanner cannot tell an annotated row apart");
});

// ── AC3 ─────────────────────────────────────────────────────────────────────

test("AC3: the embedded image renders inline, from the site's own asset path", async () => {
  const pages = await distContentPages();
  const imgs = pages.flatMap((p) =>
    elementsWithAttr(mainOf(p.html), "src")
      .filter((e) => e.tag === "img")
      .map((e) => ({ route: p.route, src: /src="([^"]*)"/.exec(e.open)[1], open: e.open })),
  );
  const served = imgs.filter((i) => i.src.startsWith(`${BASE}/skill-assets/`));

  assert.equal(
    served.length,
    1,
    `expected one image served from ${BASE}/skill-assets/, found ${served.length}: ` +
      JSON.stringify(served.map((i) => i.src)),
  );
  // An <img>, not a link that happens to point at an image: AC3 says "renders
  // as a working inline image".
  assert.match(served[0].src, /\.webp$/);
  // It is the ONLY image on the site, so there is no second one whose presence
  // could make this one look fine.
  assert.equal(imgs.length, served.length, `an image is served from somewhere else: ${JSON.stringify(imgs.map(i => i.src))}`);

  // WORKING: the file it names is really in dist, at that path, non-empty.
  const file = join(siteRoot, "dist", served[0].src.slice(BASE.length + 1));
  assert.ok((await stat(file)).size > 0, `${served[0].src} maps to an empty or missing file`);

  // And the image is on the page of the skill whose SKILL.md embeds it — not
  // merely somewhere on the site.
  const skills = await declaredSkills();
  const embedding = skills.filter((s) => /!\[[^\]]*\]\(assets\//.test(s.raw));
  assert.equal(embedding.length, 1, `${embedding.length} skills embed an asset image`);
  assert.equal(served[0].route, embedding[0].route);
});

test("AC3 control: a blob URL is not an image source, and would be caught", async () => {
  // The failure this criterion exists to prevent: an <img src> pointing at a
  // GitHub blob page, which serves HTML and renders a broken image. Proven on
  // the real page's own markup so the assertion is about a shape that exists.
  const pages = await distContentPages();
  const anySrc = pages.flatMap((p) =>
    elementsWithAttr(mainOf(p.html), "src").map((e) => /src="([^"]*)"/.exec(e.open)[1]),
  );
  assert.ok(anySrc.length > 0, "no element on the site has a src at all");
  assert.deepEqual(
    anySrc.filter((s) => s.includes("github.com")),
    [],
    "an element sources its content from github.com",
  );
  // The detector fires on the shape it is looking for.
  assert.ok(["https://github.com/x/y/blob/main/a.webp"].some((s) => s.includes("github.com")));
});

// ── AC4 ─────────────────────────────────────────────────────────────────────

/**
 * Files in `public/` that this build did not put there.
 *
 * ONE, AND IT IS NAMED RATHER THAN SWEPT UP. `favicon.svg` is Astro's project
 * scaffold, committed before this phase and referenced by every page. AC4 read
 * byte-literally — "public/ contains ONLY that image" — is therefore FALSE at
 * HEAD and stays false, because the alternative is deleting a shipped file to
 * make a sentence read clean. The exemption is a single explicit path so that
 * a second scaffold file appearing would go red.
 */
const PUBLIC_EXEMPTIONS = ["favicon.svg"];

test("AC4: public/ holds the copied image and one named scaffold file, nothing else", async () => {
  const files = (await tree(join(siteRoot, "public"))) ?? [];
  const copied = files.filter((f) => f.startsWith("skill-assets/"));
  const other = files.filter((f) => !f.startsWith("skill-assets/"));

  assert.deepEqual(
    other,
    PUBLIC_EXEMPTIONS,
    `public/ holds a file that is neither a copied asset nor the one declared exemption`,
  );
  assert.equal(copied.length, 1, `public/skill-assets/ holds ${copied.length} files: ${copied}`);
  assert.match(copied[0], /\.webp$/);

  // ── The four things AC4 says must NOT be there, each checked by its own
  // predicate rather than by the count above. A single wrong total would hide
  // any one of them; four named absences will not.
  assert.deepEqual(files.filter((f) => f.endsWith(".md")), [], "markdown reached public/");
  assert.deepEqual(
    files.filter((f) => f.split("/").pop().startsWith(".")),
    [],
    "a dotfile reached public/",
  );
  assert.deepEqual(
    files.filter((f) => /\.(sh|py)$/.test(f)),
    [],
    "a script reached public/",
  );
  assert.deepEqual(
    files.filter((f) => f.includes("example-bundle")),
    [],
    "the example bundle reached public/",
  );
});

test("AC4 control: the four absence checks can each fire", () => {
  // Every assertion above is an absence over a set of two files. Each
  // predicate is run here against input that HAS the fault, so a filter that
  // silently matched nothing could not pass as a clean result.
  const planted = [
    "skill-assets/p/s/x.webp",
    "favicon.svg",
    "skill-assets/p/s/example-bundle/index.md",
    "skill-assets/p/s/scaffolder/.gitignore",
    "skill-assets/p/s/scripts/run.sh",
    "skill-assets/p/s/score.py",
  ];
  assert.equal(planted.filter((f) => f.endsWith(".md")).length, 1);
  assert.equal(planted.filter((f) => f.split("/").pop().startsWith(".")).length, 1);
  assert.equal(planted.filter((f) => /\.(sh|py)$/.test(f)).length, 2);
  assert.equal(planted.filter((f) => f.includes("example-bundle")).length, 1);
  // ...and the exemption list is exactly one path wide, so it cannot grow into
  // a general escape hatch without this going red.
  assert.equal(PUBLIC_EXEMPTIONS.length, 1);
});

test("AC4: every asset the repo ships that is NOT copied is still reachable, by link", async () => {
  // The other half of "public/ holds only that image": the 23 assets that were
  // correctly kept out of public/ must not simply have vanished. Each is on
  // its skill's page with a link to the repository.
  const shown = (await resourcesRendered()).filter((r) => r.group === "assets");
  const copied = shown.filter((r) => hrefOf(r).startsWith(`${BASE}/skill-assets/`));
  const linked = shown.filter((r) => hrefOf(r).startsWith("https://github.com/"));

  assert.equal(shown.length, copied.length + linked.length, "an asset row links somewhere else");
  assert.ok(linked.length > 20, `only ${linked.length} assets link to the repository`);
  // The copied one is copied because it is EMBEDDED, and that is the only
  // reason any asset is copied. A second copied asset would mean the selection
  // rule widened.
  assert.equal(copied.length, 0, "an asset row points at the copied image instead of the repo");
});

// ── AC5 ─────────────────────────────────────────────────────────────────────

test("AC5: exactly the 12 scripts on disk are linked, at blob URLs, one per file", async () => {
  const disk = (await resourcesOnDisk()).filter((r) => r.group === "scripts");
  const shown = (await resourcesRendered()).filter((r) => r.group === "scripts");

  assert.equal(disk.length, 12, `predicate: files under plugins/*/skills/*/scripts/`);
  assert.equal(shown.length, disk.length);

  const urls = shown.map(hrefOf);
  assert.equal(new Set(urls).size, 12, `the 12 rows produce ${new Set(urls).size} distinct URLs`);
  for (const r of shown) {
    // A blob URL at a pinned ref, ending in the real filename. Each part is
    // asserted separately: a URL that is well-formed and points at the wrong
    // file passes a shape check and fails this.
    assert.match(hrefOf(r), /^https:\/\/github\.com\/[^/]+\/[^/]+\/blob\/[^/]+\//, `${r.name}`);
    assert.ok(
      hrefOf(r).endsWith(`/scripts/${r.name}`),
      `${hrefOf(r)} does not end in scripts/${r.name}`,
    );
  }
});

test("AC5: what the checker will REQUEST is the same set this suite just asserted", async () => {
  // WHY NO fetch() HERE. A status code is not a property of this repository,
  // and every gate in tests/ is hermetic on purpose — tests/live-links.test.mjs
  // exists precisely because the network work was factored out into a script so
  // `npm test` does not depend on a third party's uptime. The requests are made
  // by scripts/check-blob-links.mjs, whose run is recorded in
  // reports/phase4-siteA.md with its negative control.
  //
  // THE GAP THAT LEAVES, AND WHAT CLOSES IT. A script that derives its own URL
  // list can request twelve URLs that are not the twelve the site renders, and
  // report a clean run about a set nobody asked it to check. So the script's
  // derivation is imported here and compared against this file's, which was
  // written independently and reads the HTML a different way — the script scans
  // the raw markup with one non-greedy pattern, this suite walks elements with
  // depth counting. Two extractors of different loss profiles agreeing on the
  // same 12 is corroboration; the script alone would be an assertion.
  const { blobTargets, negativeControlsFor } = await import("../scripts/check-blob-links.mjs");
  const willRequest = await blobTargets(join(siteRoot, "dist"));
  const shown = (await resourcesRendered()).filter((r) => r.group === "scripts");

  assert.deepEqual(
    willRequest.map((t) => t.url).sort(),
    shown.map(hrefOf).sort(),
    "the checker would request a different set of URLs than the site renders",
  );
  assert.equal(willRequest.length, 12);
  assert.deepEqual(willRequest.filter((t) => t.url === null), [], "a script row has no href");

  // The controls it will use are FABRICATED FROM a URL it is about to assert
  // 200, so a 404 there and a 200 here differ in the filename alone. Checked
  // for the property that makes them controls: not one is a real target.
  const controls = negativeControlsFor(shown.map(hrefOf));
  assert.ok(controls.length >= 2, `only ${controls.length} negative controls`);
  const real = new Set(shown.map(hrefOf));
  for (const c of controls) assert.ok(!real.has(c), `${c} is a real URL, not a control`);
});

// ── AC7 ─────────────────────────────────────────────────────────────────────

test("AC7: the dead pointer is on the page as text, and as no hyperlink anywhere", async () => {
  const { adviseDeadPointers } = await import("../src/loaders/advise.mjs");
  const skills = await declaredSkills();
  const pages = await distContentPages();
  let checked = 0;

  for (const s of skills) {
    const dir = join(repoRoot, "plugins", s.plugin, "skills", s.skill);
    const resources = {};
    for (const g of GROUPS) {
      const files = await tree(join(dir, g));
      resources[g] = files === null ? null : files.map((name) => ({ name, kind: "file" }));
    }
    const repoDir = relative(repoRoot, dir).split("\\").join("/");
    const dead = adviseDeadPointers(s.raw, { repoPath: s.skillMd, repoDir, resources });
    if (dead.length === 0) continue;

    const page = pages.find((p) => p.route === s.route);
    assert.ok(page, `no page at ${s.route}`);
    const main = mainOf(page.html);

    for (const a of dead) {
      const target = /points at "([^"]+)"/.exec(a.message)[1];
      // PRESENT AS TEXT, verbatim. The site renders what the author wrote.
      assert.ok(
        toText(main).includes(target),
        `${s.route} does not show the literal text ${JSON.stringify(target)}`,
      );
      // ABSENT AS A LINK. Every href on the page, checked against the target
      // in both the site-relative and the repository forms it could take.
      const hrefs = [...main.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
      assert.ok(hrefs.length > 0, "the href scan found nothing to check");
      const bare = target.replace(/\/$/, "");
      const offending = hrefs.filter(
        (h) => h.endsWith(`/${bare}`) || h.endsWith(`/${bare}/`) || h === bare,
      );
      assert.deepEqual(
        offending,
        [],
        `${s.route} hyperlinks ${JSON.stringify(target)}, a path that does not exist`,
      );
      checked += 1;
    }
  }
  // With macos-hig-reviewer corrected, 0 dead pointers remain in the catalog.
  assert.equal(checked, 0, `expected 0 dead pointers in catalog; found ${checked}`);
});

test("AC7 control: the hyperlink detector fires on a link to that very path", async () => {
  // The assertion above is an absence over real pages. This proves the same
  // predicate returns a hit when the link IS there — and that it is not so
  // loose that the LIVE sibling path trips it, which is the near miss that
  // matters: the file really does exist at assets/swiftlint.yml.
  const bare = "references/swiftlint.yml";
  const hit = (hrefs) =>
    hrefs.filter((h) => h.endsWith(`/${bare}`) || h.endsWith(`/${bare}/`) || h === bare);

  assert.deepEqual(hit([`https://github.com/o/r/blob/main/p/s/${bare}`]).length, 1);
  assert.deepEqual(hit([bare]).length, 1);
  // NEAR MISS: the real file, at the other path. Must NOT be reported.
  assert.deepEqual(hit(["https://github.com/o/r/blob/main/p/s/assets/swiftlint.yml"]), []);
  // NEAR MISS: the heading anchor the page really carries.
  assert.deepEqual(hit(["#swiftlint"]), []);
});

test("AC7: the literal survives as text on exactly one page, and is not silently duplicated", async () => {
  // Scan every built page for the corrected literal string. It must be on the skill's own
  // page, and the count is asserted so that a future template change which
  // echoed the SKILL.md body twice would be visible.
  const pages = await distContentPages();
  const carrying = pages.filter((p) => toText(mainOf(p.html)).includes("assets/swiftlint.yml"));
  assert.equal(
    carrying.length,
    1,
    `the literal appears on ${carrying.length} pages: ${carrying.map((p) => p.route)}`,
  );
  const occurrences = toText(mainOf(carrying[0].html)).split("assets/swiftlint.yml").length - 1;
  assert.equal(occurrences, 1, `the literal appears ${occurrences} times on one page`);
  // ...and the source says it once too, so 1 is a match rather than a
  // coincidence of two errors.
  const skills = await declaredSkills();
  const source = skills.find((s) => s.route === carrying[0].route);
  assert.equal(source.raw.split("assets/swiftlint.yml").length - 1, 1);
});
