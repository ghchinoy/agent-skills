import { css, html, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import {
  LustrousElement,
  lustrousBase,
  lustrousFocusRing,
  lustrousStateLayer,
  lustrousType,
} from "@ghchinoy/lustrous-lit/theme";
import { renderIcon, type LustrousIconName } from "@ghchinoy/lustrous-lit/components/lustrous-icon";

@customElement("lustrous-metric-tile")
export class LustrousMetricTile extends LustrousElement {
  static override styles = [
    lustrousBase,
    lustrousFocusRing,
    lustrousStateLayer,
    css`
      :host {
        display: block;
      }

      .card {
        all: unset;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: var(--lustrous-space-s);
        width: 100%;
        min-height: 44px;
        padding-block: var(--lustrous-space-l);
        padding-inline: var(--lustrous-space-xl);
        border: 1px solid var(--lustrous-color-outline-variant);
        border-radius: var(--lustrous-radius-xl);
        background-color: var(--lustrous-color-surface-bright);
        box-shadow: var(--lustrous-elevation-level1);
        color: var(--lustrous-color-on-surface);
        cursor: pointer;
        text-align: start;
      }

      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--lustrous-space-s);
        color: var(--lustrous-text-muted);
        ${lustrousType("caption")}
      }

      .value {
        ${lustrousType("headline-medium")}
      }

      .meter {
        height: 6px;
        border-radius: var(--lustrous-radius-full);
        background-color: var(--lustrous-color-surface-container-high);
        overflow: hidden;
      }

      .fill {
        height: 100%;
        width: var(--_lustrous-utilization, 0%);
        border-radius: inherit;
        background-color: var(--lustrous-color-accent);
        transition: width var(--lustrous-motion-fast-spatial);
      }

      @media (forced-colors: active) {
        .card {
          border-color: ButtonBorder;
        }
        .fill {
          forced-color-adjust: none;
          background-color: Highlight;
        }
      }
    `,
  ];

  @property() label = "";
  @property() metric = "";
  @property({ reflect: true }) icon: LustrousIconName = "activity";
  @property({ type: Number }) utilization = 0;

  protected override willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    if (changed.has("utilization") && this.style) {
      const clamped = Math.min(100, Math.max(0, this.utilization));
      this.style.setProperty("--_lustrous-utilization", `${clamped}%`);
    }
  }

  protected override render() {
    return html`
      <button type="button" part="card" class="card focus-ring state-layer">
        <span class="header">
          <span>${this.label}</span>
          ${renderIcon(this.icon, "xs")}
        </span>
        <span class="value">${this.metric}</span>
        <span class="meter" aria-hidden="true"><span class="fill"></span></span>
      </button>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "lustrous-metric-tile": LustrousMetricTile;
  }
}
