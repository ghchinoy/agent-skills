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
npm run typecheck # astro check
npm test          # the type check, then the guardrail suites
```

Run `npm run build` before `npm test`: most of the suite asserts on the rendered
bytes in `dist/`.

## Continuous integration

Two workflows, both at the repository root in `.github/workflows/`.

| Workflow | When | What it does |
|---|---|---|
| `site-ci.yml` | every pull request touching `plugins/**`, `.claude-plugin/**`, `site/**` or either workflow | `npm ci`, `npm run build`, `npm test`. Does not deploy. |
| `docs.yml` | push to `main` over the same content paths, or `workflow_dispatch` | the same build, then publish to GitHub Pages, then check every link and asset on the published URL. |

`plugins/**` is in both filters on purpose. The site is in this repository so
that a `SKILL.md` change builds the site on the pull request that makes it —
malformed frontmatter or a link to a renamed reference fails there, attributed
to the change that caused it, rather than surfacing later somewhere else.

`docs.yml` triggers on a branch push, never on a tag. The `github-pages`
environment protection rejects `v*` tag refs, so a tag-triggered deploy fires
and then dies at the environment gate. `tests/workflows.test.mjs` asserts the
absence of every tag-shaped trigger, with controls.

The site is published at <https://ghchinoy.github.io/agent-skills/>. To check a
deployment by hand:

```sh
npm run build
npm run check:live -- --url https://ghchinoy.github.io/agent-skills/
```

## What is where

| Path | What it does |
|---|---|
| `src/loaders/enumerate.mjs` | Discovers plugins and skills. Reads `marketplace.json` and the immediate children of `skills/` — and nothing deeper. |
| `src/loaders/frontmatter.mjs` | Parses `SKILL.md` frontmatter against Agent Skills' closed six-field vocabulary. |
| `src/loaders/markdown.mjs` | The only two body transformations: strip the leading H1, rewrite links. Both fence- and code-span-aware. |
| `src/loaders/links.mjs` | Resolves each link target to a routed page or a source permalink. Unrecognised shapes are a hard build error, never a guess. |
| `src/loaders/skills.ts` | The Astro Content Layer loader that ties those together and emits entries. |
| `src/components/EntryMeta.astro` | Renders the declared and derived field blocks above each page body. |
| `src/sidebar.mjs` | Builds the nav from the same discovery the loader uses. Read the header: it explains why a skill entry's label is the declared `name` while its page title is the body H1. |
| `src/styles/tokens.css` | The theme. This is the file a sibling site copies. |
| `public/` | Copied verbatim into `dist/`. Currently one favicon, which exists because Starlight references one on every page. |
| `scripts/check-live-links.mjs` | Fetches the published site and checks every `<a href>`, `src=` and `<link href>` on it, against the deployed artifact. Run by `docs.yml` after each deploy. Retries for propagation; an unreachable site is a failure, not a skip. |
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
