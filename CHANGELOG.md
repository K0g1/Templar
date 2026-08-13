# Changelog

All notable changes follow semantic versioning.

## Unreleased

## 1.2.0-alpha.4 — 2026-08-12

### Release engineering

- Corrected the release workflow so the intentionally hidden verified staging bundle is uploaded to the publish job. The `1.2.0-alpha.3` tag completed all build and verification steps but did not publish artifacts because the upload action excluded `.release`; it is not repointed.

## 1.2.0-alpha.3 — 2026-08-12

### Fixed

- Preserved protected nested source snapshots during page-only edits and routed destructive note updates and synchronization through recovery.
- Made automatic style-rule and reviewed batch writes compare-and-swap guarded, so a note changed after review is skipped instead of overwritten.
- Completed Reading View preview/apply/removal parity and renderer root/observer cleanup coverage.

### Security

- Blocked virtual-root sibling escapes and broad descendant rules that can hide or collapse all readable content, including transparent text and zero/tiny typography.
- Extended the browser-runtime policy scanner to inspect executable template interpolations as well as ordinary source text.

### Compatibility

- Classified note styles, templates, pack wrappers/members, settings, and nested source snapshots before normalization. Supported older schemas migrate in memory; future, malformed, and unsupported data remain protected.

### Recovery

- Added explicit protected-settings recovery actions, recovery-backed destructive note writes, and stale-fingerprint checks inside the frontmatter mutation callback.

### Testing

- Added regression coverage for CSS trust boundaries, migration/recovery paths, automatic-rule races, renderer ownership, and representative full `PageRenderer` workloads.

### Release engineering

- Added full-renderer benchmarks and documented their informational use. Automated checks remain prerequisite evidence; BRAT, desktop, and physical-device matrices are still release-maintainer gates.

## 1.2.0-alpha.2 — 2026-08-11

- Fixed Live Preview pointer hit-testing so clicking styled paragraphs, headings, lists, and text around blank-line runs places the caret on the visible source line. Generated editor CSS now keeps every CodeMirror line margin-free and uses measured line-box padding for heading spacing.
- Fixed diagonal and cross-hatch paper rendering so each tile paints complete edge-to-edge strokes instead of one-pixel corner fragments. Reworked hex and scallop geometry, made multi-layer repeat/position/size lists explicit, and added paged/pageless regression coverage for all nine paper patterns with and without margin lines.
- Fixed Reading View blank-line preservation after closing, reopening, or switching notes, including blank rows at the very start of the Markdown body after hidden YAML. Reused Reading roots now discard file-specific post-processor state, and metadata-backed cached sections reconcile even when Obsidian does not rerun Markdown post-processors.
- Replaced template-specific paper offsets with a measured, per-render-root origin. Source, Live Preview, and Reading now anchor the ruling to the first real rhythmic text baseline after Obsidian Properties/frontmatter UI, retain that document phase during virtualization, and use each font's measured rendered line box. Notes with or without visible Properties therefore keep the same glyph/rule relationship, and mode changes no longer jump by a ruled row.
- Fixed Reading callouts disappearing on light paper when an Obsidian theme supplied a blending mode. Templar now isolates callout paint as part of its complete note palette, while preserving callout types and per-template colors.
- Reworked variable-height rhythm observation to snap each renderer-owned table, Mermaid/math/code result, callout, embed, or media wrapper independently. Measurements include the block's outer margins, contain child-margin collapse inside the measured footprint, are border-box precise, frame-coalesced, tolerant of sub-pixel boundary noise, and exclude the Reading document root and frontmatter UI, eliminating observer feedback loops while preserving explicit blank rows.
- Fixed temporary previews being cancelled during Reading/Editing mode changes. Preview cleanup now follows Obsidian's authoritative Markdown-leaf list, which remains stable while the renderer view is rebuilt, while still releasing sessions when a Markdown leaf actually closes.
- Made renderer scopes leaf-unique instead of path-derived, so previews and custom CSS cannot leak between two panes showing the same file. Cleanup now removes scope, pageless-mode, blank-line, observer, and print state deterministically.
- Hardened note and import trust boundaries: physical CSS string controls and unterminated comments are rejected, structured CSS strings cannot escape their declaration, grid-breaking custom geometry is blocked in baseline modes, pack input is capped at 8 MB and 256 members, and duplicate pack IDs are explicit validation errors.
- Fixed schema/catalog round trips and rendering edge cases: unsupported note-style versions fail closed, no-watermark built-ins remain synchronization-stable, ledger paints both ledger lines, base/variant callout colors remain distinct and readable, and synchronization comparisons ignore object-key order.
- Print preparation now serializes concurrent jobs, temporarily renders the exact leaf in Reading View, waits for fonts, images, DOM/resize quiet, and pagination, then restores the original mode and renderer state even on cancellation or failure.

