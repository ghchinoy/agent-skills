# Theming, Tokens & Typography

Lustrous Design System (`@ghchinoy/lustrous-lit`) uses an architectural **Mineral Slate** neutral ramp paired with **Lustrous Sapphire** primary/accent tones and **Mineral Teal** tertiary accents. Every foreground/background token pair is calibrated to meet **WCAG 2.1 AA** (`≥ 4.5:1` for text, `≥ 3:1` for interactive boundaries) across both light and dark modes.

---

## Quick Start

For zero-FOUC rendering (including Declarative Shadow DOM before JavaScript loads), link the Lustrous theme and bundled font stylesheets in `<head>` and set `data-theme` plus `class="lustrous-root"` on `<html>`:

```html
<!doctype html>
<html lang="en" data-theme="system" class="lustrous-root">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="/node_modules/@ghchinoy/lustrous-lit/dist/lustrous-theme.css" />
    <link rel="stylesheet" href="/node_modules/@ghchinoy/lustrous-lit/fonts/lustrous-fonts.css" />
  </head>
  <body>
    <lustrous-button icon="bolt">Launch</lustrous-button>
    <script type="module">
      import "/src/main.ts";
    </script>
  </body>
</html>
```

With a bundler (Vite, Rollup, Webpack, esbuild), import the package CSS entry points in your application entry module:

```ts
import "@ghchinoy/lustrous-lit/theme.css";
import "@ghchinoy/lustrous-lit/fonts.css";
import "@ghchinoy/lustrous-lit";
```

### Zero-Config Adoption

Every component extending `LustrousElement` calls `installLustrousTheme(this.ownerDocument)` idempotently in `connectedCallback()`. If you drop a `<lustrous-button>` onto a page without linking `theme.css`, Lustrous automatically adopts `lustrousTheme` via `document.adoptedStyleSheets` (falling back to a `<style data-lustrous-theme>` element in `<head>`). Linking `@ghchinoy/lustrous-lit/theme.css` up front is still recommended so page backgrounds and server-rendered Declarative Shadow DOM paint immediately before scripts execute.

---

## Cascade Layers (`@layer lustrous`)

`lustrous-theme.css` (and `lustrousThemeCssText`) wraps every rule inside `@layer lustrous`. Because CSS Cascade Layers place **unlayered styles above all `@layer` blocks**, your application overrides win without `!important` or specificity workarounds:

```css
/* Application stylesheet (unlayered — wins over @layer lustrous automatically) */
:root {
  --lustrous-color-primary: #0369a1;
  --lustrous-color-accent: #0284c7;
  --lustrous-radius-m: 8px;
}

[data-theme="dark"] {
  --lustrous-color-primary: #7dd3fc;
  --lustrous-color-accent: #38bdf8;
}
```

> **Note on derived tokens:** CSS custom properties resolve `var()` references on the element where the property is declared. Whenever `[data-theme]` switches color scopes, Lustrous also re-declares `--lustrous-elevation-level1`, `--lustrous-elevation-level2`, and `--lustrous-text-muted` so shadows and secondary text always track the active surface palette.

---

## Theme Switching & Nested Theme Islands

Both `data-theme` and `data-lustrous-theme` attributes are recognized (`"light" | "dark" | "system"`):

```ts
import {
  readLustrousThemePreference,
  resolveLustrousTheme,
  setLustrousTheme,
  type LustrousThemePreference,
} from "@ghchinoy/lustrous-lit/theme";

const STORAGE_KEY = "app-theme";
const initial: LustrousThemePreference = readLustrousThemePreference(STORAGE_KEY, "system");
setLustrousTheme(initial, { storageKey: STORAGE_KEY });

// Switch to dark mode and persist to localStorage
setLustrousTheme("dark", { storageKey: STORAGE_KEY });

// Inspect the effective concrete theme ("light" | "dark") for any element
const effective = resolveLustrousTheme(document.documentElement);
```

### Nested Theme Islands & Shadow-Root Scoping

Place `data-theme="dark"` or `data-theme="light"` on any element to create a localized theme island without affecting surrounding UI. For isolated shadow roots, call `installLustrousTheme(myWidget.shadowRoot!)` or interpolate `lustrousDarkDeclarations` / `lustrousLightDeclarations` inside `:host { ... }`.

---

## Global UI & Accessibility Localization (`setLustrousLabels`)

```ts
import { getLustrousLabels, setLustrousLabels } from "@ghchinoy/lustrous-lit/theme";

setLustrousLabels({
  close: "Fermer",
  dismiss: "Ignorer",
  notificationBanner: "Banniere d'information",
  notifications: "Notifications",
});
```

---

## Bundled OFL-1.1 Fonts

`@ghchinoy/lustrous-lit` ships self-hosted Latin + Latin-Extended variable WOFF2 subsets licensed under **OFL-1.1**:
- **Google Sans Flex** (`wght` 1–1000, `wdth` 75–100, `opsz` 6–72, `ROND` 0–100): Display (`ROND` 20–25), Headlines (`ROND` 10), Body & UI (`ROND` 0).
- **Google Sans Code** (`wght` 300–800, normal & italic): `<lustrous-kbd>`, `<lustrous-code-block>`, `variant="code"`.

Load via `import "@ghchinoy/lustrous-lit/fonts.css"`, `<link rel="stylesheet" href=".../fonts/lustrous-fonts.css">`, or `installLustrousFonts(baseUrl?)` (prefer `<link>` under strict `style-src 'self'` CSP).

---

## Token Reference

### Surfaces, Text & Outlines

