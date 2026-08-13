# Maintainer guide

The current handoff snapshot is [`DEVELOPER_REFERENCE.md`](DEVELOPER_REFERENCE.md). It records the alpha version, command/settings surface, source map, persistence and lifecycle contracts, release artifacts, and known limitations. This guide is the executable smoke-test and release checklist.

At `1.2.0-alpha.3`, the built-in catalog is 132 styles (28 core + 104 generated across 13 themed packs), the minimum Obsidian version is 1.8.0, and BRAT is a supported alpha distribution/update path under final clean-vault validation. Do not call it recommended until the release E2E matrix is recorded. Manual installation of the three release artifacts remains the compatibility fallback; see [`INSTALLATION.md`](INSTALLATION.md).

## Promotion policy

| Stage | Required evidence |
| --- | --- |
| Alpha | Architecture and data format may change. Automated gates are required; an incomplete manual matrix is permitted only when the release note discloses it exactly. |
| Beta | Persistence, schema, recovery, and CSS-security contracts are frozen; no known data-loss or trust-boundary blocker remains; BRAT packaged install, desktop matrix, migration/recovery scenarios, and interactive mobile coverage have been recorded. Any unavailable physical device is disclosed in the beta release note. |
| Stable | Beta soak is complete and physical iOS plus Android validation is recorded, alongside all automated, BRAT, desktop, migration, and recovery gates. |

Do not label a build beta merely because its automated suite passes. Manual evidence applies to the packaged GitHub/BRAT artifact, not a development checkout.

## Local workflow

```bash
npm install
npm run dev
```

Reload Templar in Obsidian after builds. For a clean handoff:

```bash
npm audit --audit-level=moderate
npm audit --omit=dev --audit-level=moderate
npm run check
```

`npm run check` runs Obsidian-aware ESLint, test-inclusive strict TypeScript, Vitest (including targeted `happy-dom` integration files), a minified browser-targeted esbuild bundle, the mobile bundle guard, the runtime privacy scan, and the BRAT artifact contract verifier. The guard fails if `main.js` retains Node/Electron imports, dynamic `require`, `Buffer`, or `process` access.

Treat the command result—not a hard-coded count—as authoritative when the suite grows. Pure tests run in Node; renderer, print, clipboard, frontmatter, and pop-out lifecycle tests are explicit integration fixtures. Historical release notes retain the count that shipped with each version.

The CI workflow runs the same check on every pull request and push to `main`; tagged releases run `npm run verify:ship -- <exact-version>`, produce `SHA256SUMS.txt`, verify the BRAT bundle contract, and publish only the verified artifact set through a draft release.

## Test layout

