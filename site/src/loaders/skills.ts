/**
 * `skillsLoader` — an Astro Content Layer loader for an Agent Plugins v1.0.0
 * catalog, feeding Starlight's `docs` collection.
 *
 * Modelled on binder's `astro-okf` loader, with one structural idea carried
 * over unchanged and one added.
 *
 * CARRIED OVER — declared and derived never merge. Everything this build
 * COMPUTED lives under the namespaced `_skill` key; everything a plugin
 * manifest DECLARED lives under `_manifest`; everything a `SKILL.md` author
 * declared sits at the top level under its own spec name. They are never
 * merged, so a template physically cannot present a derived value as if the
 * author had written it.
 *
 * ADDED — enumeration is spec-conformant by construction. See
 * `./enumerate.mjs`: Agent Plugins §7.1 forbids recursive search for skills,
 * and the loader implements that literally rather than globbing and then
 * subtracting. The `assets/example-bundle/` tree is unreachable, not excluded.
 *
 * Not published to npm. It has exactly one consumer.
 *
 * Phase 1 renders one plugin (`okf-authoring`) via the `plugins` scope option.
 * Nothing else about the loader is phase-specific.
 */

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Loader, LoaderContext } from "astro/loaders";
import { z } from "astro/zod";

import { enumerate, nodeFs, toPosix } from "./enumerate.mjs";
import { analyzeDeclared, splitFrontmatter } from "./frontmatter.mjs";
import { firstH1, rewriteLinks, stripLeadingH1 } from "./markdown.mjs";
import { resolveTarget } from "./links.mjs";

export interface SkillsLoaderOptions {
  /** Repository root, relative to the Astro project root. */
  repoRoot: string;
  /**
   * The Astro `base` prefix. Taken as an option so the base is written in
   * exactly ONE place (proposal §10.4) — `astro.config.mjs` — and every
   * rewritten link derives from it.
   */
  baseUrl: string;
  /** `https://github.com/<owner>/<repo>`. */
  repoUrl: string;
  /** The git ref GitHub blob/tree URLs point at. */
  ref?: string;
  /**
   * Scope filter: build only these plugins, by `marketplace.json` name.
   * Narrows WHICH declared plugins are rendered; never changes HOW they are
   * discovered. Omit to render every declared plugin.
   */
  plugins?: string[];
}

/** A resource listed by real filename. No invented description, ever. */
const Resource = z.object({
  name: z.string(),
  kind: z.enum(["file", "directory"]),
  href: z.string(),
});

/**
 * DECLARED — mirrors the Agent Skills frontmatter vocabulary exactly.
 *
 * On strictness: the vocabulary is closed at six names, so an unknown
 * top-level key is a finding to report rather than a field to render. That
 * check runs in `analyzeDeclared()` inside the loader (see frontmatter.mjs),
 * NOT as `.strict()` here — Starlight's `docsSchema()` composes this object
 * with its own required `title`/`description`/`sidebar` keys, and a `.strict()`
 * object would reject Starlight's own fields. Enforcing it at the parse site is
 * also stronger: the unknown key never enters `entry.data` at all, so no
 * template can reach it even by accident.
 *
 * `metadata` stays OPEN, because the spec defines it as an arbitrary key-value
 * mapping for properties it does not define.
 */
const Declared = z.object({
  name: z.string().optional(),
  license: z.string().optional(),
  compatibility: z.string().optional(),
  "allowed-tools": z.string().optional(),
  // Two arguments, not one: astro/zod is Zod 4, where `record` takes an
  // explicit key type. The single-argument form silently type-checked as
  // nothing until `astro check` was wired in.
  metadata: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
});

