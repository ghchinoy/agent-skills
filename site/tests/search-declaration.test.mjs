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

import { EXPECTED_ROUTES, BASE, dist, read, siteRoot, walk } from "./_helpers.mjs";
import { liveUrlForFile } from "../scripts/check-live-links.mjs";

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

/**
 * The source text of one expression starting at `at`, ending at the first comma
 * or closing bracket that is NOT inside a nested bracket, string or regex.
 *
 * A plain `/[^,}]+/` is not good enough and the failure is not hypothetical:
 * the real value is `` `/agent-skills`.replace(/\/$/,``)+`/pagefind/` `` and the
 * comma inside that regex literal truncates it to something that does not
 * parse. Worse than not parsing, a slightly different minifier output could
 * truncate to `` `/agent-skills` `` — which parses, yields a string, and is the
 * WRONG string. A reader that can be wrong quietly is the thing this file
 * exists to prevent, so the scan is real rather than approximate.
 */
function balancedExpression(source, at) {
  const skipQuoted = (i) => {
    const q = source[i];
    for (i += 1; i < source.length; i += 1) {
      if (source[i] === "\\") i += 1;
      else if (source[i] === q) return i + 1;
    }
    return source.length;
  };
  const skipRegex = (i) => {
    let inClass = false;
    for (i += 1; i < source.length; i += 1) {
      if (source[i] === "\\") i += 1;
      else if (source[i] === "[") inClass = true;
      else if (source[i] === "]") inClass = false;
      else if (source[i] === "/" && !inClass) {
        i += 1;
        while (i < source.length && /[a-z]/.test(source[i])) i += 1;
        return i;
      }
    }
    return source.length;
  };

  let i = at;
  let depth = 0;
  let prev = "";
  while (i < source.length) {
    const c = source[i];
    if (c === "'" || c === '"' || c === "`") {
      i = skipQuoted(i);
      prev = c;
      continue;
    }
    // A `/` is a regex only where an operand may begin. After an identifier or
    // a closing bracket it is division, and treating that as a regex would
    // swallow the rest of the file.
    if (c === "/" && (prev === "" || "(,=:[!&|?{};+-*%~^<>".includes(prev))) {
      i = skipRegex(i);
      prev = "/";
      continue;
    }
    if ("([{".includes(c)) depth += 1;
    else if (")]}".includes(c)) {
      if (depth === 0) break;
      depth -= 1;
    } else if (c === "," && depth === 0) break;
    if (!/\s/.test(c)) prev = c;
    i += 1;
  }
  return source.slice(at, i).trim();
}

/**
 * The bundle path the SEARCH LOADER computes at runtime, read out of the built
 * bundle rather than out of our own configuration.
 *
 * Starlight compiles the pagefind location into `dist/_astro/Search.*.js` as a
 * `bundlePath:` option whose value is an expression over the configured base —
 * today `` `/agent-skills`.replace(/\/$/,``)+`/pagefind/` ``. Evaluating the
 * expression rather than pattern-matching its current shape is deliberate: the
 * point is to compute what the CONSUMER computes, and a regex that extracted
 * only the leading literal would agree with the checker while the consumer
 * disagreed with both.
 *
 * THROWS rather than returns null when it cannot find or evaluate the
 * expression. A Starlight upgrade that renames the option must fail this test
 * loudly; a soft return would turn the coupling into a skip, which is the
 * "gate that cannot fire" shape the whole suite is written against, and the
 * skip would arrive exactly when the upgrade made the check most necessary.
 */
