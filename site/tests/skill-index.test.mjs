// skill-index.test.mjs — PHASE 4 ACCEPTANCE CRITERION 8.
//
//   "/skills/ lists all 23 with plugin attribution; filters labelled as plugin
//    keywords."
//
// Two halves, and the second is the one with teeth. Listing every skill is a
// completeness question a set comparison answers. LABELLING is a fabrication
// question: proposal §6.6 says there is no per-skill taxonomy in the data or in
// the standard, and that inventing one is the most tempting fabrication
// available here because a catalog wants facets. The only facet that exists is
// `keywords` in a plugin's `plugin.json`. So a filter is honest only if a
// reader cannot come away believing a skill declared the thing they clicked.
//
// THE 23 IS RE-DERIVED. It is not written as a literal anywhere below except
// where the derived population is asserted to equal it, with its predicate
// stated: the skills reachable from `.claude-plugin/marketplace.json` through
// each plugin's `skills/` directory, which is what `declaredSkills()` walks
// independently of the loader.
//
// WHAT THIS FILE DOES NOT CHECK, and why it is not a gap left silently: the
// filter's BEHAVIOUR when clicked. The chips are wired by an inline script and
// there is no DOM runtime in this suite, so no assertion here can show that
// clicking one hides the right rows. What is checked instead is everything the
// behaviour is derived from — that each row carries the keywords of the plugin
// that ships it, that the chip set and the row set are the same set, and that
// the whole list is in the markup before any script runs. A filter cannot show
// a skill under a keyword its plugin does not declare, because the attribute it
// reads is asserted here against plugin.json.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  declaredSkills,
  distContentPages,
  elementsWithAttr,
  mainOf,
  pageAt,
  toText,
} from "./_helpers.mjs";

/** The `/skills/` page's `<main>`, or a failure naming the route. */
async function skillsMain() {
  return mainOf(pageAt(await distContentPages(), "skills").html);
}

/** The rows of the skills list: `{ name, keywords, text, links }`. */
function rowsOf(main) {
  const [list] = elementsWithAttr(main, 'data-site-index="skills"');
  assert.ok(list, "the skills list is not on the page at all");
  return elementsWithAttr(list.inner, "data-index-entry").map((li) => ({
    name: (/data-entry-name[^>]*>/.exec(li.inner) ? toText(elementsWithAttr(li.inner, "data-entry-name")[0].inner) : null),
    keywords: (/data-keywords="([^"]*)"/.exec(li.open) ?? [, ""])[1].split(" ").filter(Boolean),
    text: toText(li.inner),
    links: [...li.inner.matchAll(/href="([^"]*)"/g)].map((m) => m[1]),
  }));
}

// ── "lists all 23" ──────────────────────────────────────────────────────────

test("AC8: the index lists exactly the skills the catalog declares", async () => {
  const declared = await declaredSkills();
  const rows = rowsOf(await skillsMain());

  // Predicate for the population: every skill reachable from
  // .claude-plugin/marketplace.json via each plugin's skills/ directory.
  assert.equal(declared.length, 23, "the declared skill population moved off 23");

  // As a SET, keyed on the Agent Skills `name` — the string `npx skills add`
  // takes, so a row that lists the right count under the wrong identifiers is
  // still a broken page.
  const want = declared.map((s) => s.declared.name).sort();
  const got = rows.map((r) => r.name).sort();
  assert.deepEqual(got, want, "the listed skills are not the declared skills");
  // Distinct: 23 rows for 22 skills and one duplicate would pass a set compare
  // if the set were built first.
  assert.equal(rows.length, declared.length, `${rows.length} rows for ${declared.length} skills`);
});

