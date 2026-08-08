# Templar

> Give each Markdown note its own self-contained visual page design.

Templar is an [Obsidian](https://obsidian.md) plugin that styles Markdown notes independently, one design per note. A styled note is still an ordinary `.md` file. The body stays plain Markdown and the whole design lives under a single `templar` frontmatter property, so it is easy to read, copy, and version.

Templar works on desktop and mobile. It makes no network requests, needs no account or API key, collects no telemetry, and never reads or writes outside the vault.

[![Release](https://img.shields.io/github/v/release/K0g1/Templar?include_prereleases&sort=semver&style=for-the-badge)](https://github.com/K0g1/Templar/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

> [!IMPORTANT]
> Templar is currently available as an alpha release for manual testing. Back up your vault and test it in a dedicated vault before relying on it for important notes. Physical iOS and Android release-gate testing is still pending.

## Features

- Styles Reading view and Live Preview independently, per note.
- Compiles a stable `.page` / `.page-content` CSS vocabulary onto plugin-owned view classes.
- Measures the browser's real text baseline so ruled, dot-grid, and graph paper all line up with your text.
- Fits headings to whole grid units and returns images to the next baseline.
- Keeps intentional blank lines in Reading View and aligns lists and fenced code the same way in both views.
- Every template sets its own background and foreground colors for `==highlighted text==`.
- Nine paper patterns (ruled, ledger, dot grid, graph, cross-hatch, diagonal, hex, scallop, blank) with adjustable opacity, scale, dot radius, and major-grid interval.
- Full heading stack through H6 with per-level letter spacing and text transform, plus optional drop caps and first-line indents.
- Styles unordered list markers, indentation guides, horizontal dividers, tables (borders, stripes, typography), callouts (with per-type variants), and embedded notes.
- Image frames, floats, object-fit, duotone, sepia/contrast, and baseline snapping.
- Optional per-note watermark text with size, rotation, and opacity.
- Pageless notes reflow like normal notes. Paged notes use a fixed A4, Letter, or custom canvas that scales as a whole on narrow panes and phones.
- Comes with 28 built-in styles, from classic journals and botanical paper to blueprint grids, pastel study pages, and terminal dark modes.
- Create a new styled note or apply a style to an existing note without touching its body.
- Includes a sidebar library, a three-level Template Creator, a raw style editor, import/export, batch application, and diagnostics.
- Imported CSS is validated before use. Global selectors, resource loading, fixed overlays, and anything that could break the page canvas are rejected.
- Ships a versioned LLM authoring kit you can paste into any capable model. Templar itself has no AI integration.

## Installation

### From the community directory

Once Templar is listed in the Obsidian community plugins directory:

1. Open **Settings → Community plugins** in Obsidian.
2. Select **Turn on community plugins** if Restricted Mode is enabled.
3. Select **Browse**, search for **Templar**, and install it.
4. Enable the plugin under **Installed plugins**.

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the desired entry on the [releases page](https://github.com/K0g1/Templar/releases). Prereleases are intended for testing.
2. Create a folder named `templar` inside `<vault>/.obsidian/plugins/`.
3. Place the three files in that folder.
4. Reload Obsidian and enable **Templar** under Settings → Community plugins.

### Building from source

```bash
git clone https://github.com/K0g1/Templar.git
cd templar
npm install
npm run build
```

Copy the generated `main.js` (plus `manifest.json` and `styles.css`) into `<vault>/.obsidian/plugins/templar/` and reload Obsidian.

## First use

1. Open the command palette and run **Open page styles**, or select the paintbrush ribbon icon.
2. Open a Markdown note.
3. Select **Apply** on any style.
4. Choose **Pageless** or **Paged**. Paged mode also offers A4, US Letter, and custom dimensions.
5. Continue writing normal Markdown.

Select **New note** on a style card to create a note from that style. The creation dialog asks for a title, folder, page mode, and page size before writing the note.

## Page modes

### Pageless

Pageless notes behave like normal Obsidian documents. The writing area adapts to the pane, so lines can wrap differently when the window changes size.

### Paged

Paged notes use a fixed CSS-pixel canvas. Text is laid out at that fixed width, page breaks are fitted around rendered blocks, and narrow panes change only a whole-page scale factor. The page behaves like a PDF sheet: resizing the window changes its apparent size, not the location of words on the sheet.

The note stores its choice under `templar.page`; switching modes never changes the Markdown body. Inter-page gaps are automatically adjusted to a baseline-grid multiple so ruled paper begins at the same measured baseline on every sheet.

## Commands

- Open page styles
- Choose page style…
- Apply default page style
- Remove page style
- Edit raw style…
- Create page style…
- Create styled note…
- Change page mode…
- Import page style…
- Apply page style to multiple notes…
- Copy LLM template authoring skill

No command claims a default hotkey.

## What a styled note contains

The exact structure is documented in [`docs/TEMPLATE_SPEC.md`](docs/TEMPLATE_SPEC.md). A shortened example:

```yaml
---
templar:
  version: 1
  style-name: Classic Ruled
  template-id: classic-ruled
  page:
    mode: paged
    size: a4
    width: 794
    height: 1123
    gap: 32
    scale-to-fit: true
  paper:
    color: "#fffdf4"
    pattern: ruled
  baseline:
    enabled: true
    mode: strict
    unit: 30
    snap-images: true
  typography:
    body-font: 'Georgia, "Times New Roman", serif'
    body-size: 18
  css: |
    .page h1 {
      letter-spacing: -0.025em;
    }
---

# Ordinary Markdown begins here
```

Applying another library template replaces only the `templar` property. Removing a style deletes only that property. Existing properties, links, embeds, tags, tasks, callouts, and attachments are preserved.

## Template library behavior

The sidebar library is organized into three pages — **Favorites**, **Built-in styles**, and **My custom styles** — switched with the tab row at the top. The ★ button on any card adds or removes it from Favorites.

Built-in styles are immutable. **Customize** duplicates a built-in style before editing it; **Reset to default** (in the Customize dialog) restores the built-in's original definition and removes any saved customization of it from your library. Custom styles can be edited, duplicated, exported, or deleted.

Applying a style copies its entire normalized design into the note. A note therefore does not depend on the library entry continuing to exist. Deleting a library entry never changes notes that already use it.

The settings page's **Reset all settings** restores every option to its default value while keeping your custom styles.

Exports are written as `.templar` YAML files in `Templar Templates/`. The authoring kit can be copied or exported as `Templar Template Authoring Skill.md`.

## AI / LLM workflow

Templar has no AI integration. The settings page provides a versioned instruction document that can be pasted into any capable model. Paste the returned YAML into **Import page style**, inspect the human-readable validation and the isolated preview, then explicitly save it to the library.

## Mobile

The runtime contains no Node.js or Electron imports and `manifest.json` declares `isDesktopOnly: false`. The sidebar, settings, modals, and creator collapse to a single-column layout on narrow screens. Paged mode uses standard DOM observers and CSS whole-page scaling.

Desktop mobile emulation is useful, but a physical iOS and Android smoke test is still required before community-directory submission. See [`docs/MAINTAINER_GUIDE.md`](docs/MAINTAINER_GUIDE.md).

## Privacy and security

- No telemetry, analytics, ads, accounts, payments, or network traffic.
- No external filesystem access.
- No `innerHTML` use for imported or note data.
- Atomic frontmatter mutation through Obsidian's `FileManager`.
- Parsed, size-limited, note-scoped CSS with namespaced keyframes.
- Runtime production dependencies are audited by `npm audit`.

The full threat model is in [`docs/SECURITY.md`](docs/SECURITY.md). To report a vulnerability, see [`SECURITY.md`](SECURITY.md).

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design, services, and data flow.
- [`docs/TEMPLATE_SPEC.md`](docs/TEMPLATE_SPEC.md) — the Templar v1 schema and CSS vocabulary.
- [`docs/PAGED_LAYOUT.md`](docs/PAGED_LAYOUT.md) — fixed-page layout and mobile scaling algorithm.
- [`docs/SECURITY.md`](docs/SECURITY.md) — trust boundaries, validation, and privacy model.
- [`docs/MAINTAINER_GUIDE.md`](docs/MAINTAINER_GUIDE.md) — testing, extension recipes, and release steps.

See [`docs/README.md`](docs/README.md) for the full index.

## Development

```bash
npm run dev          # watch build
npm run lint         # Obsidian-aware lint rules
npm test             # unit tests
npm run build        # strict type-check and production bundle
npm run verify:mobile # reject Node/Electron imports and globals in main.js
npm run check        # lint + test + build
npm audit            # dependency advisory check
```

Contributors should read [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`docs/MAINTAINER_GUIDE.md`](docs/MAINTAINER_GUIDE.md).

## Known boundaries

- Reading-view pagination moves whole rendered blocks. A single block taller than the printable area starts at a sheet's content top and remains intact; future work may add safe paragraph/table fragmentation.
- CodeMirror virtualizes very long Live Preview documents. Templar repaginates the currently rendered editor blocks as the viewport changes.
- A fixed page guarantees stable layout for a given device/font installation and Obsidian zoom. Missing fonts fall back according to the template's font stack and can therefore change metrics.
- Physical-device mobile validation is a release gate, not something unit tests or desktop emulation can fully replace.

## License

MIT. See [`LICENSE`](LICENSE).
