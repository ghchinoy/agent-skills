# Recommended Companion Plugins

The Lustrous Design System plugin (`plugins/lustrous-lit`) owns **component composition, `--lustrous-*` tokens, `ElementInternals` forms, top-layer overlays, CSP hygiene, and WCAG 2.1 AA audits**. Pair it with web-platform and browser-inspection companion plugins to cover Core Web Vitals, progressive CSS/HTML capabilities outside the component catalog, and live browser verification.

---

## 1. Modern Web Guidance (`GoogleChrome/modern-web-guidance`)

**[Modern Web Guidance](https://developer.chrome.com/docs/modern-web-guidance)** ([GitHub](https://github.com/GoogleChrome/modern-web-guidance)) is Chrome's expert-vetted skill suite (200+ guides authored with Mozilla and Microsoft) that embeds web platform best practices and live Baseline compatibility checks into AI coding agents.

### Why It Pairs Well with Lustrous

- **Aligned Baseline Target (`Baseline 2024`):** Lustrous's browser floor (Chrome/Edge 114+, Safari 17+, Firefox 125+) matches **Baseline 2024** (when the Popover API reached Baseline Newly Available). Declaring `Baseline 2024` in your project instructions unlocks modern features while prompting Modern Web Guidance to add progressive-enhancement `@supports` fallbacks for newer capabilities (such as CSS Scroll-Driven Animations, Anchor Positioning, or `field-sizing: content`).
- **Covers Platform Capabilities Beyond the Component Catalog:**
  - **Core Web Vitals & Performance:** `fetchpriority="high"` on LCP images, `content-visibility: auto` on off-screen sections, `scheduler.yield` for INP long-task splitting, `scrollend`, and speculation rules.
  - **Progressive Motion & Scroll Behaviors:** CSS Scroll-Driven Animations (`animation-timeline: scroll()`), Same-Document and Cross-Document View Transitions, `@starting-style` / `transition-behavior`, and `hidden="until-found"` searchable disclosures.
  - **Platform & Form Flows:** Autofill `autocomplete` attributes for sign-in, sign-up, address, and payment flows; IME-safe Enter handling; Passkeys / WebAuthn; `Temporal` date/time APIs; responsive data tables; and CSP hardening.
  - **Web Components Fundamentals:** Dedicated `html/web-components`, `custom-elements`, `shadow-dom`, `styling-web-components`, `form-associated-custom-elements`, `accessible-web-components`, and `prerendering-custom-elements` guides that reinforce `lustrous-component-author`.

### Installation

```bash
# Recommended CLI (supports automatic guide updates)
npx modern-web-guidance@latest install

# Or via Vercel Agent Skills (`npx skills`)
npx skills add GoogleChrome/modern-web-guidance

# Claude Code
claude plugin marketplace add GoogleChrome/modern-web-guidance
claude plugin install modern-web-guidance@googlechrome

# Antigravity CLI
agy plugin install https://github.com/GoogleChrome/modern-web-guidance
```

### Precedence Hierarchy (Preventing Design-System Drift)

Modern Web Guidance encourages native HTML controls across all web tasks. When both plugins are installed in a Lustrous codebase, add this snippet to your repository `AGENTS.md` or `CLAUDE.md` so agents preserve design-system consistency while adopting modern platform capabilities:

```markdown
This project's Baseline target is Baseline 2024.

## Lustrous Design System and Modern Web Guidance

When building UI, follow this order of precedence:

1. **Prioritize `@ghchinoy/lustrous-lit` components and tokens:** For UI patterns covered by Lustrous (dialogs, popovers, tooltips, menus, buttons, switches, selects, radio groups, text inputs, tabs, sidebars, toasts), use the `<lustrous-*>` component. Do not replace an existing Lustrous component with a raw native element (such as `<dialog>`, `<select>`, or `<input type="checkbox" switch>`) because Modern Web Guidance recommends it.
2. **Use Modern Web Guidance where Lustrous ends:** Consult `modern-web-guidance` for platform concerns outside the component library, including Core Web Vitals (`fetchpriority`, `content-visibility`, `scheduler.yield`), CSS Scroll-Driven Animations, View Transitions, responsive data tables, autofill `autocomplete` patterns, Passkeys/WebAuthn, `Temporal`, and Web Components fundamentals.
3. **Adapt Modern Web Guidance patterns through Lustrous constraints:** Pass native attributes (`autocomplete`, `type`, `loading`, `inputmode`) through Lustrous component props, express colors/spacing/radii with `--lustrous-*` tokens (never raw hex literals or `var()` fallbacks), and write dynamic values via CSSOM (`this.style?.setProperty("--_lustrous-*", ...)`) rather than inline `style=""` attributes so `lustrous-reviewer` (`CSP-01`, `TOK-01`..`TOK-03`, `SSR-01`) stays green.
```

---

## 2. Chrome DevTools for Agents (Live Verification)

Pair both plugins with **[Chrome DevTools for agents](https://developer.chrome.com/docs/devtools/agents)** (MCP or CLI) when you want your coding agent to verify rendered Shadow DOM, computed `--lustrous-*` tokens, Lighthouse / Core Web Vitals metrics, and live light/dark/forced-colors layout in a real browser session.