- `grid.test.ts`: grid fitting, actual line-box-aware heading correction, image/outer-footprint compensation, aligned page gaps.
- `font-metrics.test.ts`: baseline probe geometry, browser-expanded line-box measurement, document-specific caching, and the no-DOM fallback.
- `paper-origin.test.ts`: Source/Live Preview/Reading target selection, Properties/frontmatter exclusion, zoom normalization, and measured paper phases.
- `scope.test.ts`: collision-free per-leaf renderer scope values.
- `hide-metadata.test.ts`: exact root `templar:` YAML hiding without consuming body lines or unrelated properties.
- `reading-whitespace.test.ts`: exact source-line gaps and fenced-code exclusion.
- `preview-session.test.ts`: coalesced leaf-local previews, closed-leaf cleanup, and transient file-less Markdown mode rebuilds.
- `schema.test.ts`: normalization, note/frontmatter round trips, built-in validity.
- `folders.test.ts`: legacy migration, folder sanitization/round trips, library discovery, and case handling.
- `builtins.test.ts`: catalog size and uniqueness, stable export/normalize round trips, pack/folder diversity, schema/CSS validity, and palette contrast.
- `catalog-render-matrix.test.ts`: all 132 built-ins across pageless/A4/Letter, every pattern family, scope integrity, and finite compiled output without full preview renderers.
- `css.test.ts`: functional virtual mapping, leaf scope guarantees, keyframes, malformed-string/global/resource rejection, gridded-rhythm protection, and paged media-query rules.
- `style-compiler.test.ts`: measured paper-origin hooks, editor list/line-box normalization, Reading code padding, highlight palettes, frontmatter/CSS injection containment, fixed-page CSS, extended headings, watermark/divider/table/list/callout declarations, outer block snapping, duotone/float, and every pattern variant.
- `template-library.test.ts`: immutable built-in/custom snapshots, IDs, duplicate/save/remove behavior, and favorites.
- `synchronization.test.ts`: status classification, key-order-insensitive comparisons, note/source separation, page/attachment preservation, and recursive three-way merge.
- `style-rules.test.ts`: folder/tag/filename/frontmatter AND matching, metadata readiness, priority, and page presets.
- `note-style-index.test.ts`: lazy usage/folder counts and metadata/delete/rename updates.
- `template-pack.test.ts`: bounded pack parsing, duplicate-ID errors, per-member validity, aggregate CSS limits, portable export, and copy conflict IDs.
- `settings.test.ts`: migration/normalization for default page flow, density, Recent, and rules.
- `print-service.test.ts`: A4, Letter, custom, and pageless print-size selection.
- `tests/*integration.test.ts`: happy-dom realm ownership, renderer cleanup, pop-out preview isolation, clipboard focus, frontmatter settlement, and print restoration/concurrency paths.
- `performance.bench.ts`: repeatable renderer, catalog, vault-matching, compiler, and pagination fixtures; see [`PERFORMANCE.md`](PERFORMANCE.md).

Pure tests deliberately avoid importing Obsidian's Electron runtime. The integration harness uses small DOM/fake-owner fixtures; it complements rather than replaces a real Obsidian smoke test.

Use `npm run test:coverage` for a V8 report of lines, statements, functions, and branches. Coverage is diagnostic and does not replace desktop Obsidian or physical-device evidence.

The generated bundle is intentionally ignored by source control. A local live test must run `npm run build`, then copy `main.js`, `manifest.json`, and `styles.css` into the test vault's `.obsidian/plugins/templar/` directory before reloading the plugin. If the UI appears stale, compare artifact hashes and confirm the plugin folder is the one Obsidian has enabled.

The current alpha's structured BRAT E2E matrix and physical-device smoke results are pending maintainer execution. The alpha policy permits those checks to remain pending only when release notes say so; automated build, mobile-bundle, privacy, and test gates do not substitute for BRAT or physical-device evidence.

Repository-level GitHub controls are recorded in [`REPOSITORY_GOVERNANCE.md`](REPOSITORY_GOVERNANCE.md). The active `main` ruleset and classic protection both require the observed `check` CI job, pull requests, and conversation resolution while blocking force pushes and deletion. Dependabot alerts/security updates and future-release immutability are enabled; do not mutate the existing alpha release to retrofit immutability.

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

Add one, three, and five empty source lines between paragraphs; confirm Reading View preserves those exact counts. Repeat with the empty lines immediately after hidden YAML and before the first body block, confirming YAML contributes zero visible rows. Test an already-styled note, applying a style while an unstyled note is open, and reloading the plugin while Reading View is already cached. These protect the section-registry and deferred-reconcile paths. Add a multi-line fenced code block with an internal blank line and confirm every code baseline follows the ruling without creating an external spacer.

The blank-line spacers must appear on the very first frame, with no flash: switch a styled note between Reading View and Source/Live Preview repeatedly, and on first open, tab restore, and plugin reload. While a temporary style preview is active, repeat both mode transitions and confirm the preview remains active and leaf-local. Close and reopen the note without reloading, switch the same leaf to a second styled note with a different blank-line count, then switch back; every note must immediately show its own exact gaps. Scroll a long styled note to the bottom and back; spacer counts must persist (they are inside section elements, so the virtual scroller never discards them). Edit a paragraph's length, then add/remove a blank line between two paragraphs and confirm the spacing updates on save.

