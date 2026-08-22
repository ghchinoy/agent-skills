// enumerate.mjs — SPEC-CONFORMANT DISCOVERY. This module is the load-bearing
// half of the loader, and it is deliberately a separate, dependency-injected,
// plain-JS module so that a test can watch every filesystem call it makes.
//
// Agent Plugins v1.0.0 §6.1/§7.1:
//
//   "Each immediate child directory containing a path named exactly `SKILL.md`
//    that resolves to a regular file is treated as one skill. Clients MUST NOT
//    recursively search deeper descendants for additional skills."
//
// That sentence is implemented literally below: ONE readdir of
// `<plugin>/skills/`, and for each entry that `isDirectory()`, ONE stat of
// `<plugin>/skills/<name>/SKILL.md`. There is no recursion anywhere in this
// file, so the markdown files under
// `okf-author/assets/example-bundle/` — including its own `references/skills/`
// tree — are unreachable BY CONSTRUCTION rather than by an exclude list.
//
// The resource inventory (§6.4's References / Scripts / Assets blocks) is also
// strictly depth-1: it lists the immediate children of `references/`,
// `scripts/` and `assets/` by real filename and never opens or descends into
// them. `assets/example-bundle` is therefore inventoried as one DIRECTORY
// entry, never as one page per file inside it.
//
// `fs` is injected (`{ readFile, readdir, stat }`). Production passes
// `nodeFs`; `tests/enumeration.test.mjs` passes a recorder and asserts on the
// exact call log — see AC 4.

import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";

/** The real filesystem facade. The only one production ever uses. */
export const nodeFs = { readFile, readdir, stat };

/** The exact filename the standard fixes. Not a glob, not case-insensitive. */
export const SKILL_FILE = "SKILL.md";

/**
 * The CLOSED top-level `plugin.json` vocabulary (Agent Plugins §5.1), in the
 * standard's own order.
 *
 * Same posture as `ALLOWED_FIELDS` in frontmatter.mjs, for the same normative
 * reason: §5.2 tells clients to REPORT AND IGNORE unknown manifest fields.
 * This site did the "ignore" half by never iterating the manifest in a
 * template; the "report" half is this list. An unknown key becomes an advisory
 * and is dropped from the object the templates see, so it cannot render even
 * if a future template does iterate.
 */
export const MANIFEST_FIELDS = [
  "$schema",
  "name",
  "version",
  "description",
  "author",
  "homepage",
  "repository",
  "license",
  "keywords",
  "extensions",
];

/**
 * 1-based line of a top-level JSON key in the raw manifest text, or `null`.
 * Regex over the source bytes rather than a position-tracking parser: an
 * advisory that names a line the reader can open is worth this much and no
 * more, and returning `null` when it cannot be found is honest.
 */
function jsonKeyLine(raw, key) {
  const re = new RegExp(`^\\s*"${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:`);
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (re.test(lines[i])) return i + 1;
  }
  return null;
}

/**
 * Validates a parsed `plugin.json` against the closed vocabulary and returns
 * ONLY the declared fields, plus advisories. Never throws on an unknown key —
 * §5.2 says report and ignore, not reject.
 *
 * @param {object} manifest  parsed plugin.json
 * @param {string} raw       its source text, for line numbers
 * @param {string} file      repo-relative path, for messages
 * @returns {{manifest: object, advisories: object[]}}
 */
export function analyzeManifest(manifest, raw, file) {
  const advisories = [];
  const kept = {};
  for (const key of Object.keys(manifest)) {
    if (!MANIFEST_FIELDS.includes(key)) {
      advisories.push(
        advisory(
          "UNKNOWN-FIELD",
          file,
          jsonKeyLine(raw, key),
          `unknown top-level plugin.json key "${key}". The Agent Plugins ` +
            `manifest vocabulary is closed at ${MANIFEST_FIELDS.join(", ")}; ` +
            `§5.2 says to report and ignore unknown fields rather than assign ` +
            `them semantics, so this key is NOT rendered.`,
        ),
      );
      continue;
    }
    kept[key] = manifest[key];
  }
  return { manifest: kept, advisories };
}

/** Normalizes a platform path to forward slashes so ids are stable. */
export function toPosix(p) {
  return p.split(sep).join("/");
}

/**
 * A non-fatal finding about the SOURCE repository. The loader prints these to
 * the build log and never repairs the repo (§6.5). Each carries a file and,
 * where the finding has one, a line.
 *
 * @typedef {{code: string, file: string, line: number|null, message: string}} Advisory
 *
 * @returns {Advisory}
 */
