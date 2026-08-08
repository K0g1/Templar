# Changelog

All notable changes follow semantic versioning.

## Unreleased

## 1.1.0-alpha.1 — 2026-08-08

- Added headings through H6 with per-level letter spacing and text transform, plus optional drop caps and first-line indents (reading view only for indents).
- Added five paper patterns — ledger, cross-hatch, diagonal, hex, scallop — and per-pattern opacity, scale, dot radius, and major-grid interval controls.
- Added a lists section: unordered marker style and color, indentation guides, and reading-view nested-list indentation.
- Added divider styling (color, width, and solid/dashed/dotted/double/fade styles) for `---` rules.
- Expanded table styling: border width, font size, text and header text colors, cell padding, and optional striped rows.
- Added callout styling with accent, background, text, title, and icon colors, border width, corner radius, and per-type `callout-variants` overrides.
- Added embed background, accent, and corner radius styling.
- Added image float, object-fit, and duotone treatments.
- Added an optional per-note watermark with text, color, size, rotation, and opacity.
- Aligned Template Creator slider limits with schema limits (heading size 144, saturation/contrast 4, code size 48, page radius 80, margin offset 400).
- Fixed the Reading View flash where blank-line spacing appeared a frame or two after switching views: spacers are now inserted synchronously inside the post-processor and live inside section elements, so Obsidian's virtual scroller can no longer discard them between render passes or while scrolling.
- Sidebar library now has three pages — Favorites, Built-in styles, and My custom styles — switched with a tab row, with a ★ favorite toggle on every card.
- Added **Reset to default** to the Customize dialog for built-in styles: restores the original definition and removes any saved customization from the library.
- Added **Reset all settings** to the settings page: restores every option to its default value while keeping custom styles.
- Published the first public alpha with release metadata, prerelease-aware automation, and synchronized user, schema, architecture, security, and maintainer documentation.

## 1.0.0 — 2026-08-08

- Initial Templar v1 implementation.
- Per-note structured styles and safely scoped custom CSS.
- Reading view and Live Preview rendering.
- Font-aware baseline measurement, grid-fitted headings, and image compensation.
- Pageless and fixed-canvas paged modes with A4, Letter, custom sizes, and mobile whole-page scaling.
- Twenty-eight built-in Page Styles, including 20 additional creative aesthetics.
- Page Styles sidebar, Template Creator, raw style editor, library management, new-note flow, and batch application.
- Versioned LLM authoring kit, import validation, isolated preview, and `.templar` export.
- Mobile-compatible browser runtime, automated linting, unit tests, production bundle guard, and dependency audit.
- Unified ruled, dot-grid, and graph pattern origins on the measured browser baseline, with rule ink painted below the baseline for clean glyph placement.
- Added per-template highlighted-text background and foreground colors in Reading View, Live Preview, previews, schema, and the Template Creator.
- Normalized Reading/Live Preview list line-height and removed fractional-grid block gaps so bullets, paragraphs, and Graph Paper remain on one vertical rhythm.
- Preserved exact source blank-line counts in Reading View with owned grid spacers.
- Measured and baseline-corrected fenced code independently in Reading View while tightening Live Preview list/code adapters.
- Added H4 and expanded quote/code/table palette fields plus a comprehensive Detailed Template Creator mode.