## 1.2.0-alpha.1 — 2026-08-09

- Added leaf-scoped live “try on this note” previews with production rendering, generation-safe rapid switching, explicit Apply/Cancel, exact restoration, global Escape cancellation, and multi-pane isolation.
- Rebuilt Page Styles around Current Note state, Recent/Favorites/Built-in/My Styles, usage and folder relevance, Most Used sorting, lightweight swatches, Compact/Comfortable/Gallery density, simplified cards, and accessible roving keyboard navigation.
- Made normal apply one click: styled notes retain all page options and attachment overrides; unstyled notes use a new Pageless/Paged A4/Paged Letter default; explicit page options remain in overflow.
- Added an explicit-session Current Note inspector with live draft rendering, collapsible appearance/typography/headings/layout/images/page/watermark controls, per-section reset, Save/Discard, and Modified status.
- Added source snapshots, update/missing/modified state calculation, safe replacement, conservative legacy handling, recursive three-way merge, exact review counts, and chunked synchronization writes while preserving note-specific data.
- Added ordered automatic style rules for folder, tag, filename, and frontmatter equality, with AND conditions, first-match priority, metadata readiness, event-only triggers, dry runs, accessible ordering, and unstyled-only safety.
- Added a lazy incremental note-style index for usage badges, update counts, Most Used, and current-folder relevance without polling or per-render vault scans.
- Added versioned `.templar-pack` import/export with arbitrary/folder selection, independent member validation, on-demand preview, explicit custom keep/replace/copy conflicts, and immutable built-in protection.
- Added print/export preparation using the existing renderer and host print system: fonts/images/layout settle first, A4/Letter/custom page sizing is requested, screen gaps/shadows are removed, and no PDF dependency was introduced.
- Added context-sensitive commands for search, note customization, last/favorite styles, preview control, page toggles, synchronization, rules, and print/export.
- Fixed horizontal rules in strict/balanced grids so Reading and Live Preview allocate exactly one baseline unit for solid/dashed/dotted/double/fade dividers, including paged output and thickness clamping without persistence changes.
- Expanded settings migration, mobile/touch/reduced-motion CSS, accessibility labels/focus behavior, cleanup ownership, security documentation, architecture/specification/runbooks, and regression coverage to 76 tests.

## 1.1.0-alpha.3 — 2026-08-08

- Fixed ruled, grid, decorative paper patterns, and margin lines being painted behind the solid page background in pageless Reading view. The page content now creates an isolated stacking context, with a compiler regression test protecting the paper layer.

## 1.1.0-alpha.2 — 2026-08-08

- Expanded the built-in library from 28 to 132 styles across 13 themed packs covering color stories, seasons, celebrations, academia, professional work, wellness, travel, nature, editorial, neon, fantasy, and pastels.
- Added folders to the portable template schema, Template Creator, fuzzy picker, and Page Styles browser, with legacy templates migrating safely to `Unfiled`.
- Rebuilt the Page Styles browser around folder summaries, indexed search, coalesced updates, and on-demand cards so the expanded library remains responsive on desktop and mobile.
- Added lightweight thumbnail rendering for every paper pattern, searchable folder/tag metadata, case-insensitive folder handling, clearer semantics, and 44px mobile controls.
- Added catalog-wide validation for unique identities, folder coverage, CSS/schema integrity, and readable color contrast across text and interactive surfaces.
- Added three rich Markdown showcase notes, original artwork, and a real in-Obsidian screenshot gallery to the project landing page.
- Fixed renderer lifecycle cleanup for closed leaves and replaced Reading roots, preventing detached Obsidian DOM trees from being retained.
- Added release metadata verification so tags, package/manifest versions, compatibility entries, and release notes must agree before publishing.
- Added pull-request and main-branch CI for linting, tests, strict TypeScript, production bundling, and the mobile runtime guard.
- Reworked the README as a concise, gallery-first introduction and clarified that Templar is currently available only through manual installation.

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
