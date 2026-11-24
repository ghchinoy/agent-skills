---
name: lustrous-lit
description: Build accessible, responsive web interfaces using the Lustrous Design System (@ghchinoy/lustrous-lit) for Lit 3 and standard HTML custom elements. Use when installing or theming Lustrous, composing layout and typography primitives, wiring form-associated controls, opening top-layer overlays, configuring app-shell navigation, binding keyboard shortcuts, rendering/registering icons, or styling with --lustrous-* CSS tokens.
license: Apache-2.0
compatibility: Works with Lit 3, plain HTML, React 19, Vue 3, Angular, Svelte 5, and @lit-labs/ssr. Lookup script requires Node.js >= 22.23.4.
metadata:
  author: ghchinoy
  version: "0.2.0"
---

# Lustrous Design System (`@ghchinoy/lustrous-lit`)

[`@ghchinoy/lustrous-lit`](https://www.npmjs.com/package/@ghchinoy/lustrous-lit) ([GitHub repository](https://github.com/ghchinoy/lustrous-lit)) is a zero-CDN, WCAG 2.1 AA, CSP-safe, and `@lit-labs/ssr`-compatible web component design system built on Lit 3, `ElementInternals`, native `<dialog>`, and the Popover API.

## Progressive Disclosure & Bundled Resources

- [`references/component-catalog.md`](references/component-catalog.md) — Generated API reference for every `<lustrous-*>` custom element (module paths, attributes, events, slots, and `::part(...)` hooks).
- [`references/theming-and-tokens.md`](references/theming-and-tokens.md) — Deep dive on `@layer lustrous`, `setLustrousTheme`, nested theme islands, shadow-root scoping, localization (`setLustrousLabels`), OFL-1.1 fonts, and full `--lustrous-*` token scales.
- [`references/responsive-and-layout.md`](references/responsive-and-layout.md) — Two-layer responsive architecture (`768px` content vs `959.98px` shell), CSS-only responsive attributes, `@container` queries, `<lustrous-popover mobile-drawer>`, and `LustrousViewportController`.
- [`references/frameworks-and-ssr.md`](references/frameworks-and-ssr.md) — Integration patterns for Plain HTML + Import Maps, Lit 3, React 19 / `@lit/react`, Vue 3, Angular, Svelte 5, embedded Go/Rust/Python servers, strict CSP headers, and `@lit-labs/ssr` hydration.
- [`scripts/lookup-lustrous.mjs`](scripts/lookup-lustrous.mjs) — Fast CLI inspector querying [`assets/catalog.json`](assets/catalog.json) for component props/events/slots/parts, `--lustrous-*` tokens, and core icon names without loading large manifests into context:
  ```bash
  ./scripts/lookup-lustrous.mjs lustrous-select
  ./scripts/lookup-lustrous.mjs --tokens surface
  ./scripts/lookup-lustrous.mjs --icons arrow
  ```
- **Starter templates in `assets/`:**
  - [`assets/importmap-starter.html`](assets/importmap-starter.html) — Zero-bundler HTML5 + ES Import Map starter page.
  - [`assets/app-shell-starter.ts`](assets/app-shell-starter.ts) — Responsive Lit 3 workspace shell (`<lustrous-sidebar>`, `<lustrous-sidebar-drawer>`, `<lustrous-side-panel>`, shortcuts).
  - [`assets/theme-overrides.css`](assets/theme-overrides.css) — Unlayered brand palette override stylesheet winning cleanly over `@layer lustrous`.
- **Companion skills in this plugin:** Activate `lustrous-component-author` when authoring new custom `LustrousElement` subclasses, and `lustrous-reviewer` when auditing templates/styles for CSP, token, SSR, and WCAG 2.1 AA compliance.

---

## 1. Setup, Entry Points & Theming

```ts
// Recommended application entry (Vite / Rollup / esbuild)
import "@ghchinoy/lustrous-lit/theme.css"; // @layer lustrous tokens + .lustrous-root + .lustrous-* typography
import "@ghchinoy/lustrous-lit/fonts.css"; // OFL-1.1 Google Sans Flex + Google Sans Code @font-face
import { setLustrousTheme, setLustrousLabels } from "@ghchinoy/lustrous-lit/theme";

// Import only the components you use (tree-shakable):
import "@ghchinoy/lustrous-lit/components/lustrous-button";
import "@ghchinoy/lustrous-lit/components/lustrous-flex";
// Or register every <lustrous-*> element at once:
// import "@ghchinoy/lustrous-lit";
```

- **Root HTML setup:** `<html lang="en" data-theme="system" class="lustrous-root">`.
- **Theme modes (`data-theme` or `data-lustrous-theme`):** `"light" | "dark" | "system"`. Place `data-theme="dark"` or `data-theme="light"` on any element to create a nested theme island.
- **Programmatic helpers (`@ghchinoy/lustrous-lit/theme`):**
  - `setLustrousTheme(preference, { root?, storageKey? })`
  - `readLustrousThemePreference(storageKey, fallback = "system")`
  - `resolveLustrousTheme(el?)` → `"light" | "dark"`
  - `installLustrousTheme(root?)` / `installLustrousFonts(baseUrl?)`
  - `lustrousDarkDeclarations` / `lustrousLightDeclarations` (selector-free `CSSResult`s for shadow roots)
  - `setLustrousLabels({ close, dismiss, notificationBanner, notifications })` for global localization

---

## 2. Layout & Typography Primitives

Compose primitives instead of writing ad-hoc wrapper `<div>`s and CSS margins:

### `<lustrous-box>` (`@ghchinoy/lustrous-lit/components/lustrous-box`)
Foundational zero-wrapper host container:
- **Spacing (`xs` `4px`, `s` `8px`, `m` `12px`, `l` `16px`, `xl` `20px`, `2xl` `24px`, `3xl` `32px`, `4xl` `48px`, `none`, `0`):**
  - `padding`, `padding-block`, `padding-inline`, `padding-top`, `padding-bottom`, `padding-start`, `padding-end`
  - `mobile-padding`, `mobile-padding-block`, `mobile-padding-inline` (at `≤ 768px`)
  - `margin*` (also accepts negative tokens `-xs`…`-4xl` and `auto`)
- **Surfaces (`background`):** `none`, `code`, `surface`, `surface-bright`, `surface-dim`, `surface-inverted`, `surface-accent`, `surface-container-low`, `surface-container`, `surface-container-high`, `surface-container-highest`, `primary-container`, `accent-container`, `tertiary-container`, `positive-container`, `warning-container`, `error-container`, `on-surface-low`. Automatically pairs matching foreground `color` and `--lustrous-text-muted`.
- **Borders, radius & elevation:** `border`, `border-block`, `border-inline`, `border-top`, `border-bottom`, `border-start`, `border-end`, `border-radius="none | xs | s | m | l | xl | 2xl | full"`, `shadow="1 | 2"`.
- **Sizing & visibility:** `width`, `mobile-width`, `height`, `min-width`, `max-width`, `min-height`, `max-height` (numbers become `px`, `"full"` → `100%`, `"viewport"` → `100vw`/`100vh`), `display`, `mobile-display`, `position`, `overflow*`, `z-index`, `hidden-on="mobile | desktop | shell-mobile | shell-desktop"`, `shown-on="..."`, `animate`, `transition`.

### `<lustrous-flex>` & `<lustrous-flex-item>` (`.../components/lustrous-flex`)
Inherits all `<lustrous-box>` attributes plus:
- Container: `direction`, `mobile-direction`, `align`, `mobile-align`, `justify`, `mobile-justify`, `wrap`, `gap`, `mobile-gap`, `row-gap`, `column-gap`, `inline`.
- Item (`<lustrous-flex-item>` or nested `<lustrous-flex>`): `grow`, `shrink`, `basis`, `align-self`, `order`.

### `<lustrous-grid>` & `<lustrous-grid-item>` (`.../components/lustrous-grid`)
Inherits all `<lustrous-box>` attributes plus:
- Container: `columns` (integer `3` → `repeat(3, minmax(0, 1fr))` or raw track list), `mobile-columns`, `rows`, `gap`, `mobile-gap`, `row-gap`, `column-gap`, `align`, `mobile-align`, `justify`, `auto-flow`, `inline`.
- Item (`<lustrous-grid-item>`): `col-span` (`number | "full"`), `row-span`, `col`, `row`.

### `<lustrous-scrollable-box>` (`.../components/lustrous-scrollable-box`)
Scroll region with thin scrollbars, `36px` overflow edge-fade masks (`scrim="both | start | end | none"`), `scrollbar="hover | always | hidden"`, `label` (`role="region"`), and automatic `tabindex="0"` when overflowing.

### `<lustrous-text>` (`.../components/lustrous-text`)
Inline by default; `block`, `heading="1"…"6"` (via `ElementInternals`), `wrap="truncate"`, and `max-lines="1 | 2 | 3"` render block-level:
- `variant`: `display-large`, `display-medium`, `display-small`, `headline-large`, `headline-medium`, `headline-small`, `lead`, `body-large`, `body-large-emphasized`, `body-medium` (default), `body-medium-emphasized`, `body-small`, `body-small-emphasized`, `callout`, `blockquote`, `caption`, `overline`, `code`.
- `mobile-variant`, `tone="default | primary | tertiary | positive | warning | error"`, `muted`, `text-align`, `visually-hidden`.

### `<lustrous-prose-text>` & `<lustrous-prose-direction-scope>` (`.../components/lustrous-prose-text`)
Bidirectional multilingual prose typography extending `<lustrous-text>`:
- Automatically estimates base `dir` (`ltr` vs `rtl`) by word ratio, isolates technical LTR tokens (`C++`, `foo()`, `/usr/local`) in `<bdi dir="ltr">`, and accepts `language`, `fallback-dir`, and `inline-isolate`.
- Wrap multilingual lists or tables in `<lustrous-prose-direction-scope align-start>` to aggregate word counts bottom-up.

---

## 3. Buttons, Links & Interactive Surfaces

- **`<lustrous-button>`** (`.../components/lustrous-button`):
  - `variant`: `"accent"` (default), `"tonal"`, `"outline"`, `"bright"`, `"on-surface"`, `"on-surface-variant"`, `"translucent"`.
  - `size`: `"m"` (`44px`), `"s"` (`36px`), `"xs"` (`28px`); `shape`: `"rounded"` | `"pill"`.
  - `icon`, `trailing-icon`, `expanded` (renders animated chevron + `aria-expanded`), `muted`, `disabled`, `type="button | submit | reset"`, or link mode via `href`, `target`, `rel`, `download`.
- **`<lustrous-icon-button>`** (`.../components/lustrous-icon-button`):
  - Circular icon button (`44px` / `36px` / `28px`). **Always pass `aria-label`!** Supports `icon`, `variant` (`"on-surface"` default), `size`, `badge` (unread dot), `expanded`, `href`.
- **`<lustrous-togglable-button>`** (`.../components/lustrous-togglable-button`) & **`<lustrous-togglable-icon-button>`** (`.../components/lustrous-togglable-icon-button`):
  - Binary toggle buttons (`selected`, `aria-pressed`, optional `selected-icon` on icon button). Dispatch cancelable `lustrous-change` (`{ selected: boolean }`).
- **`<lustrous-split-button>`** (`.../components/lustrous-split-button`):
  - `.actions=${[{ id: "deploy", label: "Deploy" }, { id: "canary", label: "Canary" }]}`, `variant`, `size`, `shape`, `@lustrous-action` (`{ action, index }`).
- **`<lustrous-action-bar>`** (`.../components/lustrous-action-bar`):
  - Pill `role="toolbar"` container (`variant="flat | floating"`, `label`).
- **`<lustrous-link>`** (`.../components/lustrous-link`):
  - Inline `<a>` (with `href`) or `<button>` (`variant="primary | default | muted"`, `underline="always | hover | none"`, `external`).
- **`<lustrous-pressable>`** (`.../components/lustrous-pressable`):
  - Interactive card/tile surface extending `<lustrous-box>` with focus ring, state layer, `selected`, `disabled`, and `href`.

---

## 4. Form-Associated Controls (`ElementInternals`)

All Lustrous form controls work natively with `<form>`, `new FormData(form)`, `required` validation, `<fieldset disabled>`, and `form.reset()`.

```html
<form id="settings-form">
  <lustrous-flex direction="column" gap="l">
    <lustrous-text-input
      name="service"
      label="Service slug"
      leading-icon="bolt"
      supporting-text="Lowercase letters and hyphens"
      required
    ></lustrous-text-input>

    <lustrous-select name="region" label="Primary region" value="us-east1">
      <option value="us-east1">US East (Virginia)</option>
      <option value="eu-west1">EU West (Belgium)</option>
    </lustrous-select>

    <lustrous-radio-group name="tier" label="Compute tier" value="standard">
      <lustrous-radio value="standard" supporting-text="Shared CPU, auto-scale to zero">Standard</lustrous-radio>
      <lustrous-radio value="dedicated" supporting-text="Dedicated vCPU, instant warm capacity">Dedicated</lustrous-radio>
    </lustrous-radio-group>

    <lustrous-switch name="audit" checked supporting-text="Stream structured logs">Audit logging</lustrous-switch>
    <lustrous-checkbox name="confirm" required>I confirm deployment quota settings</lustrous-checkbox>

    <lustrous-button type="submit" icon="bolt">Save Changes</lustrous-button>
  </lustrous-flex>
</form>
```

- **`<lustrous-text-input>`** (`.../components/lustrous-text-input`): `label`, `caption` / `slot="caption"`, `value`, `size="m | s"`, `leading-icon` / `slot="leading"`, `trailing-icon` / `slot="trailing"`, `leading-text`, `trailing-text`, `supporting-text`, `error`, `validation-state="default | validating | success | error"`, `character-count`, `maxlength`, `readonly`, `disabled`, `required`.
- **`<lustrous-text-area>`** (`.../components/lustrous-text-area`): Extends `<lustrous-text-input>` with `rows` (`4`), `min-rows`, `max-rows`, `auto-grow` (`true` by default), `resize`.
- **`<lustrous-search-bar>`** (`.../components/lustrous-search-bar`): `variant="floating | outlined | transparent"`, `size="m | s"`, `value`, `placeholder`; fires `input`, `lustrous-search` (`{ value }` on Enter), and `lustrous-clear`.
- **`<lustrous-select>`** (`.../components/lustrous-select`): Pass `.options=${[{ value, label, description?, icon?, disabled?, group? }]}` or light-DOM `<option>` / `<optgroup>` children. Supports `label`, `placeholder`, `value`, `size="m | s"`, `supporting-text`, `error`, `validation-state`; fires `lustrous-change` (`{ value }`).
- **`<lustrous-checkbox>`** (`.../components/lustrous-checkbox`) & **`<lustrous-switch>`** (`.../components/lustrous-switch`): `checked`, `indeterminate` (checkbox), `size="m | s"` + `icon`/`off-icon` (switch), `supporting-text`, `value`; fire `lustrous-change` (`{ checked }`). Use `aria-label` when standalone without slotted label text.
- **`<lustrous-radio-group>`** & **`<lustrous-radio>`** (`.../components/lustrous-radio-group`): `label`, `value`, `orientation="vertical | horizontal"`, `supporting-text`, `error`, `required`, `disabled`; fires `lustrous-change` (`{ value }`).

---

## 5. Top-Layer Overlays & Notifications

- **`<lustrous-tooltip>`** (`.../components/lustrous-tooltip`): Non-interactive hover/focus label (`content="..."`, `side="top | bottom | left | right | inline-start | inline-end"`, `only-when-truncated`). Wrap around a focusable trigger.
- **`<lustrous-popover>`** (`.../components/lustrous-popover`): Interactive top-layer card (`heading`, `content`, `slot="content"`, `arrow` default `true`, `size="s | m | l"`, `open-on-hover`, `close-label` for modal focus-trap mode, `mobile-drawer` to auto-switch to `<lustrous-bottom-sheet>` at `≤ 768px`, `primary-action`, `secondary-action`).
- **`<lustrous-menu>`** (`.../components/lustrous-menu`): Top-layer WAI-ARIA menu with nested submenus. Slotted `slot="trigger"`, `.items` (`type: "action" | "link" | "selection" | "toggle" | "submenu" | "header" | "section" | "divider"`), `@lustrous-select` (`{ item, id?, value? }`).
- **`<lustrous-dialog>`** (`.../components/lustrous-dialog`): Structured card (`size="s | m | l"`, `heading`, `dismissible`, `primary-action`, `secondary-action`, or `slot="actions"`). Add `modal` (`slot="trigger"`, `.open`, `@lustrous-action`, `@lustrous-close-request`) to present over a top-layer scrim.
- **`<lustrous-modal>`** (`.../components/lustrous-modal`): Low-level `<dialog>.showModal()` primitive (`open`, `label`, `scrim="default | immersive"`, `scrim-blur`, `slot="trigger"`).
- **`<lustrous-bottom-sheet>`** (`.../components/lustrous-bottom-sheet`): Mobile-first modal sheet with `0.5` peek / `1` full snap points and swipe-to-close (`open`, `expanded`, `label`).
- **`<lustrous-snackbar>`**, **`showSnack`**, **`dismissSnack`** (`.../components/lustrous-snackbar`):
  ```ts
  import { showSnack } from "@ghchinoy/lustrous-lit/components/lustrous-snackbar";

  showSnack("Deployment promoted", {
    variant: "positive", // "default" | "positive" | "warning" | "error"
    action: { label: "Undo", onClick: () => rollback() },
  });
  ```
- **`<lustrous-banner>`** (`.../components/lustrous-banner`): Named `<section>` status/promo banner (`variant="overlay | inline | info | positive | warning | error"`, `heading`, `icon`, `badge`, `dismissible`, `primary-action`, `secondary-action`).

---

## 6. Navigation, View Switchers & Disclosure

- **`<lustrous-sidebar>`** (`.../components/lustrous-sidebar`): Collapsible `272px` ↔ `56px` shell composed with `<lustrous-sidebar-header>`, `<lustrous-sidebar-nav>`, `<lustrous-sidebar-scroll-area>`, `<lustrous-sidebar-section>`, `<lustrous-sidebar-item>` (`icon`, `href`, `active`, `badge="unread | needs-input | in-progress"`, `meta`, `pending`, `.actions`, `.items`), `<lustrous-sidebar-message>`, `<lustrous-sidebar-footer>`, and `<lustrous-sidebar-drawer>` (for `≤ 959.98px`).
- **`<lustrous-side-panel>`** (`.../components/lustrous-side-panel`): Complementary `<aside>` inspector (`open`, `label`, `presentation="split | takeover"`, `side="inline-end | inline-start"`, `slot="header"`, `slot="footer"`, `@lustrous-close-request`).
- **`<lustrous-tabs>`** (`.../components/lustrous-tabs`): `.tabs=${[{ value: "overview", label: "Overview", icon: "activity" }]}`, `value`, `variant="pill | underline"`, optional slotted `<div slot="overview">` panels, `@lustrous-change` (`{ value }`).
- **`<lustrous-segmented-control>`** (`.../components/lustrous-segmented-control`): 2–5 equal-width segments with sliding pill indicator (`.options`, `value`, `size="s | m"`, `variant="default | transparent"`, `@lustrous-change`).
- **`<lustrous-segmented-list>`** (`.../components/lustrous-segmented-list`): Grouped surface cards (`divider` for continuous hairline-separated rows, `border-radius`) containing `<lustrous-segmented-list-item>` (`slot="action"`), `<lustrous-segmented-list-button>`, or `<lustrous-segmented-list-link>`.
- **`<lustrous-collapsible-card>`** (`.../components/lustrous-collapsible-card`) & **`<lustrous-collapsible-container>`** (`.../components/lustrous-collapsible-container`): Accessible disclosure card (`heading`, `subtitle`, `icon`, `badge`, `open`, `slot="actions"`) and headless `0fr`→`1fr` animated height container (`expanded`, `slot="trigger"`).

---

## 7. Display, Feedback & Media

- **`<lustrous-list>`** & **`<lustrous-list-item>`** (`.../components/lustrous-list`): Semantic vertical list (`href`, `static`, `selected`, `icon`, `description`, `slot="end"`). Use `static` when slotting interactive trailing controls.
- **`<lustrous-timeline>`** & **`<lustrous-timeline-item>`** (`.../components/lustrous-timeline`): Milestone & pipeline feed (`status="default | past | active | future"`, `heading`, `time-label`, `icon`, `slot="marker"`).
- **`<lustrous-badge>`** (`.../components/lustrous-badge`) & **`<lustrous-badge-indicator>`** (`.../components/lustrous-badge-indicator`): `24px` pill badge with semantic tones (`default`, `accent`, `positive`, `warning`, `error`) and dual-theme categorical tones (`cobalt`, `emerald`, `amber`, `rose`, `violet`, `teal`) plus optional `icon`.
- **`<lustrous-progress-bar>`** (`.../components/lustrous-progress-bar`): Determinate `0–100` bar (`value`, `label`, `tone`, `decorative`).
- **`<lustrous-spinner>`** (`.../components/lustrous-spinner`): Indeterminate loader (`variant="icon | ring"`, `size`, `tone`, `label`).
- **`<lustrous-skeleton>`** (`.../components/lustrous-skeleton`): Shimmer placeholder (`shape="rect | circle | text"`, `width`, `height`, `border-radius`). Wrap skeleton groups in an `aria-busy="true"` container.
- **`<lustrous-code-block>`** (`.../components/lustrous-code-block`): Dark `--lustrous-font-code` snippet container (`label`, `code` or slotted text, `wrap`, `no-copy`, `@lustrous-copy`).
- **`<lustrous-image>`** (`.../components/lustrous-image`): Responsive `<img>` box (`src`, `alt`, `decorative`, `aspect-ratio="16/9 | 4/3 | 1/1 | ..."`, `object-fit="cover | contain | ..."`).
- **`<lustrous-photo-lightbox>`** (`.../components/lustrous-photo-lightbox`) & **`<lustrous-video-lightbox>`** (`.../components/lustrous-video-lightbox`): Immersive full-screen media viewers (`src`, `label`, `poster`, `captions-src`, `open`, `slot="trigger"`, `slot="actions"`).

---

## 8. Keyboard Shortcuts & Icons

- **`<lustrous-kbd>`** (`.../components/lustrous-kbd`) & **`<lustrous-keyboard-shortcuts-modal>`** (`.../components/lustrous-keyboard-shortcuts-modal`): Platform-aware keycap chip (`keys="Mod+Shift+K"`) and grouped shortcut reference dialog (`.sections`).
- **`LustrousShortcutController`** (`@ghchinoy/lustrous-lit/theme`): Registers shortcuts (`id`, `keys`, `onTrigger`) that automatically respect editable inputs, IME composition, and enclosing overlay scopes (`LustrousShortcutScopeController`).
- **Icons (`.../components/lustrous-icon`):**
  - Declarative: `<lustrous-icon name="bolt" size="s" tone="primary"></lustrous-icon>` (`xs` `16px`, `s` `20px`, `m` `24px`, `l` `32px`, `xl` `40px`).
  - Lit shadow templates: `renderIcon("bolt", "s")` (pass a 3rd `label` string only when non-decorative).
  - Custom icons: `registerLustrousIcons({ myIcon: { paths: svg`...`, directional: false } })`.

---

## 9. Authoring & CSS Token Rules (Strict Checklist)

1. **Always use `--lustrous-*` tokens** (`--lustrous-color-*`, `--lustrous-space-*`, `--lustrous-radius-*`, `--lustrous-elevation-level1`, `--lustrous-elevation-level2`, `--lustrous-font-*`, `lustrousType()`). Never hardcode hex values or raw pixel spacing.
2. **Override tokens without `!important`:** Because `lustrous-theme.css` lives in `@layer lustrous`, unlayered `:root` / `[data-theme="dark"]` token overrides win automatically.
3. **Two-layer responsive rule:** Use CSS attributes (`mobile-direction`, `mobile-columns`, `mobile-padding`, `hidden-on`, `shown-on`) and `@media` / `@container` queries for layout; use `LustrousViewportController` (`isMobile` `≤ 768px`, `isShellMobile` `≤ 959.98px`) or `<lustrous-popover mobile-drawer>` strictly when DOM structure changes.
4. **Never write inline `style="..."` in component templates:** Breaks strict CSP (`style-src 'self'`). Set private `--_lustrous-*` variables via `this.style?.setProperty(...)` in `willUpdate()` (guarded for SSR) and read them in static `css` rules.
5. **Preserve RTL, High-Contrast & WCAG 2.1 AA:** Use logical CSS properties (`padding-inline`, `inset-inline-end`, `text-align: start`), always supply `aria-label` on `<lustrous-icon-button>`, keep touch targets `≥ 44×44px`, and include `lustrousBase`, `lustrousFocusRing`, and `lustrousStateLayer` on custom interactive elements.
