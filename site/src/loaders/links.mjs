// links.mjs — the §6.5 link-rewriting table, implemented as a total function
// over the forms that actually occur, with a HARD BUILD ERROR for everything
// else.
//
// The error is the point. A link rewriter that silently passes an unrecognised
// target through produces a page with a dead relative href and no complaint,
// which is exactly the failure mode a docs site cannot detect by looking at it.
// So `resolveTarget` either returns a URL it can justify or throws with the
// file, the line and the target.
//
// §6.5 table, and the two deliberate non-rewrites:
//
//   references/<f>.md               -> /<base>/plugins/<p>/<s>/references/<f>/
//   ../../references/<f>.md         -> /<base>/plugins/<p>/references/<f>/     (D3)
//   ../<other-skill>/SKILL.md       -> /<base>/plugins/<p>/<other-skill>/      (D3-shaped)
//   references/<f>.{swift,sql,...}  -> GitHub blob URL      (not routed)
//   scripts/<f>                     -> GitHub blob URL      (not routed)
//   assets/<f>            (link)    -> GitHub blob URL
//   assets/<f>            (image)   -> /<base>/skill-assets/<p>/<s>/<f>
//   assets/<dir>/         (link)    -> GitHub tree URL
//   sibling <f>.md inside a ref     -> sibling reference page URL
//   http(s):, mailto:, tel:, #frag  -> untouched
//   a site-absolute /path           -> HARD BUILD ERROR (see below)
//   text inside code                -> never reaches here at all              (D4)
//
// On site-absolute targets. These used to pass through untouched, which was
// the one silent pass-through left in this file and exactly what §6.5 says
// must never happen: a dead `/tables/customers.md` reached `dist/` with no
// error and no advisory. There is no rule that could rewrite one correctly
// either. A leading `/` in a SKILL.md means the filesystem root, and a skill
// is a portable directory — it cannot know what a deployed site's root is, and
// the site's own routes are all base-prefixed (`/agent-skills/...`) by this
// loader after resolution, never hand-written in source. So the honest
// treatment is the one §6.5 prescribes for a target that resolves to nothing:
// stop the build and name the file, the line and the target.

/**
 * @typedef {object} LinkContext
 * @property {"skill"|"reference"} kind
 * @property {string} base            Astro `base`, e.g. "/agent-skills"
 * @property {string} blobBase        e.g. "https://github.com/o/r/blob/main"
 * @property {string} treeBase        e.g. "https://github.com/o/r/tree/main"
 * @property {string} plugin          plugin slug
 * @property {string} [skill]         skill slug. Set for a SKILL.md body, and
 *   for a SKILL-LEVEL reference body; absent for a plugin-level reference
 *   body, which is what distinguishes the two reference scopes.
 * @property {string} pluginRepoPath  e.g. "plugins/okf-authoring"
 * @property {Set<string>} routedPluginRefs   plugin-level reference slugs
 * @property {Set<string>} routedSkillRefs    this skill's routed reference slugs
 * @property {Set<string>} routedSkills       sibling skill slugs in this plugin
 * @property {object|null} resources          depth-1 inventory for this skill
 * @property {string} sourceRepoPath          for error and advisory messages
 * @property {(a: object) => void} note       advisory sink
 */

const EXTERNAL = /^(https?:|mailto:|tel:|data:|ftp:)/i;

/** Splits `path#anchor` without losing an empty anchor. */
function splitAnchor(target) {
  const i = target.indexOf("#");
  if (i === -1) return [target, ""];
  return [target.slice(0, i), target.slice(i)];
}

function fail(target, ctx, line, why) {
  return new Error(
    `skills-loader: unresolvable link target "${target}" at ` +
      `${ctx.sourceRepoPath}:${line} — ${why}\n` +
      `  A link this loader cannot resolve is a build error, never a silent ` +
      `pass-through: the alternative is publishing a dead href that nothing ` +
      `checks. Add a rule to site/src/loaders/links.mjs, or fix the source link.`,
  );
}

/**
 * Resolves ONE link target.
 *
 * @param {string} target
 * @param {{line: number, isImage: boolean}} at
 * @param {LinkContext} ctx
 * @returns {string}
 */
