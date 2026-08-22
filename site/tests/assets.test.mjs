// assets.test.mjs — the one place this site COPIES a repository file instead of
// linking to it, and the gate that keeps the copy and the link in step.
//
// Proposal §6.5: a resource is listed by real filename and linked to its GitHub
// blob, because a blob URL is canonical and carries history. Images are the
// exception the data forces — a blob URL in an `<img src>` renders GitHub's
// HTML page, not the image — so an image a SKILL.md body embeds is copied into
// `public/skill-assets/<plugin>/<skill>/` by scripts/prepare-assets.mjs and
// served from there.
//
// TWO PROGRAMS NOW HAVE TO AGREE. The loader (links.mjs) rewrites an image
// target to `/<base>/skill-assets/<p>/<s>/<f>`; the copier decides which files
// land at those paths. Disagreement ships a 404 image with a green build, and
// nothing else in the suite would notice, because a missing image is not a
// missing page. That is what this file is for, and it checks the agreement in
// both directions:
//
//   selection ⊆ shipped   every asset the copier picked is in dist/
//   shipped ⊆ selection   nothing else is, so the copy cannot accumulate
//   rendered = shipped    every <img> the pages emit names a shipped file,
//                         and every shipped file is named by some page
//
// The third is the one that matters, and it is an equality rather than a subset
// in both directions on purpose: a subset check in either direction alone
// passes on an empty site.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

import { nodeFs } from "../src/loaders/enumerate.mjs";
import { OUT_DIR_NAME, selectImageAssets } from "../scripts/prepare-assets.mjs";

import { BASE, dist, distContentPages, mainOf, repoRoot, walk } from "./_helpers.mjs";

/** Every regular file under any `assets/` directory in the repository. */
async function everyAssetFile() {
  const out = [];
  const visit = async (dir) => {
    let ents;
    try {
      ents = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        await visit(p);
      } else if (e.isFile()) {
        out.push(relative(repoRoot, p).split("\\").join("/"));
      }
    }
  };
  await visit(join(repoRoot, "plugins"));
  return out.filter((p) => p.includes("/assets/"));
}

/** Everything actually shipped under `dist/skill-assets/`, as `<p>/<s>/<rest>`. */
async function shippedAssets() {
  const root = join(dist, OUT_DIR_NAME);
  try {
    await stat(root);
  } catch {
    return [];
  }
  return (await walk(root)).map((f) => relative(root, f).split("\\").join("/")).sort();
}

test("the selection rule picks image-linked assets only, and it is a small minority", async () => {
  // THE POPULATION AND ITS DENOMINATOR. "One asset is copied" means nothing
  // without "out of how many", and the denominator is the whole point of the
  // rule: the copier is not a glob over assets/, it is a reference scan.
  const picked = await selectImageAssets();
  const all = await everyAssetFile();

  assert.ok(all.length > 0, "no asset files found in the repository at all");
  assert.ok(picked.length > 0, "nothing was selected — the selection branch never ran");
  assert.ok(
    picked.length < all.length,
    `the selection took ${picked.length} of ${all.length} asset files, which is all of ` +
      `them — the rule has degenerated into a glob`,
  );

  // Every selected file exists and is a real file, named by its repo path.
  for (const a of picked) {
    const st = await stat(join(repoRoot, ...a.repoPath.split("/")));
    assert.ok(st.isFile(), `${a.repoPath} was selected and is not a regular file`);
  }

  // Every selected file is an IMAGE by extension. Not the selection rule — the
  // rule is "target of an image link" — but a cheap independent cross-check
  // that would catch the rule going wrong in the direction that matters.
  for (const a of picked) {
    assert.match(
      a.rest,
      /\.(png|jpe?g|gif|webp|avif|svg)$/i,
      `${a.repoPath} was selected as an image and does not look like one`,
    );
  }
});

