// search-declaration.test.mjs — the build DELIVERS what the config DECLARES.
//
// The gap this closes was found by a blind design read of the live checker, and
// it is the class-level version of the finding the live checker was written for.
// The live check compares the deployment against `dist/`. So a file missing
// from the DEPLOYMENT is caught, and a file missing from `dist/` is invisible:
// both sides agree, and the run exits 0. A live check's notion of correct is
// whatever the build produced.
//
// Concretely: a Starlight upgrade, an accidental `pagefind: false`, or a no-op
// integration hook drops the search bundle out of `dist/`. Every page still
// renders, every link still resolves, the artifact sweep verifies all of the
// remaining files byte-for-byte, and the site ships with its search box wired
// to nothing. Nothing in this repository would have noticed.
//
// WHAT THIS TEST ASSERTS, AND WHY IT IS NOT "pagefind/ EXISTS". Asserting the
// files exist is instance-level, and it would be the same defect one layer up:
// it hard-codes today's answer, and the day someone deliberately turns search
// off it fails for being right. So the test reads the DECLARATION out of
// astro.config.mjs and requires the artifact to match it — search on means a
// coherent index must ship, search off means one must not. The declaration
// moves, the expectation follows, and nobody has to remember this file.
//
// It also runs BEFORE the merge, in site-ci, where the live check cannot: the
// live check runs after `deploy-pages`, so at best it detects. This blocks.
//
// DELIBERATELY NOT ASSERTED: pagefind's internal index integrity — one
// fragment per indexed page is checked here, but nothing reads the index or
// meta formats. Those are unversioned and change between pagefind releases, so
// coupling to them buys a Starlight-upgrade breakage in exchange for a failure
// mode nobody has observed. Recorded as a decision with a reason so a later
// phase can revisit it on the merits rather than assume it was overlooked.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EXPECTED_ROUTES, dist, read, siteRoot } from "./_helpers.mjs";

/**
 * Is site search DECLARED on?
 *
 * Starlight ships search enabled and it is switched off with `pagefind: false`.
 * astro.config.mjs carries a long comment explaining why this site deliberately
 * keeps it when the sibling project disables it, so "on" here is a choice that
 * was argued for, not a default nobody looked at.
 */
export function searchDeclaredOn(configSource) {
  return !/\bpagefind\s*:\s*false\b/.test(configSource);
}

/**
 * Everything wrong with the built search index, given what was declared.
 * Returns reasons, so a failure names the problem instead of asserting `true`.
 */
export async function searchProblems(distDir, declaredOn, expectedPages) {
  const problems = [];
  const dir = join(distDir, "pagefind");
  const entryPath = join(dir, "pagefind-entry.json");

  if (!declaredOn) {
    if (existsSync(dir)) {
      problems.push("search is declared OFF but a pagefind bundle was built anyway");
    }
    return problems;
  }

  if (!existsSync(dir)) {
    problems.push(
      "search is declared ON and dist/pagefind/ does not exist — the site would ship a " +
        "search box wired to nothing",
    );
    return problems;
  }
  if (!existsSync(entryPath)) {
    problems.push("dist/pagefind/pagefind-entry.json is missing — the bundle has no entry point");
    return problems;
  }

  let entry;
  try {
    entry = JSON.parse(await readFile(entryPath, "utf8"));
  } catch (err) {
    problems.push(`pagefind-entry.json is not readable JSON: ${err.message}`);
    return problems;
  }

  const languages = Object.entries(entry.languages ?? {});
  if (languages.length === 0) {
    problems.push("pagefind-entry.json indexes no languages at all");
    return problems;
  }

  let indexed = 0;
  for (const [lang, meta] of languages) {
    indexed += meta.page_count ?? 0;
    // The entry NAMES a meta file. Following the name is what distinguishes a
    // coherent bundle from a directory that merely has files in it.
    if (!meta.hash) {
      problems.push(`language ${lang} declares no index hash`);
    } else if (!existsSync(join(dir, `pagefind.${meta.hash}.pf_meta`))) {
      problems.push(
        `language ${lang} names index ${meta.hash} but pagefind.${meta.hash}.pf_meta was not built`,
      );
    }
  }

  if (indexed !== expectedPages) {
    problems.push(
      `the index covers ${indexed} page(s) and the site builds ${expectedPages} content page(s) — ` +
        `search would silently miss ${Math.abs(expectedPages - indexed)} of them`,
    );
  }

  const fragments = existsSync(join(dir, "fragment"))
    ? (await readdir(join(dir, "fragment"))).filter((f) => f.endsWith(".pf_fragment"))
    : [];
  if (fragments.length !== indexed) {
    problems.push(
      `${indexed} page(s) indexed but ${fragments.length} fragment(s) built — a page in the ` +
        `index with no fragment is a search result that cannot be displayed`,
    );
  }

  return problems;
}

