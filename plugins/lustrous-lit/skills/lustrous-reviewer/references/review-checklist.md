# Lustrous Audit & Code Review Checklist

Canonical rule definitions enforced by `scripts/audit-lustrous.mjs` and manual review passes.

---

## 1. Content Security Policy (`CSP-*`)

### `CSP-01` — No Inline `style=` Attributes (**FAIL**)
- **Why:** Inline `style="..."` or Lit `style=${...}` attributes require `'unsafe-inline'` in `style-src`, violating Lustrous's strict `style-src 'self'` guarantee.
- **Bad:**
  ```ts
  return html`<div class="bar" style="width: ${this.pct}%"></div>`;
  ```
- **Good:**
  ```ts
  // In willUpdate(): if (this.style) this.style.setProperty("--_lustrous-pct", `${this.pct}%`);
  // In static styles: .bar { width: var(--_lustrous-pct, 0%); }
  return html`<div class="bar"></div>`;
  ```

---

## 2. Design Token Hygiene (`TOK-*`)

### `TOK-01` — No Fallbacks on `--lustrous-*` Theme Tokens (**WARN**)
- **Why:** `LustrousElement` installs `lustrousTheme` automatically on connect. Writing `var(--lustrous-color-surface, #ffffff)` silently masks token typos and leaves stale light-mode colors in dark mode. *(Exceptions: private runtime `--_lustrous-*` geometry variables and documented component `@cssprop` hooks such as `--lustrous-tooltip-max-width`.)*
- **Bad:** `color: var(--lustrous-color-on-surface, #0f172a);`
- **Good:** `color: var(--lustrous-color-on-surface);`

### `TOK-02` — Unknown `--lustrous-*` Token Name (**FAIL**)
- **Why:** Referencing an unregistered `--lustrous-*` custom property (e.g. `--lustrous-color-muted` instead of `--lustrous-text-muted`, or `--lustrous-space-md` instead of `--lustrous-space-m`) resolves to `unset` at runtime.
- **Fix:** Check valid token names via `lookup-lustrous.mjs --tokens` or `assets/rules-data.json`.

### `TOK-03` — Raw Hex Color in Component Styles (**WARN**)
- **Why:** Hardcoded `#rrggbb` values bypass light/dark theme switching and WCAG 2.1 AA contrast calibration. Keep hex literals strictly inside unlayered `:root` / `[data-theme]` palette override files.

---

## 3. Icon Registry (`ICO-*`)

### `ICO-01` — Unregistered Icon Name (**WARN**)
- **Why:** Passing an unknown icon name to `icon="..."`, `leading-icon="..."`, `trailing-icon="..."`, `selected-icon="..."`, `off-icon="..."`, `<lustrous-icon name="...">`, or `renderIcon("...")` renders an empty SVG box unless registered via `registerLustrousIcons()`.
- **Common Corrections:** Use `"bolt"` (not `"lightning"`), `"delete"` (not `"trash"`), `"visibility"` (not `"eye"`), `"mail"` (not `"email"`), `"rocketLaunch"` (not `"rocket"`), `"filterList"` (not `"slidersHorizontal"`).

---

## 4. Accessibility (`A11Y-*`)

### `A11Y-01` — Icon Button Missing Accessible Name (**FAIL**)
- **Why:** `<lustrous-icon-button>` and `<lustrous-togglable-icon-button>` render no visible text label; omitting `aria-label` or `aria-labelledby` fails WCAG 2.1 SC 4.1.2 (Name, Role, Value).
- **Good:** `<lustrous-icon-button icon="close" aria-label="Close inspector"></lustrous-icon-button>`

### `A11Y-02` — Interactive Control Inside Non-Static `<lustrous-list-item>` (**WARN**)
- **Why:** Without `static`, `<lustrous-list-item>` renders an outer interactive `<button>` or `<a>`, creating invalid nested interactive controls when slotting `<lustrous-switch>`, `<lustrous-button>`, or `<lustrous-icon-button>` into `slot="end"`.
- **Good:** `<lustrous-list-item static icon="bell">Alerts <lustrous-switch slot="end" aria-label="Alerts"></lustrous-switch></lustrous-list-item>`

### `A11Y-03` — Touch Target, `forced-colors` & Logical CSS (**WARN**)
- Ensure custom interactive elements maintain `min-height: 44px` / `min-width: 44px`, include `@media (forced-colors: active)` `ButtonBorder` / `Highlight` rules, and use logical CSS (`padding-inline`, `inset-inline-end`, `text-align: start`).

---

## 5. Overlays & SSR (`OVR-*`, `SSR-*`)

### `OVR-01` — `dismissedAt = 0` Initialization (**FAIL**)
- **Why:** Suppresses trigger clicks during the first `300ms` after page load (`performance.now() < 300`). Always initialize `private dismissedAt = -Infinity`.

### `OVR-02` — Un-guarded Bubbling Overlay Events (**WARN**)
- **Why:** `lustrous-toggle` and `lustrous-close-request` bubble and compose across shadow roots. Composite listeners must start with `if (e.target !== e.currentTarget) return;`.

### `SSR-01` — Un-guarded `this.attachInternals()` (**FAIL**)
- **Why:** Calling `this.attachInternals()` directly in a class field or constructor throws in Node.js `@lit-labs/ssr` where `attachInternals` is absent unless shimmed.
- **Good:** `this.attachInternals?.() ?? null` (or guard with `typeof this.attachInternals === "function"`)