test("I5/I6: the files the selection rule excludes are not in dist, by construction", async () => {
  // The excluded set, DERIVED as the complement rather than listed. The
  // example bundle's markdown files and the scaffolder's dotfile are in here
  // because they are assets that no SKILL.md embeds as an image, not because
  // anybody wrote their names into an exclude list.
  const picked = await selectImageAssets();
  const selected = new Set(picked.map((a) => a.repoPath));
  const excluded = (await everyAssetFile()).filter((p) => !selected.has(p));
  assert.ok(excluded.length > 0, "nothing is excluded — there is no complement to check");

  const shipped = new Set(await shippedAssets());
  const leaked = [];
  for (const p of excluded) {
    // A shipped path is `<plugin>/<skill>/<rest>`; an excluded repo path ends
    // with the same `<rest>` under the same skill. Compare on the basename,
    // which over-reports rather than under-reports, and is therefore the safe
    // direction for an absence claim.
    const base = p.split("/").pop();
    for (const s of shipped) if (s.split("/").pop() === base) leaked.push(`${p} -> ${s}`);
  }
  assert.deepEqual(leaked, [], `excluded assets reached dist/:\n${leaked.join("\n")}`);

  // NON-VACUITY, and the specific instances the phase log names: the excluded
  // set really does contain the example bundle's markdown and a dotfile, so
  // this check is sweeping something rather than an empty complement.
  assert.ok(
    excluded.some((p) => /\.md$/i.test(p)),
    "no markdown file is in the excluded asset set — I5 is no longer being tested",
  );
});

test("selection and shipped artifact are the same set, in both directions", async () => {
  const picked = await selectImageAssets();
  const shipped = await shippedAssets();
  assert.deepEqual(
    shipped,
    picked.map((a) => a.to).sort(),
    "the files under dist/skill-assets/ are not exactly the files the selection picked",
  );
  assert.ok(shipped.length > 0, "nothing shipped — the equality above is between two empty sets");
});

test("every rendered <img> names a shipped file, and every shipped file is rendered", async () => {
  // The agreement between the loader's URL and the copier's path, measured on
  // the artifact rather than on either program's intentions.
  const pages = await distContentPages();
  const prefix = `${BASE}/${OUT_DIR_NAME}/`;
  const referenced = new Set();
  let imgs = 0;

  for (const p of pages) {
    for (const m of mainOf(p.html).matchAll(/<img\b[^>]*?\ssrc="([^"]*)"/g)) {
      const src = m[1];
      imgs += 1;
      if (!src.startsWith(prefix)) continue;
      referenced.add(src.slice(prefix.length));
      // Resolves to a real file in the artifact, which is the failure a reader
      // would actually see.
      const onDisk = join(dist, OUT_DIR_NAME, ...src.slice(prefix.length).split("/"));
      const st = await stat(onDisk).catch(() => null);
      assert.ok(st?.isFile(), `${p.route}: <img src="${src}"> resolves to no file in dist/`);
    }
  }

  assert.ok(imgs > 0, "no <img> was rendered anywhere — this sweep found nothing to check");
  const shipped = await shippedAssets();
  assert.deepEqual(
    [...referenced].sort(),
    shipped,
    "the set of images the pages reference is not the set of images the build shipped — " +
      "either a page 404s or dist/ carries a file nothing points at",
  );
});

test("each selected asset is embedded on the page of the skill that declared it", async () => {
  // The rule the whole site runs on, applied to images: a value renders on the
  // page of the entity that declared it. An asset embedded by skill A must not
  // appear on skill B's page under A's URL.
  const picked = await selectImageAssets();
  const pages = await distContentPages();
  for (const a of picked) {
    const route = `plugins/${a.plugin}/${a.skill}`;
    const page = pages.find((p) => p.route === route);
    assert.ok(page, `${a.repoPath} was selected for a skill with no page at ${route}`);
    const expected = `${BASE}/${OUT_DIR_NAME}/${a.to}`;
    assert.ok(
      mainOf(page.html).includes(`src="${expected}"`),
      `${route} does not embed ${expected}, which its SKILL.md declares`,
    );
  }
  assert.ok(picked.length > 0, "no asset was checked");
});