test("AC8: every row attributes its skill to the plugin that ships it, by link", async () => {
  const declared = await declaredSkills();
  const rows = rowsOf(await skillsMain());
  const byName = new Map(declared.map((s) => [s.declared.name, s]));

  for (const row of rows) {
    const source = byName.get(row.name);
    assert.ok(source, `${row.name} is on the page and not in the catalog`);
    // Attribution is a LINK to the plugin's own page, not a bare string: a
    // reader can go and check the claim.
    const href = row.links.find((h) => h.endsWith(`/plugins/${source.plugin}/`));
    assert.ok(href, `${row.name} does not link to plugins/${source.plugin}/: ${row.links}`);
    // ...and the visible text says the relationship, not only the plugin name.
    assert.match(row.text, /\bfrom\b/, `${row.name}'s attribution has no relationship word`);
  }
  assert.ok(rows.length > 0, "no rows were checked");
});

// ── "filters labelled as plugin keywords" ───────────────────────────────────

test("AC8: a row's keywords are its PLUGIN's keywords, and nothing else", async () => {
  // The fabrication this criterion exists to prevent. Each row's attribute is
  // compared against plugin.json read here, not against anything the loader
  // produced, so a keyword invented anywhere in the pipeline shows up as a
  // difference rather than as agreement between a value and its own copy.
  const declared = await declaredSkills();
  const rows = rowsOf(await skillsMain());
  const byName = new Map(declared.map((s) => [s.declared.name, s]));
  let withKeywords = 0;

  for (const row of rows) {
    const manifest = byName.get(row.name).manifest;
    const fromManifest = Array.isArray(manifest.keywords) ? [...manifest.keywords] : [];
    assert.deepEqual(
      [...row.keywords].sort(),
      fromManifest.slice().sort(),
      `${row.name} carries keywords its plugin.json does not declare`,
    );
    if (fromManifest.length > 0) withKeywords += 1;
    // A skill's OWN frontmatter declares no such field. If one ever appears,
    // this row's keywords stop being unambiguously the plugin's and the copy
    // around them needs rewriting before the field is rendered.
    for (const field of ["keywords", "tags", "categories", "topics"]) {
      assert.equal(
        byName.get(row.name).declared[field],
        undefined,
        `a SKILL.md now declares ${field} — §6.6's premise no longer holds`,
      );
    }
  }
  assert.ok(withKeywords > 0, "no row carried a keyword; the comparison proved nothing");
});

test("AC8: the chip set and the row set are the same set", async () => {
  const main = await skillsMain();
  const rows = rowsOf(main);
  const [filter] = elementsWithAttr(main, "data-keyword-filter");
  assert.ok(filter, "the filter control is not on the page");

  const chips = elementsWithAttr(filter.inner, "data-keyword").map((b) => ({
    value: /data-keyword="([^"]*)"/.exec(b.open)[1],
    label: /aria-label="([^"]*)"/.exec(b.open)?.[1] ?? null,
    text: toText(b.inner),
  }));
  const real = chips.filter((c) => c.value !== "");

  const fromRows = [...new Set(rows.flatMap((r) => r.keywords))].sort();
  assert.deepEqual(
    real.map((c) => c.value).sort(),
    fromRows,
    "a chip matches no row, or a row's keyword has no chip",
  );
  assert.ok(fromRows.length > 0, "there are no keywords, so this proved nothing");

  // Exactly one chip selects everything, and it is the one that starts pressed.
  const all = chips.filter((c) => c.value === "");
  assert.equal(all.length, 1, `${all.length} chips select the whole list`);
  assert.match(filter.inner, /data-keyword=""[^>]*aria-pressed="true"/);
});

