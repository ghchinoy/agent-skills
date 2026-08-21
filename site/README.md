# Documentation site

A static site for this catalog, built from the repository's own plugin and skill
files. Nothing here is a second copy of the content: every page is rendered from
`.claude-plugin/marketplace.json`, `plugins/*/plugin.json` and the `SKILL.md`
files at build time, so the site cannot drift from the repo.

**Phase 1 renders one plugin — `okf-authoring` — as a vertical slice.** The fan
out to the rest of the catalog is a later change to a single array; see
`src/site.config.mjs`.

## Build it

Node 22.19.0 or newer (`engines.node` enforces the floor).

```sh
cd site
npm ci
npm run build     # -> site/dist
npm run dev       # local preview
npm test          # the guardrail suites
```

The build is entirely local. There is no GitHub Actions workflow for it yet.

## What is where

| Path | What it does |
|---|---|
| `src/loaders/enumerate.mjs` | Discovers plugins and skills. Reads `marketplace.json` and the immediate children of `skills/` — and nothing deeper. |
| `src/loaders/frontmatter.mjs` | Parses `SKILL.md` frontmatter against Agent Skills' closed six-field vocabulary. |
| `src/loaders/markdown.mjs` | The only two body transformations: strip the leading H1, rewrite links. Both fence- and code-span-aware. |
| `src/loaders/links.mjs` | Resolves each link target to a routed page or a source permalink. Unrecognised shapes are a hard build error, never a guess. |
| `src/loaders/skills.ts` | The Astro Content Layer loader that ties those together and emits entries. |
| `src/components/EntryMeta.astro` | Renders the declared and derived field blocks above each page body. |
| `src/styles/tokens.css` | The theme. This is the file a sibling site copies. |
| `tests/` | The guardrail suites. Run them before you publish anything. |

## The rule this site is built to

Render only what the repository declares, plus facts the build computed and
labels as computed. A field the source does not declare is **absent** — the row
is omitted. Not `n/a`, not an empty label, not a default. No invented
descriptions, titles, categories, tags or capabilities.

Where the source data conflicts with a specification, the build reports an
advisory to the log naming the file and line, and renders what the source
actually says. It does not repair the repo behind the reader's back. Run
`npm run build` and read the `[WARN]` block to see the current set.

The tests in `tests/` exist to keep that honest, and each one carries a control
proving it can fail. If you change what the site renders, change a test with it.