// ── Controls ────────────────────────────────────────────────────────────────
//
// Both plant through a WRAPPING filesystem: `nodeFs` with `readFile`
// intercepted for one file. Nothing on disk is touched, and the planted body
// travels through the real `enumerate`, `splitFrontmatter`, `stripLeadingH1`
// and `rewriteLinks` — which is the point. A control that called the selection
// rule's regexp directly would prove the regexp works and say nothing about
// whether the pipeline reaches it.

/** `nodeFs`, with `path`'s contents replaced by `rewrite(original)`. */
function fsWithBody(path, rewrite) {
  let hits = 0;
  return {
    ...nodeFs,
    async readFile(p, enc) {
      const original = await readFile(p, enc);
      if (p === path) {
        hits += 1;
        return rewrite(original);
      }
      return original;
    },
    get hits() {
      return hits;
    },
  };
}

test("CONTROL: an image link planted in a SKILL.md body is selected", async () => {
  // POSITIVE. Without this, "the selection found exactly the assets we expect"
  // is equally consistent with a selection rule that has stopped running.
  const before = await selectImageAssets();
  assert.ok(before.length > 0, "no baseline selection to add to");
  const victim = before[0];
  const target = join(repoRoot, ...victim.declaredIn.split("/"));

  const fs = fsWithBody(target, (src) => `${src}\n\n![planted](assets/planted-control.png)\n`);
  const after = await selectImageAssets({ fs });

  assert.equal(fs.hits, 1, "the plant never reached the file it was supposed to rewrite");
  assert.equal(
    after.length,
    before.length + 1,
    `planting one image link changed the selection by ${after.length - before.length}`,
  );
  const planted = after.find((a) => a.rest === "planted-control.png");
  assert.ok(planted, "the planted image link was not selected");
  assert.equal(planted.plugin, victim.plugin);
  assert.equal(planted.skill, victim.skill);
  assert.equal(planted.to, `${victim.plugin}/${victim.skill}/planted-control.png`);
});

test("CONTROL: the same target as an ordinary LINK is not selected", async () => {
  // NEGATIVE, and it is the near miss: identical target, identical directory,
  // one exclamation mark apart. A selection rule that globbed `assets/` — or
  // that scanned for the string rather than the image branch — would take this
  // and would look correct on the positive control above.
  const before = await selectImageAssets();
  const victim = before[0];
  const target = join(repoRoot, ...victim.declaredIn.split("/"));

  const fs = fsWithBody(target, (src) => `${src}\n\n[planted](assets/planted-control.png)\n`);
  const after = await selectImageAssets({ fs });

  assert.equal(fs.hits, 1, "the plant never reached the file");
  assert.equal(
    after.length,
    before.length,
    "a non-image link to assets/ was selected for copying",
  );
  assert.ok(!after.some((a) => a.rest === "planted-control.png"));
});

test("CONTROL: an image link inside a fenced block is not selected", async () => {
  // NEGATIVE, second shape. Documentation about how to embed an image is not
  // an embedded image, and this catalog is a catalog of documentation.
  const before = await selectImageAssets();
  const victim = before[0];
  const target = join(repoRoot, ...victim.declaredIn.split("/"));

  const fs = fsWithBody(
    target,
    (src) => `${src}\n\n\`\`\`markdown\n![planted](assets/planted-control.png)\n\`\`\`\n`,
  );
  const after = await selectImageAssets({ fs });

  assert.equal(fs.hits, 1, "the plant never reached the file");
  assert.equal(after.length, before.length, "an image link inside a code fence was selected");
});

test("CONTROL: an external or absolute image is not copied", async () => {
  // NEGATIVE, third shape: not ours to copy, and copying it would turn a
  // remote reference into a stale local one.
  const before = await selectImageAssets();
  const victim = before[0];
  const target = join(repoRoot, ...victim.declaredIn.split("/"));

  for (const src of [
    "https://example.invalid/x.png",
    "/already/absolute.png",
    "../outside/x.png",
  ]) {
    const fs = fsWithBody(target, (body) => `${body}\n\n![planted](${src})\n`);
    const after = await selectImageAssets({ fs });
    assert.equal(fs.hits, 1, `the plant never reached the file for ${src}`);
    assert.equal(after.length, before.length, `${src} was selected for copying`);
  }
});