function advisory(code, file, line, message) {
  return { code, file, line, message };
}

// ── The shapes this module returns ───────────────────────────────────────────
// Spelled out so the .ts loader that consumes them is actually type-checked
// against them (`npm run typecheck`). Before these typedefs existed the return
// was annotated `{plugins: object[]}`, which meant every property access
// downstream was an error the build never surfaced because nothing ran `astro
// check`. Keep them in step with the objects constructed below.

/**
 * One entry of a depth-1 directory listing. `kind` is the real filesystem
 * kind; no description is invented for it.
 * @typedef {{name: string, kind: "file"|"directory"}} ResourceEntry
 */

/**
 * @typedef {object} SkillEntry
 * @property {string} name          the skill DIRECTORY name (§7.1)
 * @property {string} dir           absolute path to the skill directory
 * @property {string} skillMdPath   absolute path to its SKILL.md
 * @property {string} repoPath      repo-relative path to its SKILL.md
 * @property {string} repoDir       repo-relative path to the skill directory
 * @property {{references: ResourceEntry[]|null, scripts: ResourceEntry[]|null, assets: ResourceEntry[]|null}} resources
 *   `null` means "there is no such directory"; `[]` means "enumerated, empty".
 */

/**
 * A plugin-level reference file. Not a spec-defined location — see below.
 * @typedef {{name: string, slug: string, path: string, repoPath: string}} ReferenceEntry
 */

/**
 * @typedef {object} PluginEntry
 * @property {string} name               marketplace.json's name for it
 * @property {string} source             marketplace.json's declared source path
 * @property {string} repoPath           repo-relative plugin directory
 * @property {string} dir                absolute plugin directory
 * @property {Record<string, any>} manifest  plugin.json, FILTERED to the closed
 *   vocabulary (§5.2). Values are untyped on purpose: this is declared data in
 *   another document's schema, and the site renders what is there.
 * @property {string} manifestRepoPath
 * @property {string|null} indexDescription  marketplace.json's competing
 *   description, kept only so I1 can report it. NOT rendered.
 * @property {SkillEntry[]} skills
 * @property {ReferenceEntry[]} references
 * @property {{repoPath: string, present: boolean}} mcp  the §6.1 fixed location
 *   `<plugin>/mcp.json`, PROBED rather than assumed. `present: false` is a
 *   measurement — the file was looked for and is not there — which is what lets
 *   /about/standards/ say this catalog ships no MCP servers without anybody
 *   typing a zero.
 */

/**
 * Discovers plugins, skills, plugin-level references and the depth-1 resource
 * inventory.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot   absolute path to the repository root
 * @param {object} opts.fs         `{ readFile, readdir, stat }`
 * @param {string[]} [opts.onlyPlugins]  scope filter (Phase 1 renders one
 *   plugin). A filter narrows WHICH declared plugins are built; it never
 *   changes HOW they are discovered.
 * @returns {Promise<{plugins: PluginEntry[], advisories: Advisory[]}>}
 */