/** DERIVED — computed by this build, never merged into the above. */
const Derived = z.object({
  kind: z.enum(["plugin", "skill", "reference"]),
  plugin: z.string(),
  /** Lifted from README.md's own heading for this plugin; `null` if absent. */
  pluginDisplayName: z.string().nullable(),
  skill: z.string().optional(),
  sourcePath: z.string(),
  sourceUrl: z.string(),
  installCommand: z.string().optional(),
  /**
   * `null` means "there is no such directory"; `[]` means "enumerated and
   * empty". An empty array must not be shipped for something never checked.
   */
  resources: z
    .object({
      references: z.array(Resource).nullable(),
      scripts: z.array(Resource).nullable(),
      assets: z.array(Resource).nullable(),
    })
    .optional(),
  children: z
    .object({
      skills: z.array(
        z.object({
          name: z.string(),
          title: z.string(),
          description: z.string(),
          href: z.string(),
        }),
      ),
      references: z.array(z.object({ title: z.string(), href: z.string() })),
    })
    .optional(),
  /** Per-entry advisories about the SOURCE repo (D1, D3, unknown keys, …). */
  specNotes: z.array(
    z.object({
      code: z.string(),
      file: z.string(),
      line: z.number().nullable(),
      message: z.string(),
    }),
  ),
});

/**
 * The plugin manifest, VERBATIM. Declared data from `plugin.json`, kept in its
 * own namespace so it is never confused with `SKILL.md` frontmatter (a
 * different vocabulary, on a different entity) nor with derived facts.
 */
const Manifest = z.record(z.string(), z.any());

export const skillsSchema = Declared.extend({
  _skill: Derived,
  _manifest: Manifest,
});

