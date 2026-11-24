# Component API Catalog

Generated from `custom-elements.json` for `@ghchinoy/lustrous-lit@0.2.0` (68 custom elements).

| Tag | Module Import | Form | Own Attributes / Properties | Events | CSS Parts |
| :-- | :-- | :-- | :-- | :-- | :-- |
| `<lustrous-action-bar>` | `.../components/lustrous-action-bar` | — | `variant`, `label` | — | — |
| `<lustrous-badge>` | `.../components/lustrous-badge` | — | `tone`, `icon` | — | `badge` |
| `<lustrous-badge-indicator>` | `.../components/lustrous-badge-indicator` | — | `aria-label` | — | `dot` |
| `<lustrous-banner>` | `.../components/lustrous-banner` | — | `heading`, `heading-level`, `description`, `icon`, `image-url`, `image-size`, `image-alt`, `image-border-radius`, `badge`, `media-placement`, `variant`, `layout`, `primary-action`, `secondary-action`, `clickable`, `dismissible`, `close-label` | `lustrous-action`, `lustrous-click`, `lustrous-close-request` | `banner`, `surface` |
| `<lustrous-bottom-sheet>` | `.../components/lustrous-bottom-sheet` | — | `expanded`, `default-snap-point`, `scrollable`, `body-scrim` | — | `sheet`, `handle`, `header`, `body`, `footer` |
| `<lustrous-box>` | `.../components/lustrous-box` | — | `padding`, `padding-block`, `padding-inline`, `padding-top`, `padding-bottom`, `padding-start`, `padding-end`, `mobile-padding`, `mobile-padding-block`, `mobile-padding-inline`, `margin`, `margin-block`, `margin-inline`, `margin-top`, `margin-bottom`, `margin-start`, `margin-end`, `display`, `mobile-display`, `position`, `background`, `border`, `border-block`, `border-inline`, `border-top`, `border-bottom`, `border-start`, `border-end`, `border-radius`, `shadow`, `cursor`, `overflow`, `overflow-x`, `overflow-y`, `z-index`, `text-align`, `white-space`, `overflow-wrap`, `width`, `mobile-width`, `height`, `min-width`, `min-height`, `max-width`, `max-height`, `top`, `bottom`, `left`, `right`, `start`, `end`, `inset`, `animate`, `transition`, `hidden-on`, `shown-on` | — | — |
| `<lustrous-button>` | `.../components/lustrous-button` | Yes | `variant`, `size`, `shape`, `icon`, `trailing-icon`, `collapsed-direction`, `muted` | — | `button` |
| `<lustrous-checkbox>` | `.../components/lustrous-checkbox` | Yes | `indeterminate` | — | `box`, `label` |
| `<lustrous-chevron-icon>` | `.../components/lustrous-chevron-icon` | — | `expanded`, `direction`, `size`, `tone`, `muted`, `label` | — | — |
| `<lustrous-code-block>` | `.../components/lustrous-code-block` | — | `label`, `code`, `wrap`, `no-copy`, `copy-label`, `.text` | `lustrous-copy` | `surface`, `header`, `copy-button`, `pre` |
| `<lustrous-collapsible-card>` | `.../components/lustrous-collapsible-card` | — | `heading`, `heading-level`, `subtitle`, `icon`, `badge`, `badge-tone`, `storage-key`, `open` | `lustrous-toggle` | `card`, `header`, `toggle`, `badge`, `body` |
| `<lustrous-collapsible-container>` | `.../components/lustrous-collapsible-container` | — | `expanded`, `inline-bleed`, `.open` | `lustrous-toggle` | `content` |
| `<lustrous-dialog>` | `.../components/lustrous-dialog` | — | `heading`, `label`, `size`, `primary-action`, `secondary-action`, `primary-disabled`, `secondary-disabled`, `dismissible`, `close-label`, `close-disabled`, `.onClose`, `modal`, `mobile-drawer`, `scrim-blur`, `focus-heading`, `.returnFocus`, `.initialFocus`, `open`, `.headingElement` | `lustrous-toggle`, `lustrous-action`, `lustrous-close-request` | `card`, `scroller`, `heading`, `close-button`, `body`, `actions` |
| `<lustrous-flex>` | `.../components/lustrous-flex` | — | `direction`, `mobile-direction`, `align`, `mobile-align`, `justify`, `mobile-justify`, `wrap`, `gap`, `mobile-gap`, `row-gap`, `column-gap`, `inline` | — | — |
| `<lustrous-flex-item>` | `.../components/lustrous-flex` | — | `grow`, `shrink`, `basis`, `align-self`, `order` | — | — |
| `<lustrous-grid>` | `.../components/lustrous-grid` | — | `columns`, `mobile-columns`, `rows`, `gap`, `mobile-gap`, `row-gap`, `column-gap`, `align`, `mobile-align`, `justify`, `auto-flow`, `inline` | — | — |
| `<lustrous-grid-item>` | `.../components/lustrous-grid` | — | `col-span`, `row-span`, `col`, `row` | — | — |
| `<lustrous-icon>` | `.../components/lustrous-icon` | — | `name`, `tone`, `muted`, `size`, `label` | — | — |
| `<lustrous-icon-button>` | `.../components/lustrous-icon-button` | Yes | `icon`, `collapsed-direction`, `variant`, `size`, `muted`, `badge` | — | `button`, `badge` |
| `<lustrous-image>` | `.../components/lustrous-image` | — | `src`, `alt`, `decorative`, `object-fit`, `aspect-ratio`, `loading`, `decoding`, `referrerpolicy`, `draggable`, `srcset`, `sizes` | `load`, `error` | `img` |
| `<lustrous-kbd>` | `.../components/lustrous-kbd` | — | `keys`, `size` | — | `group`, `key` |
| `<lustrous-keyboard-shortcuts-modal>` | `.../components/lustrous-keyboard-shortcuts-modal` | — | `open`, `heading`, `size`, `dismissible`, `close-label`, `.sections`, `.returnFocus`, `.initialFocus` | `lustrous-toggle`, `lustrous-close-request`, `lustrous-action` | `dialog`, `sections`, `section`, `section-title`, `row` |
| `<lustrous-link>` | `.../components/lustrous-link` | — | `href`, `target`, `rel`, `download`, `variant`, `underline`, `disabled`, `external` | — | `link`, `external-icon` |
| `<lustrous-list>` | `.../components/lustrous-list` | — | `label` | — | — |
| `<lustrous-list-item>` | `.../components/lustrous-list` | — | `label`, `description`, `start-icon`, `end-icon`, `selected`, `disabled`, `static`, `href`, `target`, `rel` | — | `row` |
| `<lustrous-menu>` | `.../components/lustrous-menu` | — | `.items`, `open`, `side`, `align`, `offset`, `max-height`, `width`, `.anchor`, `.returnFocus`, `label`, `open-on-hover`, `hover-open-delay`, `hover-close-delay` | `lustrous-select`, `lustrous-toggle` | `menu`, `item` |
| `<lustrous-modal>` | `.../components/lustrous-modal` | — | `open`, `label`, `padding`, `scrim`, `scrim-blur`, `.returnFocus`, `.initialFocus` | `lustrous-toggle`, `lustrous-close-request` | `dialog`, `viewport` |
| `<lustrous-photo-lightbox>` | `.../components/lustrous-photo-lightbox` | — | `src`, `ambient-src`, `loading` | `error` | `stage`, `actions` |
| `<lustrous-popover>` | `.../components/lustrous-popover` | — | `open`, `arrow`, `heading`, `content`, `label`, `side`, `align`, `offset`, `align-offset`, `size`, `padding`, `max-height`, `elevation`, `primary-action`, `secondary-action`, `open-on-hover`, `delay`, `close-delay`, `close-label`, `mobile-drawer`, `disabled`, `.anchor` | `lustrous-toggle`, `lustrous-action` | `panel`, `close-button`, `actions` |
| `<lustrous-pressable>` | `.../components/lustrous-pressable` | — | `disabled`, `selected`, `focusable`, `href`, `target`, `rel`, `download` | — | `inner` |
| `<lustrous-progress-bar>` | `.../components/lustrous-progress-bar` | — | `value`, `label`, `tone`, `decorative`, `.clampedValue` | — | `track`, `fill` |
| `<lustrous-prose-direction-scope>` | `.../components/lustrous-prose-text` | — | `align-start`, `align-with-parent`, `fallback-dir`, `.hasConnected`, `.estimatedDir`, `.effectiveFallback`, `.resolvedDir`, `.effectiveDir`, `.childAlignedDir` | — | — |
| `<lustrous-prose-text>` | `.../components/lustrous-prose-text` | — | `language`, `fallback-dir`, `inline-isolate`, `.hasConnected`, `.effectiveFallback`, `.resolvedDir`, `.shouldInlineIsolate` | — | `bdi` |
| `<lustrous-radio>` | `.../components/lustrous-radio-group` | — | `value`, `checked`, `disabled`, `supporting-text`, `.isDisabled` | `lustrous-radio-select`, `change`, `lustrous-change`, `lustrous-radio-sync` | `button`, `ring`, `dot`, `label` |
| `<lustrous-radio-group>` | `.../components/lustrous-radio-group` | Yes | `label`, `name`, `value`, `orientation`, `required`, `disabled`, `error`, `supporting-text`, `.form`, `.validity`, `.validationMessage` | `input`, `change`, `lustrous-change` | `radiogroup`, `label`, `items`, `supporting` |
| `<lustrous-scrollable-box>` | `.../components/lustrous-scrollable-box` | — | `scrim`, `scrim-size`, `scrollbar`, `compact`, `label`, `.scrollElement` | `scroll` | `viewport`, `content` |
| `<lustrous-search-bar>` | `.../components/lustrous-search-bar` | Yes | `value`, `placeholder`, `icon`, `variant`, `size`, `show-clear`, `clear-label`, `disabled`, `name`, `.form` | `lustrous-search`, `input`, `lustrous-clear` | `surface`, `input`, `clear` |
| `<lustrous-segmented-control>` | `.../components/lustrous-segmented-control` | — | `.options`, `value`, `label`, `variant`, `size` | `lustrous-change` | `track`, `indicator`, `segment`, `segment-selected` |
| `<lustrous-segmented-list>` | `.../components/lustrous-segmented-list` | — | `border-radius`, `divider`, `as`, `gap`, `label` | — | — |
| `<lustrous-segmented-list-button>` | `.../components/lustrous-segmented-list` | — | *(inherited)* | — | — |
| `<lustrous-segmented-list-item>` | `.../components/lustrous-segmented-list` | — | *(inherited)* | — | `row`, `body`, `action` |
| `<lustrous-segmented-list-link>` | `.../components/lustrous-segmented-list` | — | *(inherited)* | — | — |
| `<lustrous-select>` | `.../components/lustrous-select` | Yes | `label`, `caption`, `placeholder`, `value`, `name`, `required`, `disabled`, `error`, `supporting-text`, `validation-state`, `size`, `border-radius`, `open`, `.options`, `.form`, `.validity`, `.validationMessage` | `input`, `change`, `lustrous-change` | `header`, `label`, `caption`, `field`, `value`, `listbox`, `option`, `supporting` |
| `<lustrous-side-panel>` | `.../components/lustrous-side-panel` | — | `open`, `presentation`, `focus-on-open`, `side`, `label`, `announcement`, `.returnFocus`, `border`, `shadow`, `margin`, `scrollable`, `scrim` | `lustrous-close-request` | `aside`, `card`, `body` |
| `<lustrous-sidebar>` | `.../components/lustrous-sidebar` | — | `collapsed`, `density`, `surface-tone`, `width`, `collapsed-width`, `label` | `lustrous-change` | — |
| `<lustrous-sidebar-drawer>` | `.../components/lustrous-sidebar` | — | *(inherited)* | — | `panel` |
| `<lustrous-sidebar-footer>` | `.../components/lustrous-sidebar` | — | *(inherited)* | — | — |
| `<lustrous-sidebar-header>` | `.../components/lustrous-sidebar` | — | `label`, `logo-href`, `dismiss-variant`, `collapse-label`, `expand-label` | — | `brand`, `actions` |
| `<lustrous-sidebar-item>` | `.../components/lustrous-sidebar` | — | `label`, `icon`, `active`, `disabled`, `pending`, `pinned`, `pinned-label`, `badge`, `badge-label`, `pill-badge`, `editing`, `default-edit-value`, `max-edit-length`, `edit-input-label`, `items-open-on-hover`, `meta`, `href`, `target`, `.items`, `.actions`, `actions-label` | — | `row`, `glimmer` |
| `<lustrous-sidebar-message>` | `.../components/lustrous-sidebar` | — | `icon`, `heading`, `description`, `announcement` | — | `icon`, `text` |
| `<lustrous-sidebar-nav>` | `.../components/lustrous-sidebar` | — | `label` | — | — |
| `<lustrous-sidebar-scroll-area>` | `.../components/lustrous-sidebar` | — | *(inherited)* | — | — |
| `<lustrous-sidebar-section>` | `.../components/lustrous-sidebar` | — | `heading`, `collapsible`, `expanded`, `toggle-label` | `lustrous-toggle` | `toggle`, `body` |
| `<lustrous-skeleton>` | `.../components/lustrous-skeleton` | — | `width`, `height`, `shape`, `border-radius` | — | — |
| `<lustrous-snackbar>` | `.../components/lustrous-snackbar` | — | `position`, `max`, `label`, `close-label` | `lustrous-snack-dismiss` | `viewport`, `snack` |
| `<lustrous-spinner>` | `.../components/lustrous-spinner` | — | `variant`, `size`, `tone`, `muted`, `icon`, `speed`, `label` | — | `spinner` |
| `<lustrous-split-button>` | `.../components/lustrous-split-button` | — | `.actions`, `.onAction`, `disabled`, `size`, `variant`, `shape`, `caret-aria-label` | `lustrous-action` | `face`, `caret`, `menu`, `item` |
| `<lustrous-switch>` | `.../components/lustrous-switch` | Yes | `size`, `icon`, `off-icon` | — | `track`, `thumb`, `label` |
| `<lustrous-tabs>` | `.../components/lustrous-tabs` | — | `.tabs`, `value`, `label`, `variant` | `lustrous-change` | `list`, `tab`, `tab-selected`, `panel` |
| `<lustrous-text>` | `.../components/lustrous-text` | — | `variant`, `mobile-variant`, `tone`, `muted`, `wrap`, `max-lines`, `text-align`, `overflow-wrap`, `block`, `visually-hidden`, `heading`, `padding`, `mobile-padding`, `margin` | — | — |
| `<lustrous-text-area>` | `.../components/lustrous-text-area` | Yes | `rows`, `min-rows`, `max-rows`, `auto-grow`, `resize` | — | — |
| `<lustrous-text-input>` | `.../components/lustrous-text-input` | Yes | `label`, `caption`, `value`, `type`, `size`, `border-radius`, `placeholder`, `supporting-text`, `error`, `validation-state`, `leading-icon`, `trailing-icon`, `leading-text`, `trailing-text`, `character-count`, `disabled`, `required`, `readonly`, `name`, `maxlength`, `minlength`, `pattern`, `autocomplete`, `inputmode`, `.form`, `.validity`, `.validationMessage` | `change`, `input` | `header`, `label`, `caption`, `field`, `input`, `leading`, `trailing`, `supporting`, `counter` |
| `<lustrous-timeline>` | `.../components/lustrous-timeline` | — | `label` | — | — |
| `<lustrous-timeline-item>` | `.../components/lustrous-timeline` | — | `heading`, `heading-variant`, `time-label`, `status`, `marker-label`, `icon`, `hide-connector` | — | `row`, `marker`, `connector`, `content` |
| `<lustrous-togglable-button>` | `.../components/lustrous-togglable-button` | Yes | `selected` | `lustrous-change` | — |
| `<lustrous-togglable-icon-button>` | `.../components/lustrous-togglable-icon-button` | Yes | `selected`, `selected-icon` | `lustrous-change` | — |
| `<lustrous-tooltip>` | `.../components/lustrous-tooltip` | — | `content`, `side`, `align`, `offset`, `delay`, `disabled`, `only-when-truncated`, `.truncationTarget`, `.anchor`, `open` | `lustrous-toggle` | — |
| `<lustrous-video-lightbox>` | `.../components/lustrous-video-lightbox` | — | `src`, `poster`, `captions-src`, `captions-label`, `captions-srclang`, `autoplay`, `.videoElement` | `error` | `stage`, `actions` |
