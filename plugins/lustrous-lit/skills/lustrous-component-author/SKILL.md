---
name: lustrous-component-author
description: Author custom LustrousElement web components and extend the Lustrous Design System (@ghchinoy/lustrous-lit). Use when creating reusable Lit 3 custom elements, implementing ElementInternals form-associated controls, building top-layer Popover or dialog surfaces, registering custom SVG icons, enforcing strict CSP without inline styles, or ensuring @lit-labs/ssr, forced-colors, reduced-motion, and RTL compliance.
license: Apache-2.0
compatibility: Requires Lit 3 (^3.0.0) and TypeScript 5+.
metadata:
  author: ghchinoy
  version: "0.2.0"
---

# Authoring Lustrous Custom Elements (`lustrous-component-author`)

Build application and design-system Web Components on top of [`@ghchinoy/lustrous-lit`](https://github.com/ghchinoy/lustrous-lit) that uphold strict Content Security Policy (`style-src 'self'`), `@lit-labs/ssr` Declarative Shadow DOM hydration, `ElementInternals` form participation, and WCAG 2.1 AA (`light`, `dark`, `forced-colors`, `prefers-reduced-motion`, and `dir="rtl"`).

## Bundled References & Starter Templates

- [`references/engineering-pitfalls.md`](references/engineering-pitfalls.md) — Complete code recipes and hard-won Web Components rules (`ElementInternals` lifecycle, `[popover]` `floatingResetCss`, `dismissedAt = -Infinity`, modal sibling `inert` locks, layered `Escape` scopes, SSR guards, and `forced-colors`).
- [`assets/custom-element.template.ts`](assets/custom-element.template.ts) — Ready-to-copy `LustrousElement` component scaffold with `lustrousBase`, `lustrousFocusRing`, `lustrousStateLayer`, CSP-safe `--_lustrous-*` CSSOM geometry, and `forced-colors` fallbacks.
- [`assets/form-control.template.ts`](assets/form-control.template.ts) — Ready-to-copy `ElementInternals` form-associated custom element scaffold (`formAssociated = true`, `delegatesFocus: true`, `formDisabledCallback`, `formResetCallback`, `formStateRestoreCallback`, and `lustrous-change`).
- **Companion skills:** Use `lustrous-lit` when composing existing `<lustrous-*>` elements, and `lustrous-reviewer` to run automated CSP/token/icon/a11y checks on your finished component.
- **Recommended external companion:** Pair with Chrome's [Modern Web Guidance](https://developer.chrome.com/docs/modern-web-guidance) (`npx modern-web-guidance@latest install`, configured with `Baseline 2024`) for Web Components platform guides (`html/web-components`, `shadow-dom`, `form-associated-custom-elements`), CSS Scroll-Driven Animations, View Transitions, and Core Web Vitals. Always keep Lustrous's CSP (`style-src 'self'`), `--lustrous-*` token hygiene, and `LustrousElement` rules authoritative when adapting platform patterns.

---

## 1. Subclass `LustrousElement` & Include Shared Style Mixins

Always extend `LustrousElement` from `@ghchinoy/lustrous-lit/theme` rather than raw `LitElement`:
1. Idempotently calls `installLustrousTheme(this.ownerDocument)` on connect so `--lustrous-*` tokens always exist (never add hardcoded `var(--lustrous-*, #fallback)` hex fallbacks).
2. Refreshes shared `adoptedStyleSheets` across `mobile` (`768px`) and `shellMobile` (`959.98px`) transitions so WebKit re-evaluates media queries.
3. Replays `slotchange` once in `firstUpdated()` when hydrating `@lit-labs/ssr` Declarative Shadow DOM.

```ts
import { css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import {
  LustrousElement,
  lustrousBase,
  lustrousFocusRing,
  lustrousStateLayer,
  lustrousType,
} from "@ghchinoy/lustrous-lit/theme";
import { renderIcon } from "@ghchinoy/lustrous-lit/components/lustrous-icon";

@customElement("quick-command-tile")
export class QuickCommandTile extends LustrousElement {
  static override styles = [
    lustrousBase,       // MUST be first: box-sizing, :host([hidden]), reduced-motion, icon rules
    lustrousFocusRing,  // .focus-ring -> 2.5px currentColor :focus-visible (Highlight in forced-colors)
    lustrousStateLayer, // .state-layer.state-layer (0,2,0 specificity survives `all: unset`!)
    css`
      .tile {
        all: unset;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: var(--lustrous-space-m);
        min-height: 44px;
        padding-block: var(--lustrous-space-m);
        padding-inline: var(--lustrous-space-l);
        border: 1px solid var(--lustrous-color-outline-variant);
        border-radius: var(--lustrous-radius-l);
        background-color: var(--lustrous-color-surface);
        color: var(--lustrous-color-on-surface);
        cursor: pointer;
        ${lustrousType("body-medium-emphasized")}
      }
    `,
  ];

  @property() label = "";

  protected override render() {
    return html`
      <button type="button" class="tile focus-ring state-layer">
        ${renderIcon("bolt", "s")}
        <span>${this.label}</span>
      </button>
    `;
  }
}
```

---

## 2. Strict CSP Compliance (Zero Inline `style=`)

Never emit `style="..."` or `style=${...}` inside Lit `html` templates — inline style attributes violate strict `Content-Security-Policy: style-src 'self'` without `'unsafe-inline'`.

When geometry depends on runtime numbers or DOM measurement, write a private `--_lustrous-*` property via CSSOM in `willUpdate()` or `updated()` (guarded with `if (this.style)` for SSR) and read it from static `css`:

```ts
protected override willUpdate(changed: PropertyValues): void {
  super.willUpdate(changed);
  if (changed.has("progress") && this.style) {
    this.style.setProperty("--_lustrous-fill", `${Math.min(100, Math.max(0, this.progress))}%`);
  }
}
```

---

## 3. Registering Custom Icons (`registerLustrousIcons`)

Register `0 0 24 24` stroke primitives once at startup and augment `LustrousCustomIconMap` for full TypeScript autocomplete across `<lustrous-icon>`, `renderIcon()`, `<lustrous-button icon="...">`, and menus:

```ts
import { svg } from "lit";
import { registerLustrousIcons } from "@ghchinoy/lustrous-lit/components/lustrous-icon";

declare module "@ghchinoy/lustrous-lit/components/lustrous-icon" {
  interface LustrousCustomIconMap {
    webhook: true;
    pipelineStep: true;
  }
}

registerLustrousIcons({
  webhook: {
    paths: svg`<circle cx="12" cy="6" r="3" /><circle cx="6" cy="17" r="3" /><circle cx="18" cy="17" r="3" /><path d="M10.5 8.5 7.5 14.5M13.5 8.5l3 6M9 17h6" />`,
  },
  pipelineStep: {
    directional: true, // Mirrors horizontally in dir="rtl"
    paths: svg`<rect x="3" y="7" width="11" height="10" rx="2" /><path d="M14 12h7m-3-3 3 3-3 3" />`,
  },
});
```

---

## 4. Non-Negotiable Engineering Rules

1. **Form Association (`ElementInternals`):** Set `static formAssociated = true`, guard `typeof this.attachInternals === "function"`, snapshot `defaultValue` / `defaultChecked` in `connectedCallback()`, implement `formDisabledCallback`, `formResetCallback`, and `formStateRestoreCallback`, sync `setFormValue` + `setValidity`, and emit composed `input` and `lustrous-change` (`LustrousChangeDetail`).
2. **Closed `[popover]` Display Reset:** Author `display: flex` or `display: grid` on a `[popover]` surface overrides the browser UA `display: none` rule! Always include `[popover]:not(:popover-open) { display: none; }`.
3. **Initialize `dismissedAt = -Infinity` (Never `0`):** Re-open suppression guards (`performance.now() - this.dismissedAt < 300`) drop clicks during the first `300ms` of page load in fast automated tests if initialized to `0`.
4. **Layered Overlay Event Guards:** `lustrous-toggle` and `lustrous-close-request` are `bubbles: true, composed: true`. Always check `if (e.target !== e.currentTarget) return;` on composite wrappers and gate `Escape` via `LustrousShortcutScopeController.canHandleEscape(event)`.
5. **`@lit-labs/ssr` Safety:** Never touch `window`, `document`, `ResizeObserver`, `IntersectionObserver`, `getComputedStyle()`, `showPopover()`, or `showModal()` in module scope, field initializers, `constructor()`, `willUpdate()`, or `render()`.
6. **High-Contrast (`forced-colors: active`) & RTL:** Add explicit `1px solid CanvasText` / `ButtonBorder` borders on elevated surfaces (shadows vanish in Windows High Contrast), pair `Highlight` / `HighlightText` with `GrayText` on custom indicators, use logical CSS properties (`padding-inline`, `inset-inline-end`), and reverse horizontal roving `ArrowLeft`/`ArrowRight` when `getComputedStyle(this).direction === "rtl"`.
