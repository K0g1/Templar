# Maintainer guide

The current handoff snapshot is [`DEVELOPER_REFERENCE.md`](DEVELOPER_REFERENCE.md). It records the alpha version, command/settings surface, source map, persistence and lifecycle contracts, release artifacts, and known limitations. This guide is the executable smoke-test and release checklist.

At `1.2.0-alpha.1`, the built-in catalog is 132 styles (28 core + 104 generated across 13 themed packs), the minimum Obsidian version is 1.8.0, and the only supported distribution path is manual installation of the three release artifacts.

## Local workflow

```bash
npm install
npm run dev
```

Reload Templar in Obsidian after builds. For a clean handoff:

```bash
npm audit
npm run check
```

`npm run check` runs Obsidian-aware ESLint, Vitest, strict TypeScript, a minified browser-targeted esbuild bundle, and the mobile bundle guard. The guard fails if `main.js` retains Node/Electron imports, dynamic `require`, `Buffer`, or `process` access.

For the `1.2.0-alpha.1` snapshot, the pure suite contains 76 tests. Treat the command result—not a hard-coded count—as authoritative when the suite grows.

The CI workflow runs the same check on every pull request and push to `main`; tagged releases repeat it before attaching artifacts.

## Test layout

- `grid.test.ts`: grid fitting, heading correction, image compensation, aligned page gaps.
- `font-metrics.test.ts`: baseline probe geometry and the no-DOM fallback.
- `reading-whitespace.test.ts`: exact source-line gaps and fenced-code exclusion.
- `schema.test.ts`: normalization, note/frontmatter round trips, built-in validity.
- `folders.test.ts`: legacy migration, folder sanitization/round trips, library discovery, and case handling.
- `builtins.test.ts`: catalog size and uniqueness, pack/folder diversity, schema/CSS validity, and palette contrast.
- `css.test.ts`: virtual mapping, scope guarantees, keyframes, global/resource rejection, paged media-query rule.
- `style-compiler.test.ts`: shared pattern origin, editor list normalization, measured Reading code padding, highlight palettes, injection containment, fixed-page CSS, extended headings, watermark/divider/table/list/callout declarations, duotone/float, and every pattern variant.
- `template-library.test.ts`: immutable built-in/custom snapshots, IDs, duplicate/save/remove behavior, and favorites.
- `synchronization.test.ts`: status classification, note/source separation, page/attachment preservation, and recursive three-way merge.
- `style-rules.test.ts`: folder/tag/filename/frontmatter AND matching, metadata readiness, priority, and page presets.
- `note-style-index.test.ts`: lazy usage/folder counts and metadata/delete/rename updates.
- `template-pack.test.ts`: pack parsing, per-member validity, portable export, and copy conflict IDs.
- `settings.test.ts`: migration/normalization for default page flow, density, Recent, and rules.
- `print-service.test.ts`: A4, Letter, custom, and pageless print-size selection.

Pure tests deliberately avoid importing Obsidian's Electron runtime. UI/runtime behavior needs an Obsidian smoke test.

The generated bundle is intentionally ignored by source control. A local live test must run `npm run build`, then copy `main.js`, `manifest.json`, and `styles.css` into the test vault's `.obsidian/plugins/templar/` directory before reloading the plugin. If the UI appears stale, compare artifact hashes and confirm the plugin folder is the one Obsidian has enabled.

## Manual smoke test

Create a note containing:

```markdown
# Heading one

Paragraph with **bold**, *italic*, `code`, a [[link]], and ==highlighted text==.

## Heading two

- [x] Completed task
- [ ] Open task

> A multi-line quotation.

| Column A | Column B |
| --- | --- |
| One | Two |

![[an-image.png]]

```js
console.log('code block');
```
```

Spot-check every themed pack in Reading and Live Preview, and run the complete catalog tests. Confirm ordinary source text and undo/redo remain unchanged.

Add one, three, and five empty source lines between paragraphs; confirm Reading View preserves those exact counts. Test an already-styled note, applying a style while an unstyled note is open, and reloading the plugin while Reading View is already cached. These protect the section-registry and deferred-reconcile paths. Add a multi-line fenced code block with an internal blank line and confirm every code baseline follows the ruling without creating an external spacer.

