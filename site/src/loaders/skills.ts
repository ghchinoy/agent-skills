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

import { adviseDeadPointers, adviseLength, adviseOrphans } from "./advise.mjs";
import { enumerate, nodeFs, toPosix } from "./enumerate.mjs";
import { analyzeDeclared, frontmatterKeyLine, splitFrontmatter } from "./frontmatter.mjs";
import { firstH1, rewriteLinks, stripLeadingH1 } from "./markdown.mjs";
import { resolveTarget } from "./links.mjs";
import { buildSitePages } from "./site-pages.mjs";

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

/**
 * DERIVED, for a page ABOUT the catalog rather than in it: the landing page,
 * `/skills/`, and the three `/about/` pages.
 *
 * Its own namespace rather than a sixth `_skill.kind`, because these pages have
 * no declared source entity at all. A site page is not a skill with missing
 * fields, and giving it the skill shape would invite a template to ask it skill
 * questions and get `undefined` for an answer.
 */
const SitePage = z.object({
  kind: z.literal("site"),
  /** The repo document whose bytes were lifted, or `null` if site-authored. */
  sourcePath: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  /**
   * Index data that travels as DATA rather than as generated markdown. See
   * site-pages.mjs: a declared description spliced into a markdown string would
   * have its backticks and asterisks reinterpreted, and the page would show
   * something its author did not write.
   */
  lists: z
    .object({
      plugins: z
        .array(
          z.object({
            name: z.string(),
            displayName: z.string().nullable(),
            href: z.string(),
            description: z.string(),
            skillCount: z.number(),
            referenceCount: z.number(),
          }),
        )
        .optional(),
      skills: z
        .array(
          z.object({
            plugin: z.string(),
            pluginDisplayName: z.string().nullable(),
            pluginHref: z.string(),
            name: z.string(),
            title: z.string(),
            description: z.string(),
            href: z.string(),
            /**
             * The keywords the SHIPPING PLUGIN declares (§6.6). `null` when its
             * plugin.json declares none — distinct from `[]`, which would be
             * this site saying a manifest declared an empty list.
             *
             * Zod strips unknown keys, so a field added to the object in
             * skills.ts and not added here reaches no template and renders
             * nowhere, with no error. That is how this one first arrived: the
             * data was built, the component read it, and every row came out
             * with an empty attribute and a green build.
             */
            pluginKeywords: z.array(z.string()).nullable(),
          }),
        )
        .optional(),
    })
    .optional(),
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

/**
 * ON THE THREE OPTIONALS BELOW, AND WHAT REPLACES THE STRICTNESS THEY GIVE UP.
 *
 * Phase 1 required `_skill` and `_manifest` on every entry, which was exactly
 * right when every entry described a plugin, a skill or a reference. Phase 3
 * adds five pages that describe none of those, so a schema demanding a manifest
 * of the landing page would be demanding a fiction. Zod cannot express "exactly
 * one of `_skill` and `_page`, and `_manifest` iff `_skill`" in a shape
 * `docsSchema({ extend })` will compose with — it wraps this object and adds
 * its own keys.
 *
 * So the constraint moved rather than disappeared: `emit()` asserts it, on
 * every entry, at the one place entries are created. An optional here is not a
 * loosened rule; it is the same rule enforced where it can be stated exactly.
 */
export const skillsSchema = Declared.extend({
  _skill: Derived.optional(),
  _manifest: Manifest.optional(),
  _page: SitePage.optional(),
});

export function skillsLoader(options: SkillsLoaderOptions): Loader {
  const ref = options.ref ?? "main";
  const base = options.baseUrl.replace(/\/$/, "");
  // The `owner/repo` slug the install command needs, DERIVED from repoUrl rather
  // than written out again. It was a literal `ghchinoy/agent-skills` below, which
  // is a copy of REPO_URL's owner/repo component: rename the repository and every
  // skill page would have shipped a failing install command with the suite green.
  // Found by the round-4 constant gate once that gate learned to read .ts files
  // and to grade components separately (F9's lesson). Output-identical today.
  const repoSlug = new URL(options.repoUrl).pathname.replace(/^\/|\/$/g, "");
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

      // Accumulated across the plugin loop and handed to the site pages, so
      // that every count and every list on `/`, `/skills/` and
      // `/about/standards/` is a tally of what this build actually emitted
      // rather than a second traversal that could disagree with the first.
      const skillIndex: any[] = [];
      const emittedIds: string[] = [];
      let referencePages = 0;
      let unroutedResources = 0;

      /**
       * Emits ONE reference page, at either scope.
       *
       * Plugin-level (`plugins/<p>/references/<f>.md`) and skill-level
       * (`plugins/<p>/skills/<s>/references/<f>.md`) references are the same
       * kind of document — an untitled-in-frontmatter markdown file whose title
       * is its own H1 — differing only in where they sit and therefore in what a
       * bare sibling link inside them means. Phase 1 routed the two
       * plugin-level ones; Phase 3 routes the 18 skill-level ones too. Writing
       * it once means the H1 rule, the frontmatter warning and the link scoping
       * cannot drift apart between the two.
       */
      async function emitReference(
        reference: { name: string; slug: string; path: string; repoPath: string },
        scope: {
          plugin: any;
          pluginDisplayName: string | null;
          skill?: string;
          idPrefix: string;
          routedPluginRefs: Set<string>;
          routedSkillRefs: Set<string>;
          routedSkills: Set<string>;
        },
      ): Promise<{ title: string; href: string; notes: any[] }> {
        const raw = await readFile(reference.path, "utf8");
        if (/^﻿?---\r?\n/.test(raw)) {
          logger.warn(
            `${reference.repoPath} appears to carry frontmatter; reference ` +
              `files in this repo have none and their title is taken from the H1.`,
          );
        }
        const title = firstH1(raw);
        if (title === null) {
          // Prettifying the filename into a title would invent one. The build
          // stops instead.
          throw new Error(
            `skills-loader: ${reference.repoPath} has no level-1 heading, so ` +
              `there is no declared title to render. A reference page title ` +
              `is EXTRACTED from the H1, never derived from the filename.`,
          );
        }
        const notes: any[] = [];
        // Reference files carry no frontmatter (all 20 in the repo begin with
        // their H1), so the only offset is the stripped title.
        const { body: withoutH1, removed } = stripLeadingH1(raw);
        const { body: rewritten } = rewriteLinks(withoutH1, (target, at) =>
          resolveTarget(target, at, {
            kind: "reference",
            base,
            blobBase,
            treeBase,
            plugin: scope.plugin.name,
            skill: scope.skill,
            pluginRepoPath: scope.plugin.repoPath,
            routedPluginRefs: scope.routedPluginRefs,
            routedSkillRefs: scope.routedSkillRefs,
            routedSkills: scope.routedSkills,
            resources: null,
            sourceRepoPath: reference.repoPath,
            note: (n: any) => notes.push(n),
          }),
          { lineOffset: removed },
        );

        const id = `${scope.idPrefix}/references/${reference.slug}`;
        await emit(id, reference.repoPath, {
          // Byte-identical to the source H1, em-dash and all.
          title,
          _skill: {
            kind: "reference" as const,
            plugin: scope.plugin.name,
            pluginDisplayName: scope.pluginDisplayName,
            skill: scope.skill,
            sourcePath: reference.repoPath,
            sourceUrl: blobUrl(reference.repoPath),
            specNotes: notes,
          },
          _manifest: scope.plugin.manifest,
        }, rewritten, raw);

        referencePages += 1;
        return { title, href: `${base}/${id}/`, notes };
      }

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

          // ── D2, D4, I4 ──────────────────────────────────────────────────
          // Findings that compare this file against its own directory. All
          // three read `raw` — the bytes before the frontmatter split and the
          // H1 strip — so the lines they report are source lines and need no
          // offset correction. See advise.mjs for each condition and for why
          // none of them hardcodes a skill name or an expected count.
          const notes: any[] = [
            ...fmNotes,
            ...adviseLength(raw, skill.repoPath),
            ...adviseDeadPointers(raw, skill),
            ...adviseOrphans(raw, skill),
          ];

          // ── I3, VERSION SKEW ────────────────────────────────────────────
          //
          // A skill declaring `metadata.version` that differs from its
          // plugin's `plugin.json` version. Both numbers are declared, by
          // different authors about different entities, and the site renders
          // each on the page of the entity that declared it — it does not
          // merge them, prefer one, or normalise "1.9" into "1.9.0". This
          // advisory is how the reader of a build log finds out the two
          // disagree.
          //
          // READ THIS BEFORE ADDING A SKILL NAME BELOW. Proposal §3.7 names
          // `bd-dolt-troubleshooter` as THE version-skew case. Measuring all 23
          // skills found FIVE, of which that is one; the specification stated
          // an instance and was read as a population. So the test in
          // tests/versions.test.mjs derives the skew set the same way this loop
          // does and hardcodes no skill name, and neither does this code: the
          // condition below is a comparison, and the population is every
          // enumerated skill that declares a version. A count written here
          // would be the same mistake in a new place.
          const declaredVersion = declared.metadata?.version;
          if (
            typeof declaredVersion === "string" &&
            typeof plugin.manifest.version === "string" &&
            declaredVersion !== plugin.manifest.version
          ) {
            notes.push({
              code: "I3",
              file: skill.repoPath,
              line: frontmatterKeyLine(fmText, fmFirstLine, "version", { nested: true }),
              message:
                `version skew: this skill declares metadata.version ` +
                `"${declaredVersion}" while ${plugin.manifestRepoPath} declares ` +
                `version "${plugin.manifest.version}" for the plugin that ships ` +
                `it. Both are declared data about different entities; the site ` +
                `renders each on the page of the entity that declared it and ` +
                `merges neither.`,
            });
          }

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
            installCommand: `npx skills add ${repoSlug} --skill ${declared.name}`,
            resources: {
              references: decorate(skill.resources.references, `${skill.repoDir}/references`, true),
              scripts: decorate(skill.resources.scripts, `${skill.repoDir}/scripts`, false),
              assets: decorate(skill.resources.assets, `${skill.repoDir}/assets`, false),
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
          skillIndex.push({
            plugin: plugin.name,
            pluginDisplayName,
            pluginHref: `${base}/plugins/${plugin.name}/`,
            name: declared.name,
            title,
            description: declared.description,
            href: `${base}/${id}/`,
            // ── The only facet in the data (§6.6) ─────────────────────────
            //
            // `plugin.json.keywords`, which Agent Plugins §5.4 defines as
            // "Search and discovery tags". It is a PLUGIN's field. It travels
            // on the skill row because that is the row a reader filters, and
            // it travels under a name that says whose it is, because the one
            // fabrication this catalog invites is a per-skill taxonomy: a
            // skill does not declare "cobra", its plugin does. Carried as the
            // declared array, unsorted and unmerged. Absent when the manifest
            // declares none — not defaulted to [], which would be this site
            // asserting a manifest declared an empty list.
            pluginKeywords: Array.isArray(plugin.manifest.keywords)
              ? plugin.manifest.keywords
              : null,
          });
          // Everything in the resource inventory that this site does NOT route:
          // scripts, assets, and non-markdown references. Counted here, at the
          // one place that also decides what IS routed, so the two can never
          // give different answers about the same file.
          for (const group of ["references", "scripts", "assets"] as const) {
            for (const r of skill.resources[group] ?? []) {
              const routed = group === "references" && r.kind === "file" && /\.md$/i.test(r.name);
              if (!routed) unroutedResources += 1;
            }
          }
          pluginNotes.push(...notes);

          // ── This skill's own reference pages ─────────────────────────────
          // Phase 1 inventoried these and routed none of them; Phase 3 routes
          // the markdown ones, which is where 18 of the 58 pages come from. The
          // non-markdown ones (3 .swift, 1 .sql) stay unrouted for the reason
          // §6.3 gives: a page needs a title and no title exists in the data.
          for (const r of skill.resources.references ?? []) {
            if (r.kind !== "file" || !/\.md$/i.test(r.name)) continue;
            const { notes: refNotes } = await emitReference(
              {
                name: r.name,
                slug: r.name.replace(/\.md$/i, ""),
                path: join(skill.dir, "references", r.name),
                repoPath: `${skill.repoDir}/references/${r.name}`,
              },
              {
                plugin,
                pluginDisplayName,
                skill: skill.name,
                idPrefix: id,
                routedPluginRefs,
                routedSkillRefs,
                routedSkills,
              },
            );
            pluginNotes.push(...refNotes);
          }

          /**
           * The resource inventory's hrefs.
           *
           * `routed` says whether a markdown entry in this group has a page on
           * this site. It does for `references/` as of Phase 3, and a listing
           * that still sent the reader to GitHub for a file the site itself
           * renders would be a link that leaves the site for no reason — and
           * one the internal-link check would never see. Everything else keeps
           * the blob/tree URL: canonical, syntax-highlighted, carries history.
           */
          function decorate(list: any[] | null, repoDir: string, routed: boolean) {
            if (list === null) return null;
            return list.map((r: any) => {
              if (routed && r.kind === "file" && /\.md$/i.test(r.name)) {
                return {
                  name: r.name,
                  kind: r.kind,
                  href: `${base}/${id}/references/${r.name.replace(/\.md$/i, "")}/`,
                };
              }
              return {
                name: r.name,
                kind: r.kind,
                href: r.kind === "directory"
                  ? treeUrl(`${repoDir}/${r.name}`)
                  : blobUrl(`${repoDir}/${r.name}`),
              };
            });
          }
        }

        // ── The plugin-level reference pages ───────────────────────────────
        const childRefs: any[] = [];
        for (const reference of plugin.references) {
          const { title, href, notes } = await emitReference(reference, {
            plugin,
            pluginDisplayName,
            idPrefix: `plugins/${plugin.name}`,
            routedPluginRefs,
            routedSkillRefs: new Set<string>(),
            routedSkills,
          });
          childRefs.push({ title, href });
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

      // ── The five pages ABOUT the catalog ─────────────────────────────────
      const { pages: sitePages } = await buildSitePages({
        repoRoot,
        base,
        blobUrl,
        plugins,
        displayNames,
        skillIndex,
        referencePages,
        unroutedResources,
      });

      // Every route the build emits, as the base-prefixed path a link would
      // use. Site pages are added BEFORE any of them is rendered, so they may
      // link to each other; the check in links.mjs then covers all of them.
      const routedPages = new Set<string>([
        ...emittedIds.map((id) => `${base}/${id}/`),
        ...sitePages.map((p: any) => (p.id === "index" ? `${base}/` : `${base}/${p.id}/`)),
      ]);

      for (const page of sitePages) {
        // Site-authored bytes have no repo file of their own; the module that
        // wrote them is the honest `filePath` for Astro to name in an error.
        const repoPath = page.sourcePath ?? "site/src/loaders/site-pages.mjs";
        const body = page.stripH1 ? stripLeadingH1(page.body).body : page.body;
        const { body: rewritten } = rewriteLinks(body, (target, at) =>
          resolveTarget(target, at, {
            kind: "site",
            base,
            blobBase,
            treeBase,
            plugin: "",
            pluginRepoPath: "",
            routedPluginRefs: new Set<string>(),
            routedSkillRefs: new Set<string>(),
            routedSkills: new Set<string>(),
            routedPages,
            resources: null,
            sourceRepoPath: repoPath,
            note: () => {},
          }),
        );
        await emit(page.id, repoPath, {
          title: page.title,
          _page: {
            kind: "site" as const,
            sourcePath: page.sourcePath,
            sourceUrl: page.sourceUrl,
            lists: page.lists,
          },
        }, rewritten, page.body);
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
        // THE INVARIANT THE SCHEMA CANNOT STATE. See skillsSchema above: an
        // entry describes a catalog entity (`_skill`, and then the manifest of
        // the plugin it belongs to) or it describes the site (`_page`). Never
        // both, never neither. Asserted here because here is the only place an
        // entry is made, so there is no path around it.
        const hasSkill = data._skill !== undefined;
        const hasPage = data._page !== undefined;
        if (hasSkill === hasPage) {
          throw new Error(
            `skills-loader: entry "${id}" has ${hasSkill ? "both" : "neither"} ` +
              `\`_skill\` and \`_page\`. Exactly one is required: an entry ` +
              `either describes something in the catalog or describes this site.`,
          );
        }
        if (hasSkill && data._manifest === undefined) {
          throw new Error(
            `skills-loader: entry "${id}" carries \`_skill\` but no ` +
              `\`_manifest\`. Every catalog entity belongs to a plugin, and ` +
              `its manifest is declared data the page may render.`,
          );
        }
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
        emittedIds.push(id);
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