For ruled, dot-grid, and graph templates, zoom in far enough to confirm that the ordinary glyph body sits immediately above the pattern anchor, the one-pixel rule extends downward, and descenders cross it naturally. Confirm consecutive bullets use the same line-height as ordinary text and that the block after a list still lands on the grid. Confirm each built-in supplies a readable highlight background and foreground in both views.

In Live Preview, click near the beginning, middle, and end of visible paragraph and heading text after zero, one, and several source blank lines. Type a unique character and confirm it appears at the clicked glyph rather than on an adjacent source line, then undo it. Repeat once with a baseline-enabled template and once with a blank/free-layout template. Any generated vertical margin on a CodeMirror `.cm-line` is a regression even if the page appears visually plausible.

In pageless Reading view, confirm the paper pattern and optional margin line remain visible over the full content height. This protects the isolated stacking context that keeps negative-z-index paper layers above the solid page background.

Spot-check the extended features in both views: H5/H6 rendering, heading letter spacing/text transform and drop caps, list markers and indentation guides, divider styles, striped tables, callout variants (`!warning` etc.), image float/object-fit/duotone, and the watermark (confirm it sits behind the text and never intercepts pointer events). Test callouts on both light and dark paper while a host theme supplies non-normal callout blending; Templar's explicit palette must remain visible. Verify all nine patterns — blank, ruled, dot-grid, graph, ledger, cross-hatch, diagonal, hex, and scallop — in both view adapters. Cross-hatch must visibly contain two continuous directions, diagonal one continuous direction, hex a complete repeating lattice, and scallop staggered outlines. Repeat the decorative checks at extreme `pattern-scale` values and with a margin line in pageless and paged modes.

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
11. In strict and balanced ruled/graph templates, place prose after a table, Mermaid diagram, callout, note embed, and resizable media block. Compare Reading and Live Preview before and after each async renderer settles: the first following text baseline must land on the nearest non-overlapping ruled row. Add zero, one, and three explicit empty source lines after each block and confirm those rows remain visible in addition to the measured correction. Repeat once near an A4/Letter page boundary; inspect the console while resizing and require zero ResizeObserver-loop warnings. The whole `.markdown-preview-section` document root and frontmatter UI must never receive `templar-grid-snap-block`.
12. Use a body-font sample containing `agpqy` and toggle Source Mode → Live Preview → Reading View at the same location in strict/balanced ruled and graph templates. Ordinary lowercase bottoms must meet the active rule, descenders must cross below it, and the pattern/text relationship must not jump by one row. Confirm the first Reading spacer count starts after the closing YAML delimiter, not on it. Repeat with at least two fonts, two grid units, and paged/pageless layouts.
13. Close preview/inspector/sidebar/leaf and unload the plugin while work is pending. Confirm temporary styles, frames, observers, listeners, print CSS, and draft state are released.

## Mobile release gate

The code is designed for mobile but release claims require evidence. The policy is explicit:

- A prerelease may ship while a physical-device check is pending only when desktop automated gates and mobile static/build gates pass, the missing check is listed in the release note, and the release remains clearly marked prerelease.
- A stable or Community Plugins candidate must have recorded physical iOS and Android smoke results with device, OS, Obsidian version, and outcome before publication.

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
4. Run `npm audit --audit-level=moderate` and `npm audit --omit=dev --audit-level=moderate`.
5. Run `npm run verify:release -- <exact-version>` and `npm run verify:ship -- <exact-version>`; the latter is the authoritative local ship gate.
6. Complete and record the manual desktop/mobile verification. A prerelease may ship with clearly documented physical gates pending; a community-directory-ready stable release may not.
7. Commit and push the release state.
8. Create and push a tag that exactly matches `manifest.json`, without a `v` prefix (for example, `1.1.0` or `1.1.0-alpha.2`).
9. Wait for the release workflow and verify the draft/published release contains `main.js`, `manifest.json`, `styles.css`, and `SHA256SUMS.txt`.

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