export function resolveTarget(target, at, ctx) {
  const { line, isImage } = at;

  if (target === "" ) throw fail(target, ctx, line, "empty target.");
  if (EXTERNAL.test(target)) return target;
  if (target.startsWith("#")) return target; // in-page anchor
  // Site-absolute. Not passed through — see the header note.
  if (target.startsWith("/")) {
    throw fail(
      target,
      ctx,
      line,
      `site-absolute link targets are not resolvable from a portable skill ` +
        `directory: a leading "/" names the filesystem root, and this site's ` +
        `own routes are base-prefixed by the loader rather than written in ` +
        `source. Use a path relative to the skill root, or a full URL.`,
    );
  }

  const [rawPath, anchor] = splitAnchor(target);
  const path = rawPath.replace(/^\.\//, "");

  if (ctx.kind === "reference") return resolveFromReference(path, anchor, target, at, ctx);
  return resolveFromSkill(path, anchor, target, at, ctx);
}

function resolveFromSkill(path, anchor, target, at, ctx) {
  const { line, isImage } = at;
  const { base, blobBase, treeBase, plugin, skill, pluginRepoPath } = ctx;
  const skillRepoDir = `${pluginRepoPath}/skills/${skill}`;

  // ── ../../references/<f> — escapes the SKILL root into the PLUGIN root ─────
  // D3. Not unsafe (Agent Plugins §4.1 only bounds the PLUGIN root, and the
  // target is inside it) but it is a portability wrinkle: copying the skill
  // directory alone breaks the link. Reported, not repaired.
  let m = /^\.\.\/\.\.\/references\/(.+)$/.exec(path);
  if (m) {
    const file = m[1];
    ctx.note({
      code: "D3",
      file: ctx.sourceRepoPath,
      line,
      message:
        `link "${target}" escapes the skill root to reach ` +
        `${pluginRepoPath}/references/${file}. Agent Skills says to use ` +
        `relative paths from the skill root and to keep file references one ` +
        `level deep; a plugin-level references/ is also not a spec-defined ` +
        `location. Rendered as the routed plugin-level reference page.`,
    });
    const slug = file.replace(/\.md$/i, "");
    if (!/\.md$/i.test(file) || !ctx.routedPluginRefs.has(slug)) {
      throw fail(
        target,
        ctx,
        line,
        `no routed plugin-level reference page for ` +
          `${pluginRepoPath}/references/${file}.`,
      );
    }
    return `${base}/plugins/${plugin}/references/${slug}/${anchor}`;
  }

  // ── ../<other-skill>/SKILL.md — a sibling skill, also escaping the root ────
  // Not in the proposal's §6.5 table, but it occurs: okf-author/SKILL.md:155
  // hands off to okf-validate. Same D3 shape, different destination.
  m = /^\.\.\/([^/]+)\/SKILL\.md$/.exec(path);
  if (m) {
    const sibling = m[1];
    ctx.note({
      code: "D3",
      file: ctx.sourceRepoPath,
      line,
      message:
        `link "${target}" escapes the skill root to reach sibling skill ` +
        `"${sibling}". Same portability wrinkle as the ../../references/ ` +
        `links. Rendered as that skill's page.`,
    });
    if (!ctx.routedSkills.has(sibling)) {
      throw fail(target, ctx, line, `no routed page for sibling skill "${sibling}".`);
    }
    return `${base}/plugins/${plugin}/${sibling}/${anchor}`;
  }

  // ── references/<f> ─────────────────────────────────────────────────────────
  m = /^references\/([^/]+)$/.exec(path);
  if (m) {
    const file = m[1];
    const present = (ctx.resources?.references ?? []).some((r) => r.name === file);
    if (!present) {
      throw fail(
        target,
        ctx,
        line,
        `${skillRepoDir}/references/ has no entry named "${file}".`,
      );
    }
    if (/\.md$/i.test(file)) {
      const slug = file.replace(/\.md$/i, "");
      if (!ctx.routedSkillRefs.has(slug)) {
        throw fail(target, ctx, line, `no routed reference page for "${file}".`);
      }
      return `${base}/plugins/${plugin}/${skill}/references/${slug}/${anchor}`;
    }
    // .swift / .sql and friends are NOT routed: giving them a page needs a
    // title, and no title exists in the data. GitHub's blob view is canonical,
    // syntax-highlighted and carries history.
    return `${blobBase}/${skillRepoDir}/references/${file}${anchor}`;
  }

  // ── scripts/<f> — never routed ─────────────────────────────────────────────
  m = /^scripts\/([^/]+)$/.exec(path);
  if (m) {
    const present = (ctx.resources?.scripts ?? []).some((r) => r.name === m[1]);
    if (!present) {
      throw fail(target, ctx, line, `${skillRepoDir}/scripts/ has no entry named "${m[1]}".`);
    }
    return `${blobBase}/${skillRepoDir}/scripts/${m[1]}${anchor}`;
  }

  // ── assets/… ───────────────────────────────────────────────────────────────
  m = /^assets\/(.+)$/.exec(path);
  if (m) {
    const rest = m[1];
    const first = rest.replace(/\/.*$/, "");
    const entry = (ctx.resources?.assets ?? []).find((r) => r.name === first);
    if (!entry) {
      throw fail(target, ctx, line, `${skillRepoDir}/assets/ has no entry named "${first}".`);
    }
    if (isImage) {
      // §6.5 routes an IMAGE asset through public/skill-assets/, because an
      // <img src> must resolve to something the browser can fetch and a GitHub
      // blob URL is an HTML page, not an image. Phase 1 left this branch as a
      // hard error rather than a stub, on the grounds that a copy path nothing
      // exercises is a path nothing has proven. Phase 3 renders
      // beads-workflow, whose bd-dolt-troubleshooter/SKILL.md embeds
      // assets/process-flow.webp, so the branch is now exercised and the copy
      // step exists: site/scripts/prepare-assets.mjs, which runs before
      // `astro build` and populates public/skill-assets/<p>/<s>/.
      //
      // The two sides are kept in step by construction, not by discipline: the
      // script decides WHAT to copy by running this same `rewriteLinks` parser
      // over the same post-H1-strip body and collecting exactly the targets
      // that reach exactly this branch. tests/assets.test.mjs then checks the
      // rendered <img src> values against the files actually in dist/.
      if (entry.kind === "directory" && rest === first) {
        throw fail(
          target,
          ctx,
          line,
          `an image link cannot point at a DIRECTORY ` +
            `(${skillRepoDir}/assets/${first}).`,
        );
      }
      return `${base}/skill-assets/${plugin}/${skill}/${rest}${anchor}`;
    }
    const isDir = rest.endsWith("/") || (entry.kind === "directory" && rest === first);
    const cleanRest = rest.replace(/\/$/, "");
    const urlBase = isDir ? ctx.treeBase : blobBase;
    return `${urlBase}/${skillRepoDir}/assets/${cleanRest}${anchor}`;
  }

  throw fail(
    target,
    ctx,
    line,
    `no §6.5 rule matches this form from a SKILL.md body.`,
  );
}

function resolveFromReference(path, anchor, target, at, ctx) {
  const { line } = at;
  const { base, plugin, skill } = ctx;

  // A reference body is resolved in ITS OWN scope. `ctx.skill` is what says
  // which: set for a skill-level reference
  // (plugins/<p>/skills/<s>/references/<f>.md), absent for a plugin-level one
  // (plugins/<p>/references/<f>.md). The two directories are different
  // directories, so a bare sibling basename means a different file in each,
  // and there is no fallback from one to the other — resolving a skill-level
  // link against the plugin-level set would silently publish a link to a
  // different document that happens to share a filename.
  const scoped = skill === undefined
    ? { routed: ctx.routedPluginRefs, prefix: `${base}/plugins/${plugin}/references` }
    : { routed: ctx.routedSkillRefs, prefix: `${base}/plugins/${plugin}/${skill}/references` };

  // Sibling reference files link to each other by bare basename.
  const m = /^([^/]+)\.md$/i.exec(path);
  if (m) {
    const slug = m[1];
    if (scoped.routed.has(slug)) return `${scoped.prefix}/${slug}/${anchor}`;
    throw fail(target, ctx, line, `no sibling reference page named "${slug}".`);
  }

  throw fail(
    target,
    ctx,
    line,
    `no §6.5 rule matches this form from a reference body.`,
  );
}