export async function enumerate({ repoRoot, fs, onlyPlugins }) {
  /** @type {Advisory[]} */
  const advisories = [];

  // ── Membership and ordering come from the distribution index ──────────────
  // marketplace.json is NOT part of the portable Agent Plugins standard; it is
  // this repository's distribution index, and the standard leaves ordering to
  // exactly that. So it is authoritative for WHICH plugins exist and in WHAT
  // order — and for nothing else.
  const marketplaceRel = ".claude-plugin/marketplace.json";
  const marketplacePath = join(repoRoot, ".claude-plugin", "marketplace.json");
  const marketplace = JSON.parse(await fs.readFile(marketplacePath, "utf8"));

  if (!Array.isArray(marketplace.plugins)) {
    throw new Error(
      `skills-loader: ${marketplaceRel} has no \`plugins\` array; there is ` +
        `nothing to enumerate. This loader reads membership from the index ` +
        `and never guesses it from the filesystem.`,
    );
  }

  const wanted = onlyPlugins ? new Set(onlyPlugins) : null;
  if (wanted) {
    const declared = new Set(marketplace.plugins.map((p) => p.name));
    for (const name of wanted) {
      if (!declared.has(name)) {
        throw new Error(
          `skills-loader: plugin "${name}" was requested in the loader's ` +
            `\`plugins\` scope option but is not declared in ${marketplaceRel}.`,
        );
      }
    }
  }

  const plugins = [];

  for (const entry of marketplace.plugins) {
    if (wanted && !wanted.has(entry.name)) continue;

    const source = typeof entry.source === "string" ? entry.source : null;
    if (!source) {
      throw new Error(
        `skills-loader: plugin "${entry.name}" in ${marketplaceRel} declares ` +
          `no \`source\` path.`,
      );
    }
    const pluginDir = resolve(repoRoot, source);
    const pluginRel = toPosix(source.replace(/^\.\//, ""));

    // ── plugin.json is the canonical manifest (I1) ──────────────────────────
    // It wins over marketplace.json for the description. No merging, no
    // paraphrase, no "pick the longer one".
    const manifestRel = `${pluginRel}/plugin.json`;
    let manifestRaw;
    try {
      manifestRaw = await fs.readFile(join(pluginDir, "plugin.json"), "utf8");
    } catch (err) {
      throw new Error(
        `skills-loader: ${manifestRel} is missing or unreadable, but ` +
          `${marketplaceRel} declares plugin "${entry.name}" at ${source}. ` +
          `${err.message}`,
      );
    }
    // §5.2: report and ignore. `manifest` from here on is the FILTERED object —
    // unknown keys are advised above and are not in the data any template can
    // reach.
    const { manifest, advisories: manifestNotes } = analyzeManifest(
      JSON.parse(manifestRaw),
      manifestRaw,
      manifestRel,
    );
    advisories.push(...manifestNotes);

    if (manifest.name !== entry.name) {
      advisories.push(
        advisory(
          "MANIFEST-NAME-SKEW",
          manifestRel,
          null,
          `plugin.json declares name "${manifest.name}" but ` +
            `${marketplaceRel} indexes it as "${entry.name}".`,
        ),
      );
    }
    if (
      typeof entry.description === "string" &&
      entry.description !== manifest.description
    ) {
      advisories.push(
        advisory(
          "I1",
          manifestRel,
          null,
          `two competing descriptions for "${entry.name}": plugin.json is ` +
            `canonical and is what the site renders; ${marketplaceRel}'s ` +
            `separately-worded description is not rendered.`,
        ),
      );
    }

    // ── The other §6.1 fixed location: mcp.json ─────────────────────────────
    // Agent Plugins §6.1 fixes exactly two things inside a plugin root:
    // `skills/` and `mcp.json`. The loader has always implemented the first
    // one. This probes the second — one stat, no read — so that "this catalog
    // is skills-only" is a thing the build MEASURED across every declared
    // plugin, rather than a sentence somebody wrote once and nothing rechecks.
    // The file is not parsed: counting servers inside it would be a different
    // claim, and it is not one this repo's data ever needs.
    const mcpRel = `${pluginRel}/mcp.json`;
    let mcpPresent = false;
    try {
      mcpPresent = (await fs.stat(join(pluginDir, "mcp.json"))).isFile();
    } catch {
      mcpPresent = false;
    }

    // ── §7.1 discovery. Read this block against the quotation above. ────────
    const skillsDir = join(pluginDir, "skills");
    let skillDirents = [];
    try {
      skillDirents = await fs.readdir(skillsDir, { withFileTypes: true });
    } catch {
      // `skills/` is an OPTIONAL fixed location (§6.1). Absent means zero
      // skills — not an error, and not a reason to go looking elsewhere.
      skillDirents = [];
    }

    const discovered = [];
    for (const dirent of skillDirents) {
      // "Each immediate child DIRECTORY …" — a stray file in skills/ is not a
      // skill, and we do not follow it.
      if (!dirent.isDirectory()) continue;
      const skillDir = join(skillsDir, dirent.name);
      const skillMd = join(skillDir, SKILL_FILE);
      // "… containing a path named exactly SKILL.md that RESOLVES TO A REGULAR
      // FILE". stat (not lstat) resolves symlinks, which is what "resolves"
      // asks for. A directory named SKILL.md is not a skill.
      let st;
      try {
        st = await fs.stat(skillMd);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      // NOTE THE ABSENCE: there is no `else { recurse(skillDir) }` here, and
      // adding one would violate the MUST NOT. AC 4 pins this.
      discovered.push({ name: dirent.name, dir: skillDir, skillMdPath: skillMd });
    }

    // ── Ordering: the index's declared order, then anything it omitted ───────
    const declaredOrder = Array.isArray(entry.skills)
      ? entry.skills.map((p) => basename(String(p).replace(/\/+$/, "")))
      : [];
    const byName = new Map(discovered.map((s) => [s.name, s]));
    const ordered = [];
    for (const name of declaredOrder) {
      const found = byName.get(name);
      if (found) {
        ordered.push(found);
        byName.delete(name);
      } else {
        advisories.push(
          advisory(
            "INDEX-SKILL-MISSING",
            marketplaceRel,
            null,
            `${marketplaceRel} lists skill "${name}" for plugin ` +
              `"${entry.name}", but ${pluginRel}/skills/${name}/SKILL.md does ` +
              `not resolve to a regular file.`,
          ),
        );
      }
    }
    for (const leftover of byName.values()) {
      advisories.push(
        advisory(
          "INDEX-SKILL-UNLISTED",
          `${pluginRel}/skills/${leftover.name}/SKILL.md`,
          null,
          `skill "${leftover.name}" was discovered per Agent Plugins §7.1 but ` +
            `is not listed in ${marketplaceRel}; appended after the declared ` +
            `order.`,
        ),
      );
      ordered.push(leftover);
    }

    // ── Plugin-level references/ — depth 1, and NOT a spec-defined location ──
    // §6.1's fixed locations are only `skills/` and `mcp.json`, so a
    // plugin-level `references/` is unspecified package data: allowed, not
    // addressed. okf-authoring is the only plugin in the repo that has one.
    const pluginRefs = [];
    const refsDir = join(pluginDir, "references");
    let refDirents = [];
    try {
      refDirents = await fs.readdir(refsDir, { withFileTypes: true });
    } catch {
      refDirents = [];
    }
    // Code-unit order, NOT localeCompare — the same reason spelled out on
    // `listDir()` below, and this list IS rendered (the plugin page's
    // References block), so a locale difference between a developer's machine
    // and CI would silently reorder published output.
    for (const dirent of refDirents.slice().sort(byCodeUnit)) {
      if (!dirent.isFile()) continue;
      if (!dirent.name.toLowerCase().endsWith(".md")) {
        advisories.push(
          advisory(
            "REFERENCE-NOT-MARKDOWN",
            `${pluginRel}/references/${dirent.name}`,
            null,
            `plugin-level reference is not markdown; it is listed by real ` +
              `filename and linked to GitHub, not routed as a page.`,
          ),
        );
        continue;
      }
      pluginRefs.push({
        name: dirent.name,
        slug: dirent.name.replace(/\.md$/i, ""),
        path: join(refsDir, dirent.name),
        repoPath: `${pluginRel}/references/${dirent.name}`,
      });
    }

    // ── Depth-1 resource inventory per skill ────────────────────────────────
    const skills = [];
    for (const s of ordered) {
      skills.push({
        name: s.name,
        dir: s.dir,
        skillMdPath: s.skillMdPath,
        repoPath: `${pluginRel}/skills/${s.name}/${SKILL_FILE}`,
        repoDir: `${pluginRel}/skills/${s.name}`,
        resources: {
          references: await listDir(fs, join(s.dir, "references")),
          scripts: await listDir(fs, join(s.dir, "scripts")),
          assets: await listDir(fs, join(s.dir, "assets")),
        },
      });
    }

    plugins.push({
      name: entry.name,
      source,
      repoPath: pluginRel,
      dir: pluginDir,
      manifest,
      manifestRepoPath: manifestRel,
      indexDescription:
        typeof entry.description === "string" ? entry.description : null,
      skills,
      references: pluginRefs,
      mcp: { repoPath: mcpRel, present: mcpPresent },
    });
  }

  return { plugins, advisories };
}

/**
 * Lists the IMMEDIATE children of `dir` as `{ name, kind }`, or `null` when the
 * directory does not exist.
 *
 * `null` vs `[]` is deliberate and is the astro-okf posture: `[]` means "we
 * enumerated this directory and it was empty"; `null` means "there is no such
 * directory". Shipping `[]` for something never checked would be a claim the
 * build did not earn.
 */
async function listDir(fs, dir) {
  let dirents;
  try {
    dirents = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  // Code-unit order, NOT localeCompare: collation is ICU- and locale-dependent
  // (it sorts "example-bundle" before "README.md" by comparing base letters),
  // so a locale difference between a developer's machine and CI would silently
  // reorder rendered output. Byte order is boring and reproducible everywhere.
  return dirents
    .map((d) => ({ name: d.name, kind: d.isDirectory() ? "directory" : "file" }))
    .sort(byCodeUnit);
}

/**
 * The ONE ordering comparator in this file. Every rendered list sorts through
 * it, so there is a single place to read and a single place to get wrong.
 */
export function byCodeUnit(a, b) {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}
