---
name: lustrous-reviewer
description: Audit and review applications and custom elements built with the Lustrous Design System (@ghchinoy/lustrous-lit) for strict CSP compliance, --lustrous-* token hygiene, valid icon names, WCAG 2.1 AA accessibility, top-layer overlay safety, and @lit-labs/ssr hydration readiness. Use when reviewing UI PRs, auditing stylesheets and templates, or validating custom Lustrous components.
license: Apache-2.0
compatibility: Requires Node.js >= 22.23.4 to execute scripts/audit-lustrous.mjs.
metadata:
  author: ghchinoy
  version: "0.2.0"
---

# Lustrous Design System Code & Accessibility Reviewer (`lustrous-reviewer`)

Audit frontend codebases, Lit 3 templates, HTML/JSX/Vue/Svelte views, and stylesheets consuming [`@ghchinoy/lustrous-lit`](https://github.com/ghchinoy/lustrous-lit) against Lustrous's hard engineering, token, Content Security Policy (CSP), SSR, and WCAG 2.1 AA guarantees.

## Bundled Auditor & Reference Catalog

- [`scripts/audit-lustrous.mjs`](scripts/audit-lustrous.mjs) — Zero-dependency static scanner validating source files and directories against [`assets/rules-data.json`](assets/rules-data.json) (every canonical `--lustrous-*` token, documented component `@cssprop`, and `LustrousCoreIconName` icon):
  ```bash
  ./scripts/audit-lustrous.mjs src/
  ./scripts/audit-lustrous.mjs src/ --allow-custom-icons webhook,pipelineStep --json
  ```
- [`references/review-checklist.md`](references/review-checklist.md) — Complete rule catalog (`CSP-01`, `TOK-01`–`TOK-03`, `ICO-01`, `A11Y-01`–`A11Y-03`, `OVR-01`–`OVR-02`, `SSR-01`) with bad/good examples and remediation steps.
- **Companion skills:** Pair with `lustrous-lit` for idiomatic primitive composition and `lustrous-component-author` when refactoring custom `LustrousElement` classes.

---

## Review Workflow

### Step 1: Run Deterministic Static Audit
Run [`scripts/audit-lustrous.mjs`](scripts/audit-lustrous.mjs) against the target directory or changed files first:

```bash
./scripts/audit-lustrous.mjs <path-to-app-or-components>
```

If the project registers custom icons via `registerLustrousIcons({ ... })`, pass those icon keys via `--allow-custom-icons name1,name2` so `ICO-01` allows them cleanly.

### Step 2: Manual Architectural & Accessibility Inspection
After resolving static findings, inspect changed components against the semantic checks in [`references/review-checklist.md`](references/review-checklist.md):

1. **Primitive Composition Over Ad-Hoc Wrappers:** Are raw `<div class="flex">` wrappers and custom margin/padding CSS used where `<lustrous-flex>`, `<lustrous-grid>`, `<lustrous-box>`, and `<lustrous-text>` express the layout declaratively (including `mobile-direction`, `mobile-columns`, `mobile-padding`, `hidden-on`, `shown-on`)?
2. **Cascade Layer Hygiene (`@layer lustrous`):** Do application theme overrides use clean unlayered `:root` and `[data-theme="dark"]` selectors rather than `!important`? If a custom `[data-theme]` scope overrides surface colors, are both light and dark pairs calibrated to WCAG 2.1 AA (`≥ 4.5:1` text, `≥ 3:1` outlines)?
3. **Interactive Accessibility (`A11Y-01`..`A11Y-03`):**
   - Every `<lustrous-icon-button>` and `<lustrous-togglable-icon-button>` carries a descriptive `aria-label` or `aria-labelledby`.
   - Every `<lustrous-list-item>` containing an interactive control in `slot="end"` sets the `static` attribute (preventing nested interactive button/link controls).
   - Touch targets maintain `≥ 44×44px` hit bounds and custom interactive controls include `lustrousBase`, `lustrousFocusRing`, and `lustrousStateLayer`.
4. **Overlay & Event Layering (`OVR-01`..`OVR-02`):**
   - Composite components wrapping `<lustrous-modal>`, `<lustrous-dialog>`, `<lustrous-bottom-sheet>`, `<lustrous-popover>`, or `<lustrous-menu>` guard `lustrous-toggle` and `lustrous-close-request` handlers with `if (e.target !== e.currentTarget) return;`.
   - Custom `[popover]` surfaces include `[popover]:not(:popover-open) { display: none !important; }` and initialize `dismissedAt = -Infinity`.
5. **SSR & High-Contrast Readiness (`SSR-01`):**
   - Browser globals (`window`, `document`, `ResizeObserver`, `getComputedStyle`, `showPopover`, `showModal`) never run in `constructor()`, `willUpdate()`, or `render()`.
   - Custom elevated cards and state indicators define `@media (forced-colors: active)` borders (`CanvasText` / `ButtonBorder`) and `Highlight` / `GrayText` fills, and layout CSS uses logical properties (`padding-inline`, `inset-inline-end`, `text-align: start`).

---

## Step 3: Report Format

Present findings grouped by severity with exact `file:line` locations and drop-in fixes:

| Severity | Rule IDs | Meaning |
| :-- | :-- | :-- |
| **FAIL (Blocker)** | `CSP-01`, `TOK-02`, `A11Y-01`, `OVR-01`, `SSR-01` | Breaks `style-src 'self'` CSP, references a non-existent `--lustrous-*` token, omits accessible name on icon button, drops clicks at startup, or crashes `@lit-labs/ssr`. |
| **WARN (Actionable)** | `TOK-01`, `TOK-03`, `ICO-01`, `A11Y-02`, `OVR-02` | Masks theme drift via `var()` fallbacks or raw hex colors, uses unregistered icon name, nests interactive controls without `static`, or lacks `e.target === e.currentTarget` event guard. |
| **PASS** | — | Zero blockers and all verified axes conform. |
