# Using Lustrous Across Frameworks, CSP & SSR

Because `@ghchinoy/lustrous-lit` compiles to standard Custom Elements v1, Shadow DOM, and `ElementInternals`, its components work in plain HTML, modern frontend frameworks, server-rendered Go/Rust/Python backends, strict CSP environments, and `@lit-labs/ssr` pipelines.

---

## Package Entry Points

| Import Specifier | Purpose |
| :-- | :-- |
| `@ghchinoy/lustrous-lit` | Registers all `<lustrous-*>` custom elements and re-exports `@ghchinoy/lustrous-lit/theme` |
| `@ghchinoy/lustrous-lit/theme` | Side-effect-free tokens, theme helpers, localization, media controllers, shortcut controllers, and `LustrousElement` |
| `@ghchinoy/lustrous-lit/components/<tag>` | Registers a single component (e.g. `@ghchinoy/lustrous-lit/components/lustrous-button`) and exports its class/types/helpers |
| `@ghchinoy/lustrous-lit/theme.css` | Prebuilt `@layer lustrous` CSS custom properties and `.lustrous-*` typography stylesheet |
| `@ghchinoy/lustrous-lit/fonts.css` | `@font-face` declarations for bundled OFL-1.1 Google Sans Flex and Google Sans Code |
| `@ghchinoy/lustrous-lit/custom-elements.json` | Custom Elements Manifest for IDE autocomplete, Storybook, and wrapper generators |

---

## Framework Binding Quick Reference

### Lit 3
Bind arrays/objects with `.prop=${...}`, boolean attributes with `?attr=${...}`, and events with `@lustrous-change=${...}`.

### React 19 & `@lit/react`
React 19 natively sets custom element properties (`options`, `tabs`, `items`, `sections`) and binds `CustomEvent` listeners with `onlustrous-change`, `onlustrous-action`, and `onlustrous-toggle`:

```tsx
import { useState } from "react";
import "@ghchinoy/lustrous-lit/theme.css";
import "@ghchinoy/lustrous-lit/fonts.css";
import "@ghchinoy/lustrous-lit/components/lustrous-button";
import "@ghchinoy/lustrous-lit/components/lustrous-flex";
import "@ghchinoy/lustrous-lit/components/lustrous-select";
import type { LustrousChangeEvent } from "@ghchinoy/lustrous-lit/theme";

const ROLES = [
  { value: "viewer", label: "Viewer", description: "Read-only dashboard access" },
  { value: "editor", label: "Editor", description: "Deploy and manage services" },
];

export function RoleInviteForm() {
  const [role, setRole] = useState("viewer");
  return (
    <lustrous-flex direction="column" gap="m" padding="l">
      <lustrous-select
        label="Workspace role"
        value={role}
        options={ROLES}
        onlustrous-change={(e: LustrousChangeEvent) => setRole(e.detail.value ?? "viewer")}
      />
      <lustrous-button icon="bolt">Send Invite</lustrous-button>
    </lustrous-flex>
  );
}
```

For React 18 or typed PascalCase props, wrap element classes with `createComponent` from `@lit/react`.

### Vue 3
Configure `compilerOptions.isCustomElement: (tag) => tag.startsWith("lustrous-")` in `@vitejs/plugin-vue`, bind object/array properties with `:tabs.prop="tabs"`, and listen with `@lustrous-change="onTabChange"`.

### Angular
Add `CUSTOM_ELEMENTS_SCHEMA` to standalone components and bind `[checked]="enabled()"` and `(lustrous-change)="onToggle($event)"`. Native `<form>` submission works automatically via `ElementInternals`.

### Svelte 5
Svelte 5 assigns custom element properties directly (`<lustrous-menu {items} onlustrous-select={(e) => ...}>`).

### Embedded Go, Rust & Python Servers
Bundle `@ghchinoy/lustrous-lit`, `theme.css`, and `fonts.css` into `web/static/` with Vite or esbuild and embed into `embed.FS` (Go), `include_dir!` (Rust/Axum), or `StaticFiles` (FastAPI). All icons are inline SVGs and fonts are self-hosted WOFF2, so air-gapped single-binary servers make zero external network requests.

---

## Content Security Policy (CSP)

Lustrous never emits inline `style=""` attributes in component shadow templates and adopts constructable stylesheets via `adoptedStyleSheets`:

```http
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data: https:;
```

*(Prefer `<link rel="stylesheet" href=".../lustrous-fonts.css">` over `installLustrousFonts()` under strict `style-src 'self'` without nonces.)*

---

## Server-Side Rendering (`@lit-labs/ssr`) & Hydration

1. **Server (`Node.js`):** Import `@lit-labs/ssr/lib/install-global-dom-shim.js`, `render` from `@lit-labs/ssr`, and `collectResultSync` from `@lit-labs/ssr/lib/render-result.js`.
2. **HTML `<head>`:** Link `@ghchinoy/lustrous-lit/theme.css` and `fonts.css` up front so Declarative Shadow DOM paints with full tokens before scripts execute.
3. **Client entry order:** Import `@lit-labs/ssr-client/lit-element-hydrate-support.js` **before** importing `lit` or any `@ghchinoy/lustrous-lit` module:
   ```ts
   import "@lit-labs/ssr-client/lit-element-hydrate-support.js";
   import "@ghchinoy/lustrous-lit/components/lustrous-flex";
   import "@ghchinoy/lustrous-lit/components/lustrous-button";
   ```
