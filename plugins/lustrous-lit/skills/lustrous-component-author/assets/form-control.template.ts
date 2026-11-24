import { css, html, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import {
  LustrousElement,
  lustrousBase,
  lustrousFocusRing,
  lustrousType,
  type LustrousChangeDetail,
} from "@ghchinoy/lustrous-lit/theme";

@customElement("lustrous-token-field")
export class LustrousTokenField extends LustrousElement {
  static formAssociated = true;
  static override shadowRootOptions: ShadowRootInit = {
    ...LustrousElement.shadowRootOptions,
    delegatesFocus: true,
  };

  static override styles = [
    lustrousBase,
    lustrousFocusRing,
    css`
      :host {
        display: block;
      }

      .wrapper {
        display: flex;
        flex-direction: column;
        gap: var(--lustrous-space-xs);
      }

      label {
        color: var(--lustrous-color-on-surface);
        ${lustrousType("body-small-emphasized")}
      }

      input {
        box-sizing: border-box;
        min-height: 44px;
        padding-block: var(--lustrous-space-s);
        padding-inline: var(--lustrous-space-m);
        border: 1px solid var(--lustrous-color-outline);
        border-radius: var(--lustrous-radius-m);
        background-color: var(--lustrous-color-surface);
        color: var(--lustrous-color-on-surface);
        ${lustrousType("code")}
      }

      :host([disabled]) input {
        background-color: var(--lustrous-color-state-disabled);
        color: var(--lustrous-color-state-disabled-label);
        cursor: not-allowed;
      }

      @media (forced-colors: active) {
        input {
          border-color: ButtonBorder;
        }
        :host([disabled]) input {
          border-color: GrayText;
          color: GrayText;
        }
      }
    `,
  ];

  @property({ reflect: true }) name = "";
  @property() label = "";
  @property() value = "";
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: Boolean, reflect: true }) required = false;

  private defaultValue = "";
  protected readonly internals: ElementInternals | undefined =
    typeof this.attachInternals === "function" ? this.attachInternals() : undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    this.defaultValue = this.getAttribute("value") ?? this.value;
    this.syncFormState();
  }

  protected override willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    if (changed.has("value") || changed.has("required")) {
      this.syncFormState();
    }
  }

  formDisabledCallback(disabled: boolean): void {
    this.disabled = disabled;
  }

  formResetCallback(): void {
    this.value = this.defaultValue;
    this.syncFormState();
  }

  formStateRestoreCallback(state: string | File | FormData | null): void {
    if (typeof state === "string") {
      this.value = state;
      this.syncFormState();
    }
  }

  private syncFormState(): void {
    this.internals?.setFormValue(this.value);
    const input = this.renderRoot?.querySelector("input") ?? undefined;
    if (this.required && !this.value) {
      this.internals?.setValidity({ valueMissing: true }, "Please fill out this field.", input);
    } else {
      this.internals?.setValidity({});
    }
  }

  private onInput(e: Event): void {
    this.value = (e.currentTarget as HTMLInputElement).value;
    this.syncFormState();
    this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  }

  private onChange(): void {
    this.dispatchEvent(new Event("change", { bubbles: true }));
    this.dispatchEvent(
      new CustomEvent<LustrousChangeDetail>("lustrous-change", {
        bubbles: true,
        composed: true,
        detail: { value: this.value },
      }),
    );
  }

  protected override render() {
    return html`
      <div class="wrapper">
        <label for="control">${this.label}</label>
        <input
          id="control"
          part="input"
          class="focus-ring"
          .value=${this.value}
          ?disabled=${this.disabled}
          ?required=${this.required}
          @input=${this.onInput}
          @change=${this.onChange}
        />
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "lustrous-token-field": LustrousTokenField;
  }
}