| CSS Custom Property | Light Value | Dark Value | Role |
| :-- | :-- | :-- | :-- |
| `--lustrous-color-background` | `#f8fafc` | `#0b0f17` | Document canvas background (`.lustrous-root`) |
| `--lustrous-color-on-background` | `#0f172a` | `#e2e8f0` | Primary text on document canvas |
| `--lustrous-color-surface` | `#ffffff` | `#111827` | Default component and card surface |
| `--lustrous-color-surface-bright` | `#ffffff` | `#1f2937` | Elevated cards, popovers, menus, dialogs |
| `--lustrous-color-surface-dim` | `#f1f5f9` | `#0d131f` | Recessed tracks, inline banners, active pills |
| `--lustrous-color-surface-background` | `#f8fafc` | `#0b0f17` | App-shell background |
| `--lustrous-color-surface-container-low` | `#f4f7fb` | `#151d2e` | Subtle grouped surface |
| `--lustrous-color-surface-container` | `#f1f5f9` | `#1a2336` | Standard container fill (`<lustrous-kbd>`, cards) |
| `--lustrous-color-surface-container-high` | `#e2e8f0` | `#232f46` | Tonal buttons, progress tracks, default badges |
| `--lustrous-color-surface-container-highest` | `#d5dee9` | `#2e3c56` | Scrollbar thumbs, active dark segmented pills |
| `--lustrous-color-surface-accent` | `#dbeafe` | `#172554` | Tinted accent surface |
| `--lustrous-color-on-surface` | `#0f172a` | `#f1f5f9` | Primary foreground text and icons |
| `--lustrous-color-on-surface-control` | `#0f172a` | `#f1f5f9` | Interactive control foreground |
| `--lustrous-color-on-surface-variant` | `#475569` | `#9aa9be` | Secondary copy, captions, supporting text |
| `--lustrous-color-on-surface-low` | `rgba(15, 23, 42, 0.08)` | `rgba(241, 245, 249, 0.10)` | Skeleton shimmer base, subtle fills |
| `--lustrous-color-outline` | `#64748b` | `#8496ae` | Accessible 3:1 control borders (inputs, switches) |
| `--lustrous-color-outline-variant` | `#cbd5e1` | `#334155` | Hairline dividers and card borders |
| `--lustrous-text-muted` | `var(--lustrous-color-on-surface-variant)` | `var(--lustrous-color-on-surface-variant)` | Context-adaptive secondary text |

### Brand, Semantic & Categorical Colors

- **Brand & semantic:** `--lustrous-color-{primary,accent,tertiary,positive,warning,error}` plus `-on-*` and `*-container` / `-on-*-container` pairs, and `--lustrous-color-accent-fixed`.
- **Categorical (`<lustrous-badge tone="...">`):** `--lustrous-color-category-{cobalt,emerald,amber,rose,violet,teal}` and `--lustrous-color-on-category-*`.
- **State layers, scrims & elevation:** `--lustrous-color-state-{hover,focus,pressed,disabled,disabled-label}`, `--lustrous-color-scrim`, `--lustrous-color-scrim-immersive`, `--lustrous-elevation-level1`, `--lustrous-elevation-level2`.
- **Code & data series:** `--lustrous-color-code-{background,primary-text,comment,outline,grey-text,blue-text,pink-text,yellow-text,green-text,red-text,purple-text,teal-text}` and `--lustrous-color-data{1..5}` (`-hover`, `-focus`, `-pressed`).

### Spacing, Radius, Z-Index, Typography & Motion Scales

| Scale | Tokens |
| :-- | :-- |
| **Spacing (`--lustrous-space-*`)** | `xs` (`4px`), `s` (`8px`), `m` (`12px`), `l` (`16px`), `xl` (`20px`), `2xl` (`24px`), `3xl` (`32px`), `4xl` (`48px`) |
| **Radius (`--lustrous-radius-*`)** | `none` (`0px`), `xs` (`4px`), `s` (`6px`), `m` (`10px`), `l` (`14px`), `xl` (`20px`), `2xl` (`28px`), `full` (`9999px`) |
| **Z-index (`--lustrous-z-*`)** | `base` (`0`), `modal` (`30000`), `dropdown` (`40000`), `tooltip` (`50000`), `snackbar` (`60000`) |
| **Fonts (`--lustrous-font-*`)** | `display`, `body`, `sans`, `code` |
| **Typography (`lustrousType(v)`)** | `display-large`, `display-medium`, `display-small`, `headline-large`, `headline-medium`, `headline-small`, `lead`, `body-large`, `body-large-emphasized`, `body-medium`, `body-medium-emphasized`, `body-small`, `body-small-emphasized`, `callout`, `blockquote`, `caption`, `overline`, `code` |
| **Durations (`--lustrous-duration-*`)** | `instant`, `short50`, `short100`, `short150`, `short200`, `medium250`, `medium300`, `medium350`, `medium400`, `long450`, `long500`, `long600`, `extralong750`, `extralong1000` |
| **Easings (`--lustrous-easing-*`)** | `standard`, `standard-decelerate`, `standard-accelerate`, `standard-neutral`, `linear`, `emphasized`, `emphasized-decelerate`, `emphasized-accelerate`, `spring-standard` |
| **Paired Motion (`--lustrous-motion-*`)** | `fade-through`, `fast-fade`, `fade`, `scale-in`, `scale-out`, `lateral`, `shared-axis-x`, `shared-axis-y`, `fast-shared-axis-y`, `bottom-enter`, `bottom-exit`, `container-transform-enter`, `container-transform-exit`, `fast-spatial`, `default-spatial`, `slow-spatial` |
