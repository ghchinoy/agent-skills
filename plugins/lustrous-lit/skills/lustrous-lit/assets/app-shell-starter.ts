import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  LustrousElement,
  LustrousShortcutController,
  LustrousViewportController,
} from "@ghchinoy/lustrous-lit/theme";
import "@ghchinoy/lustrous-lit/components/lustrous-box";
import "@ghchinoy/lustrous-lit/components/lustrous-flex";
import "@ghchinoy/lustrous-lit/components/lustrous-icon-button";
import "@ghchinoy/lustrous-lit/components/lustrous-side-panel";
import "@ghchinoy/lustrous-lit/components/lustrous-sidebar";
import "@ghchinoy/lustrous-lit/components/lustrous-text";

@customElement("app-workspace-shell")
export class AppWorkspaceShell extends LustrousElement {
  private readonly viewport = new LustrousViewportController(this);

  @state() private drawerOpen = false;
  @state() private inspectorOpen = true;

  protected readonly toggleInspector = new LustrousShortcutController(this, {
    id: "shell.inspector",
    keys: "Mod+I",
    onTrigger: () => {
      this.inspectorOpen = !this.inspectorOpen;
    },
  });

  protected override render() {
    return html`
      <lustrous-flex height="viewport" overflow="hidden" background="surface-background">
        ${this.viewport.isShellMobile
          ? html`
              <lustrous-sidebar-drawer
                .open=${this.drawerOpen}
                @lustrous-toggle=${(e: CustomEvent<{ open: boolean }>) => {
                  if (e.target !== e.currentTarget) return;
                  this.drawerOpen = e.detail.open;
                }}
              >
                ${this.renderSidebar()}
              </lustrous-sidebar-drawer>
            `
          : this.renderSidebar()}

        <lustrous-flex-item grow="1" min-width="0">
          <lustrous-flex direction="column" height="full">
            <lustrous-flex
              align="center"
              justify="space-between"
              gap="m"
              padding-block="s"
              padding-inline="l"
              border-bottom
              background="surface"
            >
              <lustrous-flex align="center" gap="s">
                ${this.viewport.isShellMobile
                  ? html`
                      <lustrous-icon-button
                        icon="menu"
                        aria-label="Open navigation"
                        @click=${() => (this.drawerOpen = true)}
                      ></lustrous-icon-button>
                    `
                  : null}
                <lustrous-text variant="headline-small" heading="1">Workspace</lustrous-text>
              </lustrous-flex>
              <lustrous-icon-button
                icon="sideNav"
                aria-label="Toggle inspector"
                ?expanded=${this.inspectorOpen}
                @click=${() => (this.inspectorOpen = !this.inspectorOpen)}
              ></lustrous-icon-button>
            </lustrous-flex>

            <lustrous-box padding="2xl" mobile-padding="l" overflow="auto">
              <slot></slot>
            </lustrous-box>
          </lustrous-flex>
        </lustrous-flex-item>

        <lustrous-side-panel
          ?open=${this.inspectorOpen}
          label="Inspector"
          presentation=${this.viewport.isShellMobile ? "takeover" : "split"}
          @lustrous-close-request=${(e: Event) => {
            if (e.target !== e.currentTarget) return;
            this.inspectorOpen = false;
          }}
        >
          <slot name="inspector"></slot>
        </lustrous-side-panel>
      </lustrous-flex>
    `;
  }

  private renderSidebar() {
    return html`
      <lustrous-sidebar>
        <lustrous-sidebar-header>
          <lustrous-text variant="body-medium-emphasized">Lustrous Studio</lustrous-text>
        </lustrous-sidebar-header>
        <lustrous-sidebar-scroll-area>
          <lustrous-sidebar-nav label="Primary">
            <lustrous-sidebar-section heading="Operations">
              <lustrous-sidebar-item icon="activity" active>Overview</lustrous-sidebar-item>
              <lustrous-sidebar-item icon="rocketLaunch">Deployments</lustrous-sidebar-item>
              <lustrous-sidebar-item icon="settings">Settings</lustrous-sidebar-item>
            </lustrous-sidebar-section>
          </lustrous-sidebar-nav>
        </lustrous-sidebar-scroll-area>
      </lustrous-sidebar>
    `;
  }
}
