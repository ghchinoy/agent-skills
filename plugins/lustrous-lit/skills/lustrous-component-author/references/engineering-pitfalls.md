# Web Components Engineering Pitfalls & Recipes

Deep-dive patterns for authoring custom elements on `@ghchinoy/lustrous-lit`.

---

## 1. Form-Associated Custom Elements (`ElementInternals`)

Value-bearing controls must participate natively in `<form>`, `new FormData(form)`, constraint validation (`required`, `:invalid`), `<fieldset disabled>`, and `form.reset()`:

- Guard `typeof this.attachInternals === "function"` in class field initialization so Node.js `@lit-labs/ssr` never throws.
- Set `delegatesFocus: true` in `shadowRootOptions` so clicking `<label>` or calling `element.focus()` focuses the inner interactive control and validation popups anchor accurately.
- Capture `defaultValue` (via `this.getAttribute("value") ?? this.value`) or `defaultChecked` (`this.hasAttribute("checked")`) inside `connectedCallback()` so `form.reset()` restores initial markup state.
- Call `this.internals?.setFormValue(...)` and `this.internals?.setValidity(...)` in `willUpdate()` whenever `value`, `checked`, or `required` changes.
- Dispatch composed `input` on live edits, `change` on commit, and `lustrous-change` (`{ bubbles: true, composed: true, detail }`).

---

## 2. Top-Layer `[popover]` & `<dialog>` Pitfalls

### A. Explicit Closed-Popover `display: none`
Setting `display: flex` or `display: grid` on an element carrying `[popover]` overrides the browser UA stylesheet's `[popover]:not(:popover-open) { display: none }` rule, causing closed popovers to paint inline and intercept pointer hit-testing! Always include:

```css
[popover] {
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
}

[popover]:not(:popover-open) {
  display: none !important;
}
```

### B. `private dismissedAt = -Infinity`
Click-triggered popovers, menus, and selects ignore re-open clicks within `300ms` of light-dismiss (`performance.now() - this.dismissedAt < 300`) so clicking the trigger to dismiss doesn't immediately re-open the surface. Initializing `dismissedAt = 0` drops clicks during the first `300ms` after page load when `performance.now() < 300`. Always initialize `private dismissedAt = -Infinity`.

### C. Modal Popover Sibling `inert` + `aria-hidden` Lock
Unlike `<dialog>.showModal()`, the Popover API does not make background content inert. When a popover runs in modal mode:
1. Snapshot each outside `document.body` child's existing `inert` boolean and `getAttribute("aria-hidden")` before setting `sibling.inert = true` and `sibling.setAttribute("aria-hidden", "true")`.
2. Restore the exact prior values in both `releaseModalLock()` and `disconnectedCallback()` so removing an open overlay never leaves the document permanently inert.

### D. Layered Close & Toggle Guards
Because `lustrous-toggle` and `lustrous-close-request` bubble across shadow boundaries (`bubbles: true, composed: true`), any component wrapping an inner `<lustrous-modal>`, `<lustrous-bottom-sheet>`, `<lustrous-popover>`, or `<lustrous-menu>` **must** guard listeners:

```ts
private onInnerCloseRequest(e: CustomEvent) {
  if (e.target !== e.currentTarget) return;
  this.open = false;
}
```

Coordinate `Escape` dismissal with `LustrousShortcutScopeController` (`data-lustrous-shortcut-scope=""` + `this.shortcutScope.canHandleEscape(event)`) so nested menus dismiss before their enclosing dialog.

---

## 3. `@lit-labs/ssr` & Declarative Shadow DOM Hydration

- **Forbidden during `constructor()`, field initializers, `willUpdate()`, and `render()`:** `window`, `document`, `HTMLElement.prototype`, `ResizeObserver`, `IntersectionObserver`, `getComputedStyle()`, `showPopover()`, `hidePopover()`, `showModal()`, `close()`.
- **Safe guards:** `typeof this.attachInternals === "function"`, `"matchMedia" in globalThis`, `globalThis.matchMedia?.(...)`, and `if (this.style)`.
- Perform DOM measurements, observer registration, and imperative `.showModal()` / `.showPopover()` calls strictly inside `firstUpdated()`, `updated()`, and `disconnectedCallback()`.

---

## 4. `forced-colors`, `prefers-reduced-motion` & RTL Verification

- **`@media (forced-colors: active)`:**
  - `box-shadow` and `filter: drop-shadow(...)` are stripped in Windows High Contrast mode. Give elevated cards, popovers, dialogs, and snackbars an explicit `1px solid CanvasText` or `1px solid ButtonBorder` border.
  - Custom state indicators (switch thumbs, radio dots, active segment pills, progress fills) must set `forced-color-adjust: none` on the indicator element only and pair `Highlight` / `HighlightText` with `GrayText` when `:host([disabled])`.
- **`@media (prefers-reduced-motion: reduce)`:**
  - Put `lustrousBase` first in `static override styles` so transitions/animations collapse to `0.01ms`.
  - Check `globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches` before calling `scrollTo({ behavior: "smooth" })` or starting spring timers.
- **Logical CSS & BiDi (`dir="rtl"`):**
  - Use logical properties (`padding-inline`, `margin-inline-start`, `inset-inline-end`, `border-start-start-radius`, `text-align: start`).
  - In horizontal roving `tabindex` groups (`tablist`, `radiogroup`, segmented controls, action bars), invert `ArrowLeft` / `ArrowRight` when `getComputedStyle(this).direction === "rtl"`.
  - Wrap technical tokens or keyboard hints inside multilingual text with `isolateBidi()` from `@ghchinoy/lustrous-lit/theme`.