The blank-line spacers must appear on the very first frame, with no flash: switch a styled note between Reading View and Source/Live Preview repeatedly, and on first open, tab restore, and plugin reload. Scroll a long styled note to the bottom and back; spacer counts must persist (they are inside section elements, so the virtual scroller never discards them). Edit a paragraph's length, then add/remove a blank line between two paragraphs and confirm the spacing updates on save.

For ruled, dot-grid, and graph templates, zoom in far enough to confirm that the ordinary glyph body sits immediately above the pattern anchor, the one-pixel rule extends downward, and descenders cross it naturally. Confirm consecutive bullets use the same line-height as ordinary text and that the block after a list still lands on the grid. Confirm each built-in supplies a readable highlight background and foreground in both views.

In pageless Reading view, confirm the paper pattern and optional margin line remain visible over the full content height. This protects the isolated stacking context that keeps negative-z-index paper layers above the solid page background.

Spot-check the extended features in both views: H5/H6 rendering, heading letter spacing/text transform and drop caps, list markers and indentation guides, divider styles, striped tables, callout variants (`!warning` etc.), image float/object-fit/duotone, and the watermark (confirm it sits behind the text and never intercepts pointer events). Verify the new patterns — ledger, cross-hatch, diagonal, hex, scallop — tile correctly at extreme `pattern-scale` values in pageless and paged modes.

Open the Template Creator's Simple, Detailed, and Advanced tabs. In Detailed mode exercise H2–H6 font controls, pattern controls, margin color/offset, code typography, table/divider/callout/embed settings, lists, watermark, image float/object-fit/duotone, and paged/pageless preview.

For paged mode, follow `docs/PAGED_LAYOUT.md`'s resize matrix. For per-note isolation, open at least three split leaves with different styles and modes.

### UX expansion smoke matrix

1. Search a 132-style section; click and keyboard-preview several cards quickly. Verify only the originating leaf changes, there is no unstyled flash, Escape restores the exact persisted style, and another pane of the same file remains persistent.
2. Apply from preview and directly from a card. Confirm there is no page modal, existing page/attachment settings persist, unstyled notes use the configured default flow, and Recent changes only after successful apply.
3. Exercise `/`, arrows, Home/End, Space, Enter, F, and the Escape hierarchy in Compact, Comfortable, and Gallery modes. Inspect visible focus and screen-reader labels.
4. Open Customize current note, drag controls rapidly, reset sections, discard once, then save. Confirm no frontmatter writes occur before Save and the note becomes Modified afterward.
5. Change a custom source template and review clean, modified, legacy, and missing-source notes. Verify exact confirmation counts; safe replace and three-way merge must preserve page, attachments, unrelated frontmatter, and Markdown.
6. Create folder/tag/filename/property rules, reorder by drag and buttons, preview existing matches, and run a bulk apply. Styled notes must always be skipped by automatic triggers.
7. Delete and rename styled notes while the library is open. Usage, current-folder, Most Used, and update counts must change incrementally without reopening or a recurring scan.
8. Export/import standalone templates and packs. Test valid/warning/error members, custom keep/replace/copy conflicts, built-in protection, keyboard selection, and a pack whose folder labels contain separators.
9. Print paged A4/Letter/custom and pageless notes after late fonts/images. Inspect backgrounds, patterns, watermarks, frames, tables, callouts, code, pagination, removed gaps/shadows, and restored screen layout after cancelling print.
10. Test multiple consecutive Markdown dividers and every divider style in strict/balanced ruled and graph templates at several units, in Reading/Live Preview and near A4/Letter boundaries. Every following block must remain on the grid.
11. Close preview/inspector/sidebar/leaf and unload the plugin while work is pending. Confirm temporary styles, frames, observers, listeners, print CSS, and draft state are released.

## Mobile release gate

The code is designed for mobile but release claims require evidence:

1. In desktop developer tools, run `this.app.emulateMobile(true)` and check narrow/touch layouts.
2. Test a physical iOS device supported by current Obsidian.
3. Test a physical Android device or representative emulator.
4. Exercise the software keyboard in creator/import/raw modals.
5. Create, apply, switch mode, edit, scroll a long paged note, load images, and disable/re-enable the plugin.
6. Confirm there are no Node/Electron or adapter errors in logs.

