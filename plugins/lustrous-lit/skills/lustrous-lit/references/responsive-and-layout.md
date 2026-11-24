# Responsive Design & Layout Architecture

Lustrous enforces a strict **two-layer responsive architecture** so interfaces stay fast, predictable under Server-Side Rendering (`@lit-labs/ssr`), and free of layout thrashing.

---

## The Two-Layer Responsive Rule

1. **Layer 1 — CSS for Layout, Spacing, Typography, and Visibility**
   Use Lustrous's reflected responsive attributes (`mobile-direction`, `mobile-columns`, `mobile-padding`, `mobile-gap`, `hidden-on`, `shown-on`), CSS media queries, or CSS `@container` queries whenever the DOM tree stays the same. Pure CSS rules apply immediately during first paint and SSR before JavaScript hydrates.
2. **Layer 2 — Reactive Controllers Strictly for DOM-Structure Changes**
   Reach for `LustrousViewportController`, `LustrousMediaController`, or `<lustrous-popover mobile-drawer>` **only** when the underlying element hierarchy, ARIA pattern, or top-layer modality must change across viewports (for example, swapping an anchored desktop `<lustrous-popover>` for a swipeable `<lustrous-bottom-sheet>`, or switching an app shell between a persistent `<lustrous-sidebar>` and a modal `<lustrous-sidebar-drawer>`).

---

## Breakpoints (`@ghchinoy/lustrous-lit/theme`)

| Key | Media Query | Purpose |
| :-- | :-- | :-- |
| `mobile` | `(max-width: 768px)` | Content layout: grids collapse, flex toolbars stack, display/headline typography steps down |
| `desktop` | `(min-width: 769px)` | Multi-column content layouts and anchored popovers |
| `shellMobile` | `(max-width: 959.98px)` | Application shell: persistent sidebars collapse into `<lustrous-sidebar-drawer>` and side panels switch to `presentation="takeover"` |
| `shellDesktop` | `(min-width: 960px)` | Persistent `<lustrous-sidebar>` + main workspace + `presentation="split"` `<lustrous-side-panel>` |
| `reducedMotion` | `(prefers-reduced-motion: reduce)` | Motion suppression check |
| `forcedColors` | `(forced-colors: active)` | High-contrast system color check |
| `darkMode` | `(prefers-color-scheme: dark)` | OS dark color-scheme check |

Separating the **content breakpoint (`768px`)** from the **shell breakpoint (`959.98px`)** prevents cramped three-column tablet layouts: between `769px` and `959px`, shell navigation collapses into a drawer while main content retains multi-column space.

---

## Layer 1: CSS-Only Responsive Primitives

```html
<!-- Toolbar that stacks vertically and tightens padding on ≤ 768px -->
<lustrous-flex
  direction="row"
  mobile-direction="column"
  align="center"
  mobile-align="stretch"
  justify="space-between"
  gap="l"
  mobile-gap="s"
  padding="2xl"
  mobile-padding="l"
  background="surface-bright"
  border
  border-radius="xl"
>
  <lustrous-text variant="headline-medium" heading="2">Service Health</lustrous-text>
  <lustrous-button icon="bolt" mobile-width="full">Run Diagnostics</lustrous-button>
</lustrous-flex>

<!-- 3-column dashboard grid that collapses to 1 column on ≤ 768px -->
<lustrous-grid columns="3" mobile-columns="1" gap="l" mobile-gap="m">
  <lustrous-box padding="l" background="surface" border border-radius="l">Latency</lustrous-box>
  <lustrous-box padding="l" background="surface" border border-radius="l">Throughput</lustrous-box>
  <lustrous-box padding="l" background="surface" border border-radius="l">Error Budget</lustrous-box>
</lustrous-grid>
```

| Element | Responsive Attributes (`≤ 768px` unless noted) |
| :-- | :-- |
| `<lustrous-box>` (and subclasses) | `mobile-padding`, `mobile-padding-block`, `mobile-padding-inline`, `mobile-display`, `mobile-width` (`full`, `auto`, `fit-content`, `min-content`, `max-content`), `hidden-on`, `shown-on` |
| `<lustrous-flex>` | `mobile-direction`, `mobile-align`, `mobile-justify`, `mobile-gap` |
| `<lustrous-grid>` | `mobile-columns`, `mobile-align`, `mobile-gap` |
| `<lustrous-text>` | `mobile-variant`, `mobile-padding` (plus automatic `mobileTypographySteps` on `display-*` and `headline-large`/`headline-medium`) |

Both `hidden-on` and `shown-on` accept `"mobile" | "desktop" | "shell-mobile" | "shell-desktop"` and apply `display: none !important`, removing inactive elements from both layout and the accessibility tree.

### Media & `@container` Queries in Custom Styles

```ts
import { css, html, unsafeCSS } from "lit";
import { LustrousElement, breakpoints, lustrousBase } from "@ghchinoy/lustrous-lit/theme";

export class MetricCard extends LustrousElement {
  static override styles = [
    lustrousBase,
    css`
      :host {
        display: block;
        container-type: inline-size;
      }
      .layout {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: var(--lustrous-space-m);
      }
      @container (max-width: 340px) {
        .layout {
          grid-template-columns: 1fr;
        }
      }
      @media ${unsafeCSS(breakpoints.mobile)} {
        .layout {
          gap: var(--lustrous-space-s);
        }
      }
    `,
  ];

  protected override render() {
    return html`<div class="layout"><slot></slot></div>`;
  }
}
```

---

## Layer 2: Structural Adaptation in JavaScript

- **Adaptive Popover (`<lustrous-popover mobile-drawer>`):** Anchored `[popover]` above `768px`; automatically switches to `<lustrous-bottom-sheet>` at `≤ 768px`.
- **`LustrousViewportController`:** Exposes `viewport.isMobile` / `isDesktop` (`768px`) and `viewport.isShellMobile` / `isShellDesktop` (`959.98px`).
- **`LustrousMediaController`:** Accepts any `breakpoints` key (`"reducedMotion"`, `"forcedColors"`, `"darkMode"`) or arbitrary media query string.
- **SSR note:** During `@lit-labs/ssr`, `globalThis.matchMedia` is absent, so controllers default to `false` (desktop structure) and synchronize in `hostConnected()` on the client. Prefer Layer 1 CSS attributes whenever the DOM tree stays identical.