test("the built search index matches what astro.config.mjs declares", async () => {
  const config = await read(join(siteRoot, "astro.config.mjs"));
  const problems = await searchProblems(dist, searchDeclaredOn(config), EXPECTED_ROUTES.length);
  assert.deepEqual(problems, [], `the search declaration is not honoured:\n${problems.join("\n")}`);
});

test("CONTROL: the search check fires on every way the index can go missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "pagefind-control-"));
  const build = async (name, files) => {
    const d = join(root, name);
    await mkdir(join(d, "pagefind", "fragment"), { recursive: true });
    for (const [p, body] of Object.entries(files)) {
      await writeFile(join(d, "pagefind", p), body);
    }
    return d;
  };

  const good = {
    "pagefind-entry.json": JSON.stringify({ languages: { en: { hash: "en_abc", page_count: 2 } } }),
    "pagefind.en_abc.pf_meta": "meta",
    "fragment/a.pf_fragment": "a",
    "fragment/b.pf_fragment": "b",
  };

  // The control's own control: a coherent bundle must produce NO problems, or
  // every assertion below would pass for the wrong reason.
  assert.deepEqual(await searchProblems(await build("ok", good), true, 2), []);

  // Declared on, nothing built at all — the pagefind-vanishes case.
  const empty = join(root, "empty");
  await mkdir(empty, { recursive: true });
  const gone = await searchProblems(empty, true, 2);
  assert.ok(gone.some((p) => /does not exist/.test(p)), `expected a missing-bundle problem: ${gone}`);

  // Built, but the entry names an index that was not produced.
  const dangling = await searchProblems(
    await build("dangling", { ...good, "pagefind-entry.json": JSON.stringify({ languages: { en: { hash: "en_zzz", page_count: 2 } } }) }),
    true,
    2,
  );
  assert.ok(dangling.some((p) => /pf_meta was not built/.test(p)), `expected a dangling index: ${dangling}`);

  // Built and coherent, but covering fewer pages than the site has. This is the
  // shape a search that silently stops indexing new content takes.
  const partial = await searchProblems(await build("partial", good), true, 5);
  assert.ok(partial.some((p) => /silently miss/.test(p)), `expected a coverage problem: ${partial}`);

  // Indexed pages with no fragments to render.
  const nofrags = await searchProblems(
    await build("nofrags", {
      "pagefind-entry.json": good["pagefind-entry.json"],
      "pagefind.en_abc.pf_meta": "meta",
    }),
    true,
    2,
  );
  assert.ok(nofrags.some((p) => /fragment/.test(p)), `expected a fragment problem: ${nofrags}`);

  // And the other direction: declared OFF, but a bundle shipped anyway.
  const unwanted = await searchProblems(await build("unwanted", good), false, 2);
  assert.ok(unwanted.some((p) => /declared OFF/.test(p)), `expected an unwanted-bundle problem: ${unwanted}`);
});

test("CONTROL: the declaration reader distinguishes on from off", () => {
  assert.equal(searchDeclaredOn("starlight({ title: 'x' })"), true, "default is search ON");
  assert.equal(searchDeclaredOn("starlight({ pagefind: false })"), false);
  assert.equal(searchDeclaredOn("starlight({ pagefind:false })"), false);
  assert.equal(searchDeclaredOn("starlight({ pagefind: true })"), true);

  // NEAR MISS: the config contains the words "pagefind" and "false" in prose
  // explaining why the sibling project disables it. A looser reader would find
  // them and conclude this site has search switched off.
  // The prose is LOWERCASE on purpose. It read "Pagefind" with a capital, and
  // mutation showed the whole point of the control evaporated: a loose reader
  // spelled `includes("pagefind") && includes("false")` is case-sensitive, so
  // it never matched the capitalised word and the near miss passed for a reason
  // that had nothing to do with the property being tested. A control has to
  // fail against the weaker implementation it is defending against.
  assert.equal(
    searchDeclaredOn("// binder disables pagefind because false claims are bad\nstarlight({})"),
    true,
    "the reader was fooled by a comment mentioning pagefind and false",
  );
  assert.equal(searchDeclaredOn("// see docs: pagefind\nconst x = false;\nstarlight({})"), true);
});