export function bundlePathFromBuiltLoader(source, where = "the built search loader") {
  const key = /bundlePath\s*:\s*/.exec(source);
  const m = key && [null, balancedExpression(source, key.index + key[0].length)];
  if (!m) {
    throw new Error(
      `${where} declares no bundlePath — the search loader no longer states where it fetches ` +
        `the index from, so nothing here can be compared against the checker`,
    );
  }
  let value;
  try {
    value = new Function(`return (${m[1]});`)();
  } catch (err) {
    throw new Error(
      `${where} computes bundlePath from something this test cannot evaluate ` +
        `(${m[1].trim()}): ${err.message}`,
    );
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${where} computes a non-string bundlePath: ${JSON.stringify(value)}`);
  }
  return value;
}

test("the search loader fetches from the path the checker verifies (AC3 consumer gap)", async () => {
  // THE GAP THE INDEPENDENT DESIGN READ FOUND IN THE ARTIFACT SWEEP, CLOSED FOR
  // 19 OF THE 32 NON-HTML FILES.
  //
  // The sweep proves every deployed file is present and byte-faithful AT THE
  // URL THE CHECKER DERIVES from its path. It does not prove any consumer asks
  // for that URL. For the 7 HTML pages the two coincide, because the crawl
  // reads the consumer's own markup. For the other 32 files THE ONLY REQUESTER
  // IN THE SYSTEM IS THE CHECKER ITSELF — it derives a URL, fetches it, and
  // agrees with itself.
  //
  // So a base-path regression confined to the search loader ships all 39 files,
  // serves all 39 byte-identical at the checker's URLs, passes every control in
  // this repository, and leaves search dead. That is the same outcome the
  // artifact sweep was commissioned to prevent, arriving through a cause nobody
  // enumerated: the fix was scoped to the DEMONSTRATION (drop pagefind) rather
  // than to the cause set (everything that produces dead search).
  //
  // DENOMINATOR, STATED. 39 dist files = 7 HTML + 32 non-HTML. Of the 32, 19
  // are pagefind/* and all 19 hang off this one literal — pagefind.js resolves
  // the entry JSON, the meta, the index, the fragments and the wasm relative to
  // bundlePath, and the entry-to-meta-to-fragment chain is already coupled by
  // the test at the top of this file. Of the remaining 13, ten _astro assets
  // and favicon.svg are referenced from HTML markup the crawl reads, so for
  // those the two derivations already coincide. THE RESIDUE IS TWO FILES: the
  // sitemaps, whose consumer is a search engine we cannot observe from here.
  // 19 of 32 closed, 11 of 32 already covered by the crawl, 2 of 32 open.
  //
  // WHAT THIS DOES NOT PROVE, and it is strictly narrower than AC3: that the
  // loader RUNS, or that pagefind resolves anything at runtime. A search box
  // wired to the right prefix and broken for any other reason passes this.
  const loaders = (await walk(dist)).filter(
    (f) => /[\\/]_astro[\\/]Search\..*\.js$/.test(f),
  );
  assert.equal(
    loaders.length,
    1,
    `expected exactly one built search loader in dist/_astro, found ${loaders.length} — ` +
      `the extraction below would otherwise be reading an arbitrary one of several`,
  );

  const bundlePath = bundlePathFromBuiltLoader(await read(loaders[0]), loaders[0]);

  // THE CHECKER'S SIDE, taken from the function the artifact sweep actually
  // calls rather than reassembled here. Reassembling it would make this a
  // comparison between two of our own copies, which is the F9 defect wearing a
  // different hat.
  const checkerUrl = liveUrlForFile("pagefind/pagefind.js", BASE);
  const checkerDir = `${checkerUrl.slice(0, checkerUrl.lastIndexOf("/"))}/`;

  assert.equal(
    bundlePath,
    checkerDir,
    `the search loader will fetch its index from ${bundlePath} and the artifact sweep ` +
      `verifies it at ${checkerDir}. Every file would be present, byte-identical and ` +
      `green at the checker's URL, and search would be dead at the consumer's.`,
  );

  // ...and the consumer's own path has to land on real artifact bytes. The
  // assertion above couples two derivations; this one anchors the pair to the
  // build, so the two agreeing about a path that ships nothing still fails.
  const rel = bundlePath.slice(BASE.length + 1);
  assert.ok(
    existsSync(join(dist, rel, "pagefind.js")),
    `the loader and the checker agree on ${bundlePath}, and no pagefind.js was built there`,
  );
});

test("CONTROL: the bundlePath reader fails loudly rather than skipping", () => {
  // Each of these is a way the extraction could go quiet and take the coupling
  // with it. A soft failure here is worse than no test, because it reports
  // green about a comparison it never made.
  assert.throws(
    () => bundlePathFromBuiltLoader("initSearch({ baseUrl: `/x` })"),
    /declares no bundlePath/,
    "a loader with no bundlePath was accepted",
  );
  assert.throws(
    () => bundlePathFromBuiltLoader("initSearch({ bundlePath: someRuntimeVariable })"),
    /cannot evaluate/,
    "an unevaluatable expression was accepted",
  );
  assert.throws(
    () => bundlePathFromBuiltLoader("initSearch({ bundlePath: 0 })"),
    /non-string/,
    "a non-string bundlePath was accepted",
  );

  // The positive half: the real shape, and a DIFFERENT real shape, both read
  // correctly. Without this the three throws above could all be passing because
  // the reader throws unconditionally.
  assert.equal(
    bundlePathFromBuiltLoader("x({baseUrl:`/agent-skills`,bundlePath:`/agent-skills`.replace(/\\/$/,``)+`/pagefind/`,showImages:!1})"),
    "/agent-skills/pagefind/",
  );
  assert.equal(
    bundlePathFromBuiltLoader('x({bundlePath:"/other/pagefind/"})'),
    "/other/pagefind/",
    "the reader only recognises this site's current value — it is matching, not evaluating",
  );

  // THE TRUNCATION CASE, WHICH IS THE ONE THAT WOULD HAVE BEEN WRONG QUIETLY.
  // The comma lives inside a regex literal. A naive `[^,}]+` stops there and
  // yields either a parse error or, on a different minifier output, the bare
  // base path — a string, plausible, and missing `/pagefind/`. The assertion
  // that matters is not that this throws; it is that it returns the RIGHT
  // string rather than a shorter one.
  assert.equal(
    bundlePathFromBuiltLoader("x({a:`/b`,bundlePath:`/base`.replace(/,$/,``)+`/pagefind/`,c:1})"),
    "/base/pagefind/",
    "the expression scanner truncated at a comma inside a regex literal",
  );
  // Nested calls and brackets, so a depth-blind scanner cannot pass.
  assert.equal(
    bundlePathFromBuiltLoader("x({bundlePath:[`/a`,`/b`].join(``)+`/pagefind/`,z:2})"),
    "/a/b/pagefind/",
    "the expression scanner stopped at a comma inside a nested array",
  );
  // Division after an identifier must not be read as a regex opening.
  assert.equal(
    bundlePathFromBuiltLoader("x({bundlePath:`/p${6/2}/`,z:2})"),
    "/p3/",
    "the scanner mistook a division for a regex literal",
  );
});
