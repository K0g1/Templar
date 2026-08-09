# Templar agent and maintainer instructions

These rules apply to every file in this plugin directory.

## Read first

1. `README.md`
2. `docs/DEVELOPER_REFERENCE.md`
3. `docs/ARCHITECTURE.md`
4. `docs/TEMPLATE_SPEC.md`
5. `docs/PAGED_LAYOUT.md`
6. `docs/SECURITY.md`

## Non-negotiable product invariants

- Markdown belongs to the user. Never rewrite the body to create a visual effect.
- A note's complete design must remain under the single top-level `templar` frontmatter property.
- Use `FileManager.processFrontMatter()` for style changes. Preserve every unrelated property.
- Pageless and paged are per-note modes, not duplicate template types. Every template must support both.
- Paged width is fixed. Pane/window resizing may change only the page scale, never the layout width.
- Template CSS must begin with `.page` or `.page-content`, then be parsed, validated, compiled, and note-scoped. Never inject raw imported CSS.
- Do not expose Obsidian DOM classes as the authoring contract.
- Do not add a network request, telemetry, account requirement, secret, payment, or external-file access without explicit product approval and README disclosure.
- Keep `isDesktopOnly: false`: no Node.js/Electron runtime imports, no `FileSystemAdapter` assumption, and no regex lookbehind.
- Keep the esbuild target on `browser` and preserve `npm run verify:mobile`; PostCSS must be parsed with source maps disabled so its browser shims never enter Node-only paths.
- All long-lived events, observers, styles, and frames need an owner and cleanup path.

## Before editing

- Check the official Obsidian API/type docs for any new API.
- Preserve the minimum supported Obsidian version unless the change intentionally raises it.
- Treat `main.js` as generated. Edit `src/`, then rebuild.
- Do not change a built-in template's ID after release; notes and defaults reference it.
- Schema additions need normalization defaults, frontmatter serialization, import validation, docs, and round-trip tests.

## Required verification

```bash
npm install
npm audit
npm run check
```

For renderer changes, additionally smoke-test:

- Reading view and Live Preview;
- pageless, A4 paged, Letter paged, and a custom page;
- wide and narrow split panes;
- font and grid changes;
- multiple simultaneous notes with different styles;
- plugin disable/re-enable;
- mobile emulation and at least one physical iOS/Android device before public release.

## Code organization

- `src/templates`: schema/defaults/built-ins/portable format.
- `src/services`: stateful application boundaries and pure compilers.
- `src/editor`: CodeMirror-only behavior.
- `src/ui`: Obsidian views, settings, modals, and previews.
- `src/utils`: small pure functions.
- `tests`: pure unit and regression tests.

Prefer adding a focused service or pure helper over growing `main.ts`. UI should call plugin/service methods rather than mutate frontmatter directly.
