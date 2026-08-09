# Templar

> Give every Markdown note its own visual identity.

Templar turns ordinary Obsidian notes into polished journals, study sheets, project briefs, travel logs, scrapbooks, and more—without taking ownership of your writing. Your note stays Markdown. Its design travels with it.

[![Release](https://img.shields.io/github/v/release/K0g1/Templar?include_prereleases&sort=semver&style=for-the-badge)](https://github.com/K0g1/Templar/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

> [!IMPORTANT]
> Templar is currently an alpha and is available through manual installation only. Back up important vaults before testing prerelease software.

## See what your notes can become

| Botanical field notes | Alpine travel log | Neon creative brief |
| :---: | :---: | :---: |
| [![A botanical journal note in Obsidian with fern photography, warm paper, a heading, highlighted text, a table, and checklist](docs/assets/gallery/botanical-field-notes.png)](docs/assets/gallery/botanical-field-notes.png) | [![An alpine travel note in Obsidian with mountain photography, cool paper styling, highlighted route notes, a numbered list, and a table](docs/assets/gallery/alpine-field-log.png)](docs/assets/gallery/alpine-field-log.png) | [![A dark neon creative brief in Obsidian with cyberpunk photography, magenta and cyan accents, code, a palette table, checklist, and callouts](docs/assets/gallery/neon-night-brief.png)](docs/assets/gallery/neon-night-brief.png) |

These are real Markdown notes rendered by Templar inside Obsidian—not mockups. The example notes and original artwork are included in [`examples/`](examples/).

## A style library you can actually explore

Templar includes **132 built-in styles** organized into themed folders, with instant search and favorites. Browse calm neutrals, rich color stories, seasonal palettes, celebrations, academic papers, professional layouts, wellness journals, travel notebooks, vintage editorials, dark neon systems, fantasy pages, and more.

- Browse template packs by folder instead of scrolling through one endless list.
- Search by style name, folder, description, creator, or tag.
- Star favorites and keep custom styles in their own library.
- Duplicate any built-in, move your copy into a folder, and make it yours.

## Designed for real notes

- **Rich Markdown:** headings through H6, emphasis, highlights, links, lists, tasks, quotes, code, tables, callouts, embeds, dividers, and images.
- **Two page modes:** use a natural reflowing note or a fixed A4, Letter, or custom page that scales as one sheet on narrow screens.
- **Visual depth:** paper patterns, baseline-aware typography, image treatments, watermarks, callout palettes, table styling, and more.
- **Your own designs:** create a style with guided controls, edit its raw definition, or import and export portable `.templar` files.
- **Desktop and mobile:** the same self-contained note design works across Obsidian desktop and mobile.

## Manual installation

1. Open the [Templar releases page](https://github.com/K0g1/Templar/releases).
2. Download `main.js`, `manifest.json`, and `styles.css` from the release you want to test.
3. Create `<your-vault>/.obsidian/plugins/templar/`.
4. Place all three downloaded files in that folder.
5. Reload Obsidian, then enable **Templar** under **Settings → Community plugins → Installed plugins**.

Templar is not yet listed in the Obsidian Community Plugins directory, so it will not appear in Browse or search results there.

## Your first styled note

1. Open a Markdown note.
2. Select the paintbrush ribbon icon or run **Open page styles** from the command palette.
3. Choose a folder, preview the available styles, and select **Apply**.
4. Pick **Pageless** or **Paged**, then keep writing normal Markdown.

Applying a style never rewrites the Markdown body. Removing Templar styling returns the note to its normal Obsidian appearance.

## Private, portable, and yours

Templar has no account, telemetry, ads, API key, or network traffic. It reads and writes through Obsidian's vault APIs, keeps each note's complete design in one frontmatter property, and validates imported styles before using them.

## Project links

- [Documentation](docs/README.md)
- [Template specification](docs/TEMPLATE_SPEC.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)

<details>
<summary><strong>Build from source</strong></summary>

```bash
git clone https://github.com/K0g1/Templar.git
cd Templar
npm install
npm run check
```

Copy the generated `main.js`, `manifest.json`, and `styles.css` into `<your-vault>/.obsidian/plugins/templar/`, then reload Obsidian.

</details>

## License

MIT. See [`LICENSE`](LICENSE).
