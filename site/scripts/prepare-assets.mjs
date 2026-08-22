// prepare-assets.mjs — the ONE exception to "resources are linked, not copied".
//
// Proposal §6.5: assets default to GitHub blob links, because a blob URL is
// canonical and carries history. Images are the exception the data forces —
// `<img src="https://github.com/…/blob/…/x.webp">` renders an HTML page, not an
// image — so an image asset embedded in a SKILL.md body must be copied
// somewhere the site can serve. That is `public/skill-assets/<plugin>/<skill>/`,
// and this script is the copy.
//
// ── THE SELECTION RULE, AND WHY IT IS NOT A GLOB ─────────────────────────────
//
// Copy exactly the assets that are the target of an IMAGE link in a SKILL.md
// body. Not "every file under assets/", not "every .webp". That rule selects a
// strict subset of the assets in the repo, and it keeps the okf-author skill's
// `assets/example-bundle/` markdown (I5) and `scaffolder/.gitignore` (I6) out
// of `public/` BY CONSTRUCTION rather than by an exclude list somebody has to
// maintain.
//
// NO COUNTS APPEAR IN THAT SENTENCE ON PURPOSE. It used to give three: how many
// files the rule selects, how many assets there are to select from, and how
// many markdown files the example bundle holds. Two were true and one was
// false — the false one copied from a comment in enumerate.mjs rather than
// measured, and wrong on the day it was written.
//
// ALL THREE ARE GONE RATHER THAN CORRECTED, AND THE TRUE ONES ARE THE POINT.
// A false literal is catchable by anyone who reads it against the tree. A
// true-but-unbound literal fails SILENTLY: it is correct today, nothing goes
// red on the day it stops being correct, and the next reader inherits it with
// no signal. Deleting a true unbound count removes a defect that has not fired
// yet; correcting it only resets the clock.
//
// Every claim those numbers decorated is ALREADY BOUND thirty lines away in
// `tests/assets.test.mjs`, which derives the denominator every run and asserts
// the RELATION instead of any literal, and derives the excluded set as the
// complement of the selection instead of listing it, with a non-vacuity floor
// and the leak set printed rather than counted. A prose count standing beside a
// test that derives the same population is not documentation — it is an
// unverified duplicate of a verified claim, and the duplicate is the copy that
// goes false. The remedy for a duplicate is deletion, not a second
// verification: binding the copy would leave two statements of one fact that
// can still disagree.
//
// ── HOW IT STAYS IN STEP WITH THE LOADER ─────────────────────────────────────
//
// The loader rewrites an image asset target to `/<base>/skill-assets/<p>/<s>/<f>`
// (see links.mjs). If this script's idea of "which targets are image links"
// ever differed from the loader's, the site would ship a 404 image with a green
// build. So it does not have its own idea: it runs the SAME `rewriteLinks`
// parser over the SAME body the loader renders — post-frontmatter,
// post-leading-H1-strip — and collects the targets that reach the image branch.
// Divergence would require editing markdown.mjs to behave differently on two
// calls with the same input.
//
// It also runs the same spec-conformant `enumerate()`, so it can never reach a
// directory the loader cannot reach (§7.1: no recursion below skills/<skill>/).
//
// Idempotent: the output directory is removed and rebuilt on every run, so a
// deleted image link cannot leave a stale file behind in `public/`.

import { mkdir, copyFile, rm, stat } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

import { enumerate, nodeFs } from "../src/loaders/enumerate.mjs";
import { splitFrontmatter } from "../src/loaders/frontmatter.mjs";
import { rewriteLinks, stripLeadingH1 } from "../src/loaders/markdown.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = join(here, "..");
const repoRoot = join(siteRoot, "..");

/** Where the copies land. Mirrored by the `/skill-assets/` URL prefix. */
export const OUT_DIR_NAME = "skill-assets";

/**
 * Every image asset an enumerated SKILL.md body embeds, as
 * `{ plugin, skill, rest, from, to }`. Exported so a test can assert the
 * SELECTION without performing the copy.
 */
export async function selectImageAssets({ root = repoRoot, fs = nodeFs } = {}) {
  const { plugins } = await enumerate({ repoRoot: root, fs });
  const picked = [];
  const seen = new Set();

  for (const plugin of plugins) {
    for (const skill of plugin.skills) {
      const raw = await fs.readFile(skill.skillMdPath, "utf8");
      const { body } = splitFrontmatter(raw, skill.repoPath);
      const { body: withoutH1 } = stripLeadingH1(body);

      rewriteLinks(withoutH1, (target, at) => {
        if (!at.isImage) return target;
        // Same guards as links.mjs, in the same order, and deliberately NOT
        // "anything under assets/": an external image or an in-page anchor is
        // not ours to copy.
        if (/^(https?:|mailto:|tel:|data:|ftp:)/i.test(target)) return target;
        if (target.startsWith("#") || target.startsWith("/")) return target;
        const path = target.split("#")[0].replace(/^\.\//, "");
        const m = /^assets\/(.+)$/.exec(path);
        if (!m) return target;
        const rest = m[1];
        const key = `${plugin.name}/${skill.name}/${rest}`;
        if (seen.has(key)) return target;
        seen.add(key);
        picked.push({
          plugin: plugin.name,
          skill: skill.name,
          rest,
          repoPath: `${skill.repoDir}/assets/${rest}`,
          from: join(skill.dir, "assets", ...rest.split("/")),
          to: posix.join(plugin.name, skill.name, rest),
          declaredIn: skill.repoPath,
        });
        return target;
      });
    }
  }
  return picked;
}

async function main() {
  const outRoot = join(siteRoot, "public", OUT_DIR_NAME);
  const picked = await selectImageAssets();

  // Remove first, unconditionally. Not "if there is anything to copy": a run
  // that selects nothing must also leave nothing behind from a previous run.
  await rm(outRoot, { recursive: true, force: true });

  for (const asset of picked) {
    // A missing source here is a build error, not a warning. The alternative is
    // publishing a page whose <img> 404s, which is precisely the failure this
    // whole copy step exists to prevent.
    let st;
    try {
      st = await stat(asset.from);
    } catch (err) {
      throw new Error(
        `prepare-assets: ${asset.declaredIn} embeds "assets/${asset.rest}" as ` +
          `an image, but ${asset.repoPath} is not readable. ${err.message}`,
      );
    }
    if (!st.isFile()) {
      throw new Error(
        `prepare-assets: ${asset.repoPath} is not a regular file, so it cannot ` +
          `be served as the image ${asset.declaredIn} embeds.`,
      );
    }
    const dest = join(outRoot, ...asset.to.split("/"));
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(asset.from, dest);
  }

  const n = picked.length;
  console.log(
    `prepare-assets: copied ${n} image asset${n === 1 ? "" : "s"} into ` +
      `public/${OUT_DIR_NAME}/ (selected by image-link reference from an ` +
      `enumerated SKILL.md body; the repo's other assets are linked to GitHub).`,
  );
  for (const a of picked) console.log(`  ${a.repoPath} -> public/${OUT_DIR_NAME}/${a.to}`);
}

// Only when run as a script; importing it for the selection must not copy.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