export function skillsLoader(options: SkillsLoaderOptions): Loader {
  const ref = options.ref ?? "main";
  const base = options.baseUrl.replace(/\/$/, "");
  const blobBase = `${options.repoUrl.replace(/\/$/, "")}/blob/${ref}`;
  const treeBase = `${options.repoUrl.replace(/\/$/, "")}/tree/${ref}`;

  return {
    name: "agent-skills",
    async load(context: LoaderContext): Promise<void> {
      const { store, parseData, generateDigest, renderMarkdown, logger, config } = context;
      const projectRoot = config?.root ? fileURLToPath(config.root) : process.cwd();
      const repoRoot = resolve(projectRoot, options.repoRoot);

      const { plugins, advisories } = await enumerate({
        repoRoot,
        fs: nodeFs,
        onlyPlugins: options.plugins,
      });

      const displayNames = await readDisplayNames(repoRoot);
      store.clear();

      const blobUrl = (repoPath: string) => `${blobBase}/${repoPath}`;
      const treeUrl = (repoPath: string) => `${treeBase}/${repoPath}`;

      let pages = 0;

      for (const plugin of plugins) {
        const pluginDisplayName = displayNames.get(plugin.name) ?? null;
        const routedPluginRefs = new Set(plugin.references.map((r: any) => r.slug));
        const routedSkills = new Set(plugin.skills.map((s: any) => s.name));
        const pluginNotes: any[] = advisories.filter(
          (a: any) => a.file.startsWith(plugin.repoPath) || a.code === "I1",
        );

        // ── The skill pages ────────────────────────────────────────────────
        const childSkills: any[] = [];
        for (const skill of plugin.skills) {
          const raw = await readFile(skill.skillMdPath, "utf8");
          const { data, body, fmText, fmFirstLine, bodyFirstLine } =
            splitFrontmatter(raw, skill.repoPath);
          const { declared, advisories: fmNotes } = analyzeDeclared(data, {
            file: skill.repoPath,
            fmText,
            fmFirstLine,
            expectedName: skill.name,
          });

          const notes: any[] = [...fmNotes];
          const routedSkillRefs = new Set(
            (skill.resources.references ?? [])
              .filter((r: any) => r.kind === "file" && /\.md$/i.test(r.name))
              .map((r: any) => r.name.replace(/\.md$/i, "")),
          );

          const { body: withoutH1, stripped, removed } = stripLeadingH1(body);
          // Line numbers reported from here on are SOURCE-FILE lines: past the
          // frontmatter, and past whatever the H1 strip took off.
          const lineOffset = bodyFirstLine - 1 + removed;
          const { body: rewritten } = rewriteLinks(withoutH1, (target, at) =>
            resolveTarget(target, at, {
              kind: "skill",
              base,
              blobBase,
              treeBase,
              plugin: plugin.name,
              skill: skill.name,
              pluginRepoPath: plugin.repoPath,
              routedPluginRefs,
              routedSkillRefs,
              routedSkills,
              resources: skill.resources,
              sourceRepoPath: skill.repoPath,
              note: (n: any) => notes.push(n),
            }),
            { lineOffset },
          );

          const id = `plugins/${plugin.name}/${skill.name}`;
          const derived = {
            kind: "skill" as const,
            plugin: plugin.name,
            pluginDisplayName,
            skill: skill.name,
            sourcePath: skill.repoPath,
            sourceUrl: blobUrl(skill.repoPath),
            // Form lifted verbatim from the repository README's own
            // "Installing via Open Agent Skills CLI" block.
            installCommand: `npx skills add ghchinoy/agent-skills --skill ${declared.name}`,
            resources: {
              references: decorate(skill.resources.references, `${skill.repoDir}/references`),
              scripts: decorate(skill.resources.scripts, `${skill.repoDir}/scripts`),
              assets: decorate(skill.resources.assets, `${skill.repoDir}/assets`),
            },
            specNotes: notes,
          };

          // The page title is the H1 the source itself wrote, and the declared
          // `name` is rendered as its own labelled field. Titling the page
          // `okf-author` instead would have quietly thrown away "Author an OKF
          // v0.2 bundle" — a real string the author wrote, which would then
          // appear nowhere on the site. Both are declared; rendering both, each
          // in its own place, is the only option that loses nothing. When a
          // SKILL.md has no H1 at all (I2 — grill-with-beads is the instance in
          // this repo) there is nothing to prefer, so the declared name stands
          // in; that is a fallback to other declared data, not an invention.
          const title = stripped ?? declared.name;

          // Starlight's docsSchema requires `title` and `description` at the
          // top level. `title` is computed above and is the only key here that
          // is not straight from the source; `description` arrives with the
          // spread, because it is a DECLARED field and must be the declared
          // bytes. It used to be written out explicitly as well, one line
          // above the spread that overwrote it — same value, so no defect, but
          // a reader could not tell which one won. `astro check` found it.
          await emit(id, skill.repoPath, {
            title,
            ...declared,
            _skill: derived,
            _manifest: plugin.manifest,
          }, rewritten, raw);

          childSkills.push({
            name: declared.name,
            title,
            description: declared.description,
            href: `${base}/${id}/`,
          });
          pluginNotes.push(...notes);

          function decorate(list: any[] | null, repoDir: string) {
            if (list === null) return null;
            return list.map((r: any) => ({
              name: r.name,
              kind: r.kind,
              href: r.kind === "directory"
                ? treeUrl(`${repoDir}/${r.name}`)
                : blobUrl(`${repoDir}/${r.name}`),
            }));
          }
        }

        // ── The plugin-level reference pages ───────────────────────────────
        const childRefs: any[] = [];
        for (const reference of plugin.references) {
          const raw = await readFile(reference.path, "utf8");
          if (/^﻿?---\r?\n/.test(raw)) {
            logger.warn(
              `${reference.repoPath} appears to carry frontmatter; plugin-level ` +
                `references in this repo have none and their title is taken ` +
                `from the H1.`,
            );
          }
          const title = firstH1(raw);
          if (title === null) {
            // Prettifying the filename into a title would invent one. The
            // build stops instead.
            throw new Error(
              `skills-loader: ${reference.repoPath} has no level-1 heading, so ` +
                `there is no declared title to render. A reference page title ` +
                `is EXTRACTED from the H1, never derived from the filename.`,
            );
          }
          const notes: any[] = [];
          // Plugin-level references carry no frontmatter (all 20 reference
          // files in the repo begin with their H1), so the only offset is the
          // stripped title.
          const { body: withoutH1, removed } = stripLeadingH1(raw);
          const { body: rewritten } = rewriteLinks(withoutH1, (target, at) =>
            resolveTarget(target, at, {
              kind: "reference",
              base,
              blobBase,
              treeBase,
              plugin: plugin.name,
              pluginRepoPath: plugin.repoPath,
              routedPluginRefs,
              routedSkillRefs: new Set<string>(),
              routedSkills,
              resources: null,
              sourceRepoPath: reference.repoPath,
              note: (n: any) => notes.push(n),
            }),
            { lineOffset: removed },
          );

          const id = `plugins/${plugin.name}/references/${reference.slug}`;
          await emit(id, reference.repoPath, {
            // Byte-identical to the source H1, em-dash and all.
            title,
            _skill: {
              kind: "reference" as const,
              plugin: plugin.name,
              pluginDisplayName,
              sourcePath: reference.repoPath,
              sourceUrl: blobUrl(reference.repoPath),
              specNotes: notes,
            },
            _manifest: plugin.manifest,
          }, rewritten, raw);

          childRefs.push({ title, href: `${base}/${id}/` });
          pluginNotes.push(...notes);
        }

        // ── The plugin page ────────────────────────────────────────────────
        // plugin.json is canonical for the description (I1). marketplace.json's
        // separately-worded description is NOT rendered and NOT merged.
        const pluginId = `plugins/${plugin.name}`;
        if (typeof plugin.manifest.description !== "string" || !plugin.manifest.description) {
          throw new Error(
            `skills-loader: ${plugin.manifestRepoPath} declares no description.`,
          );
        }
        await emit(pluginId, plugin.manifestRepoPath, {
          title: pluginDisplayName ?? plugin.name,
          description: plugin.manifest.description,
          _skill: {
            kind: "plugin" as const,
            plugin: plugin.name,
            pluginDisplayName,
            sourcePath: plugin.manifestRepoPath,
            sourceUrl: blobUrl(plugin.manifestRepoPath),
            children: { skills: childSkills, references: childRefs },
            specNotes: pluginNotes.filter(
              (n, i, a) => a.findIndex((x) => x.code === n.code && x.file === n.file && x.line === n.line) === i,
            ),
          },
          _manifest: plugin.manifest,
        }, "", "");
      }

      // ── Advisories to the build log (§6.5) ───────────────────────────────
      // Non-fatal notes about the SOURCE repo. The site is a read-only
      // consumer: it reports and never repairs.
      const all = [
        ...advisories,
        ...[...store.values()].flatMap((e: any) => e.data?._skill?.specNotes ?? []),
      ];
      const seen = new Set<string>();
      const unique = all.filter((a: any) => {
        const k = `${a.code}|${a.file}|${a.line}|${a.message}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      // Code-unit order, not localeCompare: this only orders log lines, but
      // the build log is compared between runs and there is no reason for one
      // ordering rule in this codebase and a locale-dependent one here.
      const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
      unique.sort((a: any, b: any) =>
        cmp(a.code, b.code) || cmp(a.file, b.file) || (a.line ?? 0) - (b.line ?? 0),
      );
      if (unique.length > 0) {
        logger.warn(`${unique.length} source-repo advisor${unique.length === 1 ? "y" : "ies"} (reported, not repaired):`);
        for (const a of unique) {
          logger.warn(`  [${a.code}] ${a.file}${a.line ? `:${a.line}` : ""} — ${a.message}`);
        }
      }
      logger.info(`Loaded ${pages} page(s) from ${plugins.length} plugin(s) at ${repoRoot}`);

      async function emit(
        id: string,
        repoPath: string,
        data: Record<string, unknown>,
        body: string,
        raw: string,
      ) {
        const abs = join(repoRoot, repoPath);
        const filePath = toPosix(
          resolve(abs).startsWith(projectRoot)
            ? resolve(abs).slice(projectRoot.length + 1)
            : `../${repoPath}`,
        );
        const parsed = await parseData({ id, data, filePath });
        const rendered = await renderMarkdown(body, { fileURL: pathToFileURL(abs) });
        store.set({
          id,
          data: parsed,
          body,
          filePath,
          digest: generateDigest(raw + JSON.stringify(data)),
          rendered,
        });
        pages += 1;
      }
    },
  };
}

/**
 * Plugin display names, LIFTED from the repository README's own section
 * headings ("### 8. 📖 OKF Authoring (`plugins/okf-authoring`)") rather than
 * invented here. Neither standard has a display-name field — `plugin.json.name`
 * is the slug — so the only honest source is a name the repo already uses. A
 * plugin the README does not name gets no display name and renders as its slug.
 * Emoji are dropped.
 */
async function readDisplayNames(repoRoot: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let readme: string;
  try {
    readme = await readFile(join(repoRoot, "README.md"), "utf8");
  } catch {
    return out;
  }
  const re = /^#{2,4}\s*\d+\.\s*(.+?)\s*\(`plugins\/([a-z0-9._-]+)`\)\s*$/gm;
  for (const m of readme.matchAll(re)) {
    const name = m[1].replace(/^[^\p{L}\p{N}]+/u, "").trim();
    if (name) out.set(m[2], name);
  }
  return out;
}