Record app version, OS version, device, orientation, and result in the release checklist.

## Schema change recipe

1. Add the internal type.
2. Add a safe default.
3. Normalize both kebab-case persisted and camel-case internal spellings.
4. Serialize a readable kebab-case field.
5. Add validation/clamping.
6. Compile the behavior or expose the setting.
7. Round-trip it in tests.
8. Update `TEMPLATE_SPEC.md` and the LLM authoring kit.
9. Decide whether the change is backward-compatible v1 or requires v2.

## Adding a built-in template

- Use `builtIn()` in `src/templates/builtins.ts`.
- Prefer a data seed in `src/templates/packs/catalog.ts` when the design belongs to a themed pack.
- Pick a permanent unique ID.
- Assign a concise folder and useful search tags.
- Configure only structured modules and safe virtual CSS.
- Test pageless and paged preview.
- Keep font stacks portable with fallbacks.
- Run the built-in schema/CSS and contrast tests; do not bypass the readability correction for decorative palette fidelity.
- Update the gallery only when a new screenshot materially broadens what the landing page demonstrates.

## Obsidian DOM changes

Templar intentionally localizes internal selectors to two places:

- root/content discovery in `PageRenderer.prepareViewRoots()`;
- Live Preview element expansion in `css-compiler.ts`.

When an Obsidian release changes DOM:

1. inspect both Reading and Live Preview on desktop and mobile;
2. update only the adapter mapping;
3. keep the public virtual vocabulary unchanged;
4. add a compiler regression test;
5. verify older supported Obsidian versions if possible.

## Performance debugging

- Obsidian exposes plugin startup timing under general advanced settings.
- Keep `onload()` to registrations/data construction.
- Watch for repeated pagination frames or ResizeObserver loop warnings.
- Profile long notes in Reading and Live Preview separately.
- Check the number of open styled leaves and observers.
- Test production `main.js`; development source maps distort size/startup.

## Version and release

1. Update `minAppVersion` only when API usage requires it.
2. Run `npm version <exact-version> --no-git-tag-version`; the version script synchronizes `package.json`, `package-lock.json`, `manifest.json`, and `versions.json`.
3. Move the shipped entries from **Unreleased** to a dated changelog heading and add `docs/releases/<exact-version>.md`.
4. Run `npm audit` and `npm run check`.
5. Run `npm run verify:release -- <exact-version>` to catch mismatched metadata before tagging.
6. Complete and record the manual desktop/mobile verification. A prerelease may ship with clearly documented manual gates still pending; a community-directory-ready stable release may not.
7. Commit and push the release state.
8. Create and push a tag that exactly matches `manifest.json`, without a `v` prefix (for example, `1.1.0` or `1.1.0-alpha.2`).
9. Wait for the release workflow and verify that the GitHub release contains `main.js`, `manifest.json`, and `styles.css`.

The release workflow uses `docs/releases/<tag>.md` as the release body and automatically marks any tag containing `-` as a GitHub prerelease. Never repoint or overwrite an existing release tag; increment the prerelease suffix instead.

## Documentation handoff

When a change lands, update the narrowest contract document and the developer reference summary:

- YAML/schema/normalization/virtual selectors → `TEMPLATE_SPEC.md` and `src/templates/llm-kit.ts`;
- renderer ownership, event flow, CSS isolation, or cleanup → `ARCHITECTURE.md`;
- fixed page geometry or page fitting → `PAGED_LAYOUT.md`;
- trust boundary, runtime dependency, or privacy behavior → `SECURITY.md` and root `SECURITY.md` when reporting policy changes;
- commands/settings, source ownership, current catalog counts, release state, known limitations, or handoff instructions → `DEVELOPER_REFERENCE.md`;
- user-facing installation or feature summary → root `README.md`;
- historical behavior → `CHANGELOG.md` and a new `docs/releases/<version>.md` entry, without rewriting older release notes.

Before handing the repository to another maintainer, record the source commit/tag, whether `main.js` was rebuilt and copied to a live vault, the exact verification commands that passed, and any physical-device checks that remain pending. Never commit `data.json`, private notes, credentials, or unrelated vault assets.