test("AC8: every chip's accessible name says PLUGIN KEYWORD, in those words", async () => {
  const main = await skillsMain();
  const [filter] = elementsWithAttr(main, "data-keyword-filter");
  const real = elementsWithAttr(filter.inner, "data-keyword").filter(
    (b) => /data-keyword="[^"]+"/.test(b.open),
  );
  assert.ok(real.length > 0, "no keyword chips to check");

  for (const chip of real) {
    const label = /aria-label="([^"]*)"/.exec(chip.open)?.[1];
    assert.ok(label, `a chip has no accessible name: ${chip.open}`);
    assert.match(label, /^plugin keyword /, `a chip's accessible name is just "${label}"`);
  }
  // The heading over the control says it too, so a sighted reader who never
  // reaches an accessible name is told the same thing.
  assert.match(toText(filter.inner), /Filter by plugin keyword/);
  // And the note under it names the file the keywords come from and the party
  // that declares them, which is the whole content of §6.6's warning.
  const note = toText(filter.inner);
  assert.match(note, /plugin\.json/);
  assert.match(note, /not by the skill/);
});

test("AC8: no rendered label calls these tags, categories or topics", async () => {
  // fields.test.mjs already fails the run if one of these appears as a METADATA
  // LABEL anywhere on the site. This is the narrower, page-specific form: on
  // the one page that has a facet control, the words may appear only inside
  // prose that DENIES a per-skill taxonomy — never beside the chips.
  const main = await skillsMain();
  const [filter] = elementsWithAttr(main, "data-keyword-filter");
  const around = toText(filter.inner).toLowerCase();
  for (const word of ["tag", "tags", "category", "categories", "topic", "topics"]) {
    assert.ok(
      !new RegExp(`\\b${word}\\b`).test(around),
      `the filter control calls its values "${word}"`,
    );
  }

  // On the rows, the keyword line is prefixed with the same two words.
  const rows = rowsOf(main);
  const carrying = rows.filter((r) => r.keywords.length > 0);
  assert.ok(carrying.length > 0, "no row carries keywords");
  for (const row of carrying) {
    assert.match(
      row.text,
      /plugin keywords:/,
      `${row.name} prints keywords without saying whose they are`,
    );
  }
});

test("AC8 control: the label scanner fires on the words it is looking for", () => {
  // Every assertion in the test above is an absence. These are the same
  // predicates run against text that HAS the fault, so a scanner that matched
  // nothing could not pass as a clean page.
  const bad = toText("<p>Filter by tag</p><ul><li>Categories</li></ul>").toLowerCase();
  assert.ok(/\btag\b/.test(bad));
  assert.ok(/\bcategories\b/.test(bad));
  // ...and it does not fire on the real control's vocabulary.
  const good = "filter by plugin keyword declared by the plugin in its plugin.json".toLowerCase();
  for (const word of ["tag", "tags", "category", "categories", "topic", "topics"]) {
    assert.ok(!new RegExp(`\\b${word}\\b`).test(good), `false positive on "${word}"`);
  }
});

test("AC8: the whole list is in the markup, so a reader without JS sees all of it", async () => {
  const main = await skillsMain();
  const rows = rowsOf(main);
  const declared = await declaredSkills();

  // No row starts hidden. The script sets `hidden`; the served page must not.
  const prehidden = rows.filter((_, i) => {
    const [list] = elementsWithAttr(main, 'data-site-index="skills"');
    return /\bhidden\b/.test(elementsWithAttr(list.inner, "data-index-entry")[i].open);
  });
  assert.deepEqual(prehidden.map((r) => r.name), [], "a row is hidden in the served HTML");
  assert.equal(rows.length, declared.length);

  // Nor is the list built by the script: strip every <script> and the rows are
  // still there. This is the assertion that would fail if the markup were ever
  // moved into the client.
  const withoutScripts = main.replace(/<script[\s\S]*?<\/script>/gi, "");
  assert.equal(rowsOf(withoutScripts).length, declared.length, "the rows come from a script");

  // The count the note shows before any click is the full population, not a
  // number written by hand next to a list of a different length.
  const [filter] = elementsWithAttr(main, "data-keyword-filter");
  const shown = elementsWithAttr(filter.inner, "data-shown-count")[0];
  assert.equal(Number(toText(shown.inner)), declared.length);
});
