# Developer reference and handoff

This is the current implementation reference for Templar. It is deliberately more operational than the landing-page README: a future contributor should be able to use this document to find the source of a behavior, understand the persistence contract, run the release gates, and identify the remaining alpha limitations.

## Current snapshot

| Item | Current value |
| --- | --- |
| Product | Templar, an Obsidian plugin that gives each Markdown note a portable visual page style |
| Repository | [`K0g1/Templar`](https://github.com/K0g1/Templar) |
| Current release | `1.2.0-alpha.1` (UX expansion prerelease) |
| Minimum Obsidian version | `1.8.0` |
| Runtime target | Browser APIs only; `isDesktopOnly: false` |
| Installation channel | Manual release artifacts; not listed in Community Plugins yet |
| Built-in catalog | 132 styles: 28 hand-tuned core styles plus 104 data-driven pack styles |
| Themed packs | 13 folders/packs, including Essentials, Color Stories, Seasons, Celebrations & Occasions, Academia, Professional, Journaling & Wellness, Travel, Nature, Vintage & Editorial, Dark & Neon, Fantasy & Whimsy, and Pastels |
| Template format | Version 1 (`templar-template` exports and `templar` note frontmatter) |
| Test status at this snapshot | 76 Vitest tests; `npm run check` and `npm audit` are the required gates |

`1.2.0-alpha.1` adds leaf-scoped live try-on, a note inspector, provenance-aware synchronization, event-driven rules and usage, print preparation, template packs, keyboard-first/density-aware browsing, expanded context-sensitive commands, deterministic one-click apply, and the horizontal-rule baseline correction. The release note is [`releases/1.2.0-alpha.1.md`](releases/1.2.0-alpha.1.md).

### Source-of-truth rules

When the local checkout and a remote copy disagree, inspect the local checkout first. For this project, the local source supplied for the task is authoritative until the maintainer deliberately reconciles and commits it upstream. Within the checkout:

1. `src/` is the editable runtime source.
2. `tests/`, schema validation, and the persisted-format serializer define executable contracts.
3. `manifest.json`, `package.json`, and `versions.json` define release metadata together.
4. `main.js` is generated; never hand-edit it.
5. Release notes are historical records. Do not rewrite an older release note to describe a later change; add a new release or an **Unreleased** entry.
6. This document describes the current behavior, while [`ARCHITECTURE.md`](ARCHITECTURE.md), [`TEMPLATE_SPEC.md`](TEMPLATE_SPEC.md), [`PAGED_LAYOUT.md`](PAGED_LAYOUT.md), and [`SECURITY.md`](SECURITY.md) remain the normative deep references for their respective contracts.

## User-facing feature map

### Library and folders

- **Page Styles view:** a ribbon icon or **Open page styles** command opens a sidebar with Current Note plus Recent, Favorites, Built-in, and My Styles sections.
- **Folders:** each style has a portable, single-level display folder. Folder names are not vault directories. Missing or invalid names become `Unfiled`; matching is case-insensitive and preserves the first display spelling. Slashes, backslashes, control characters, and filesystem-reserved characters are flattened during normalization.
- **Search:** the library searches name, description, author, folder, and tags. Search and folder selection can be combined.
- **Personal relevance:** Recent stores the latest 10 unique successful user applies; Most Used and folder relevance come from currently styled notes' source IDs. Preview/click activity never increments them.
- **Cards and previews:** cards use CSS-only swatches in Compact, Comfortable, and Gallery modes. Clicking the card body previews through the production renderer on only the originating leaf; Apply is separate. One preview exists per owner and stale async work is generation-guarded.
- **Keyboard:** `/` focuses search; roving arrows/Home/End navigate filtered cards; Space previews; Enter applies; F toggles favorite; Escape cancels preview, then clears search, then leaves a folder, one level per press.
- **Built-in/custom distinction:** built-ins are immutable. Customize or duplicate creates a settings-backed custom copy. Notes remain self-contained, but apply records a source snapshot so changes become reviewable rather than silently live-linked.
- **Card actions:** visible Apply uses deterministic one-click behavior. Overflow contains Preview, Apply with page options, create-note, edit/customize, duplicate, export, and custom-only delete. Folder/arbitrary selection can export `.templar-pack` files.

### Applying styles and creating notes

The same operations are available from the Page Styles view, settings, the command palette, and (where applicable) the editor menu:

| Operation | Behavior |
| --- | --- |
| Choose page style… | Fuzzy-pick and immediately apply a built-in or custom style using normal one-click behavior. |
| Apply default page style | Applies the configured default template, falling back to `classic-ruled` if the configured ID is unavailable. |
| Create styled note… | Picks a style, asks for a vault-relative title/folder, creates a Markdown file, and writes its style frontmatter. Missing vault folders are created. |
| Change page mode… | Changes only the active note's page options; the visual template remains the same. |
| Remove page style | Deletes only `frontmatter.templar`; Markdown and unrelated frontmatter remain. |
| Apply page style to multiple notes… | Targets the current note, the current folder recursively, notes with a tag, or the entire vault. It can preserve each note's mode or set pageless/paged and A4/Letter. A confirmation is required. |
| Open page styles | Opens/reveals the library sidebar. |
| Focus style search | Opens/reveals Page Styles and focuses search. |
| Customize current note | Opens the note-only draft inspector; available only for styled notes. |
| Apply last used style | Applies the most recently successfully applied template. |
| Next/previous favorite style | Starts or advances a temporary favorite preview. |
| Apply/cancel style preview | Commits or restores the active preview; context-sensitive. |
| Toggle paged / pageless | Preserves design and recalls existing paged settings. |
| Toggle fit narrow screens | Toggles scaling for a paged note only. |
| Review template updates | Opens synchronization management. |
| Manage style rules | Opens the ordered rule manager. |
| Print / export styled note | Settles renderer/fonts/images/pagination, then invokes host print. |

The active-note card exposes Customize, page settings, print, update review, raw edit, and removal. The editor context menu adds apply, note customization, and removal. Commands use Obsidian availability callbacks so impossible contextual actions are disabled instead of showing routine errors.

One-click apply preserves all page options and attachments on a styled note. An unstyled note uses `defaultNewPageFlow` (`pageless`, `paged-a4`, or `paged-letter`; default `pageless`). **Apply with page options…** retains the explicit exceptional path.

### Note state, synchronization, and automation

- Current Note distinguishes Normal, Applied, Previewing, Modified, Update available, their combined state, and Source missing. Missing sources never affect ordinary rendering.
- The inspector edits a draft copy live and writes once on Save. Reset Section uses the current source where available, or the opening state for a missing source; Discard restores the opening style.
- Synchronization compares the note design, its embedded source snapshot, and the current library source. Clean notes replace safely; modified notes can recursively three-way merge unchanged fields, replace, or skip; legacy notes do not claim a safe merge.
- Ordered style rules support folder (optional descendants), normalized tag, filename starts/ends/contains/exact, and simple frontmatter equality. Conditions within a rule are AND; the first enabled match wins. Automatic triggers react to vault/metadata events and only style unstyled Markdown notes.
- Existing-note rule application is a dry-run plus explicit chunked bulk action. Synchronization/bulk confirmation reports exact safe/merge/replace/skip or eligible/styled/invalid counts.

### Template authoring and portability

- **Simple mode:** high-signal choices for paper, typography, baseline, image frame, page flow, and other common decisions.
- **Detailed mode:** edits the structured v1 fields, including all nine paper patterns, margin controls, H1–H6, lists, dividers, tables, callouts/variants, embeds, image float/object-fit/duotone, watermark, and page settings.
- **Advanced mode:** shows the normalized YAML and scoped custom CSS contract. The generated YAML can be copied without saving.
- **Live preview:** creator and import dialogs use the production compiler in an isolated preview scope and can toggle paged/pageless preview.
- **Import page style…:** accepts a complete `.templar`/YAML document, validates it, previews it, and saves only after explicit confirmation.
- **Pack import/export:** `.templar-pack` carries metadata and multiple complete templates. Members are selected and validated independently; custom conflicts offer keep/replace/copy and built-in conflicts can only keep or import a custom copy. Full preview remains on-demand for one member.
- **Export:** each library card can export a portable `.templar` document into a visible `Templar Templates/` vault folder. The page section is removed because page flow is note-specific.
- **Raw Page Style editor:** edits only the active note's normalized `templar` mapping; it preserves the Markdown body and all other frontmatter.
- **LLM authoring kit:** **Copy LLM template authoring skill** copies the versioned schema/safety instructions to the clipboard. Settings can also export it as a Markdown file in the vault. Templar never calls an AI service.
- **Attachment overrides:** a note can override an embedded image's frame, rotation, or pixel width by filename under `templar.attachments` without changing Markdown or the original file.

### Visual system

Every template is structured data first, with optional safe virtual CSS. The supported controls are:

| Area | Supported behavior |
| --- | --- |
| Paper | Blank, ruled, dot-grid, graph, ledger, cross-hatch, diagonal, hex, and scallop patterns; paper/pattern/major colors; opacity and scale; dot radius; graph-major interval; optional margin line, color, and offset. |
| Baseline | Enabled/disabled; strict, balanced, or free rhythm; grid unit; image snapping. Body, heading, and code fonts are measured in the active browser. |
| Typography | Body font/size/weight/color, muted text color, automatic or explicit line height, Reading-only first-line indent, and drop cap. |
| Headings | Independent H1–H6 font, size, weight, color, decoration (none/underline/rule/highlight), letter spacing, and text transform. |
| Lists | Unordered marker style and color, nested-list indentation, and optional indentation guides. Reading-only indentation is intentional because Live Preview virtualizes each line. |
| Layout | Maximum content width, four paddings, page radius, and page shadow. Paged mode replaces responsive horizontal padding with fixed page padding. |
| Images | Nine frames, border/corner/shadow controls, rotation, max width, spacing, opacity, sepia/grayscale/saturation/contrast, left/right float, object-fit, and duotone. |
| Blocks | Links, paired highlight background/text colors, quote accent/background/text, code palette/font/size, table borders/header/body/stripes/padding, checkbox accent, divider style, callout base palette and per-type variants, and embed palette/radius. |
| Watermark | Optional text behind content with color, size, rotation, and opacity. It is non-interactive. |
| Custom CSS | Up to 50 KB, parsed and validated, rooted only at `.page` or `.page-content`, expanded to Reading/Live Preview equivalents, and keyframe-namespaced per note. |

In strict/balanced baseline modes, every Markdown horizontal rule occupies exactly one grid unit in Reading and Live Preview. Its centered visible stroke is render-clamped when necessary; all divider styles keep the same vertical footprint and persisted widths remain unchanged.

The complete YAML field contract and numeric ranges are in [`TEMPLATE_SPEC.md`](TEMPLATE_SPEC.md). Paged geometry and the page-break algorithm are in [`PAGED_LAYOUT.md`](PAGED_LAYOUT.md).

## Persistence and compatibility

### Note frontmatter

The complete note style lives under one top-level property:

```yaml
templar:
  version: 1
  style-name: My style
  template-id: my-style
  source-template-id: my-style
  metadata: { ... }
  paper: { ... }
  baseline: { ... }
  typography: { ... }
  headings: { ... }
  lists: { ... }
  layout: { ... }
  images: { ... }
  blocks: { ... }
  watermark: { ... }
  provenance:
    source-snapshot: { ...complete normalized reusable template... }
    applied-by-rule: { id: research-notes, name: Research Notes }
  page:
    mode: pageless
    size: a4
    width: 794
    height: 1123
    gap: 32
    scale-to-fit: true
  css: ''
```

`FrontmatterService` reads MetadataCache with a small optimistic write-through map, then writes with `FileManager.processFrontMatter()`. It replaces only `frontmatter.templar`; unrelated properties and the Markdown body are preserved. Applying another template preserves page and attachments unless explicit page options are supplied. `removeStyle()` deletes that property. Metadata-cache, rename, and delete events settle or move the optimistic entry.

Reusable exports use `templar-template` and omit `page`, `attachments`, and `provenance`. Import accepts `templar-template`, `templar`, or the inner mapping. Packs use a versioned `templar-pack` wrapper and an array of the same normalized template mappings. `normalizeTemplate()` accepts persisted kebab-case aliases and internal camel-case form, fills defaults for older v1 styles, clamps bounded values, drops unknown fields, and normalizes folder labels. `normalizeNoteStyle()` adds note page options, attachment overrides, and provenance.

There is no separate migration file. Backward compatibility is implemented at normalization/serialization boundaries. A schema addition is not complete until it has defaults, aliases, validation, round-trip tests, and an update to [`TEMPLATE_SPEC.md`](TEMPLATE_SPEC.md) and the authoring kit.

### Plugin `data.json`

Only global settings and custom library entries live in Obsidian's plugin data:

| Key | Default | Meaning |
| --- | --- | --- |
| `enableReadingView` | `true` | Compile styles in Reading View. |
| `enableLivePreview` | `true` | Compile styles while editing in Live Preview. |
| `hideStyleMetadata` | `true` | Collapse only the root `templar:` YAML block in CodeMirror. |
| `defaultTemplateId` | `classic-ruled` | Template used by **Apply default page style**. |
| `defaultGridUnit` | `30` | Starting rhythm for newly created styles. Existing notes retain their embedded unit. |
| `fontCacheSize` | `64` | Maximum measured font combinations retained by the bounded cache. |
| `favouriteTemplateIds` | `[]` | Favorite style IDs. |
| `recentTemplateIds` | `[]` | Latest 10 unique templates successfully applied by the user. |
| `defaultNewPageFlow` | `pageless` | Deterministic page flow for applying to an unstyled note. |
| `libraryDensity` | `comfortable` | Persistent Compact/Comfortable/Gallery card layout. |
| `styleRules` | `[]` | Ordered event-driven automatic style rules. |
| `userTemplates` | `[]` | Normalized custom templates, including customized built-ins. |

Settings loading uses `normalizeSettings()` to merge defaults, normalize templates and rules, validate enum choices, and sanitize favorite/recent IDs. **Reset all settings** restores defaults, clears favorites/recents/rules, and deliberately keeps `userTemplates`.

The settings page also exposes the library, creator, importer, a baseline diagnostic preview for the configured default style, a font-cache clear action, the active-note validation issues (when a styled note is open), the virtual-selector reference, and the authoring-kit copy/export actions.

### Folder semantics

The folder value is display metadata, not a path. `normalizeTemplateFolder()`:

- maps a missing/non-string value to `Unfiled`;
- replaces `/`, `\\`, control characters, and `< > : " | ? *` with spaces;
- collapses whitespace, trims, caps the label at 80 characters, and maps `.`/`..` to `Unfiled`.

`templateFolderKey()` performs case-insensitive, accent-preserving matching. The library keeps the first spelling it encounters for a key, and sorts `Unfiled` last. Do not use folder metadata to create vault directories.

## Runtime pipeline and lifecycle

The runtime path is:

```text
note metadata
  → FrontmatterService / normalizeNoteStyle
  → optional leaf-scoped PreviewSession override
  → PageRenderer per-leaf scope and mode
  → FontMetricsService measurements
  → compilePageStyle (structured CSS + validated custom CSS)
  → scoped style element in that Markdown leaf
  → image compensation and, for paged notes, PageLayoutService
```

### Startup and events

`src/main.ts` loads settings, constructs `FrontmatterService`, `FontMetricsService`, `TemplateLibrary`, and `PageRenderer`, then registers the view, CodeMirror metadata-hiding extension, settings tab, commands, ribbon icon, status bar (desktop), editor menu, Markdown post-processor, and workspace/vault events. Initial refresh waits for `workspace.onLayoutReady()`.

The event responsibilities are:

| Event/action | Refresh behavior |
| --- | --- |
| Active leaf or file open | Refresh visible rendering, sidebar state, and desktop status text. |
| Metadata changed | Settle optimistic frontmatter, update one usage-index entry, evaluate rules when metadata is ready, refresh the file/sidebar/status. |
| CSS/theme changed or fonts loaded | Clear font metrics and refresh all styled leaves. |
| Layout changed | Schedule a coalesced renderer refresh. |
| Vault create/rename/delete | Evaluate eligible rules or update/remove/transfer one index/frontmatter path. |
| Plugin unload/leaf cleanup | Disconnect observers, cancel frames, remove owned style/scale/break properties, and prune Reading-root section state. |

`PageRenderer` owns per-leaf generation tokens, persistent/temporary style selection, style elements, image observers, page-layout services, and Reading-root registries. Generation tokens prevent late font measurements from overwriting a newer render. Preview state belongs to a leaf and owner, never a file, so a second pane remains persistent. Reading sections are recorded during the post-processor, compacted when Obsidian marks them stale, and spacers are inserted synchronously inside their owning section so the virtual scroller retains them.

### CSS and view isolation

Each styled Markdown leaf receives a stable scope attribute and plugin-owned `.templar-page`/`.templar-page-content` classes. The generated style element is owned by that leaf. Structured CSS and imported CSS never target global workspace elements. Live Preview selectors are expanded from the public virtual vocabulary; Obsidian's internal classes are adapters, not a template authoring contract.

Paper and watermark pseudo-elements use negative z-indices inside the isolated content stacking context. This is the key invariant behind the alpha.3 fix: the pattern is below Markdown content but is not hidden behind the page's opaque background.

### Reading whitespace and baseline

The Reading post-processor derives exact source blank-line runs from current section ranges, ignoring blank lines inside fenced code. It creates owned grid-sized spacer elements synchronously and places them inside the following section. A deferred reconciliation pass handles style changes and cached Reading views. If both adjacent sections remain rendered while source whitespace changes, the new gap converges when either section is rendered again; this is an Obsidian measurement limitation, not a body rewrite.

`FontMetricsService` waits for available fonts, measures body/H1–H6/code baselines with browser geometry, and stores a bounded cache. Strict/balanced grid helpers keep block offsets on whole grid rows; code, headings, lists, and images receive complementary corrections. See [`PAGED_LAYOUT.md`](PAGED_LAYOUT.md) for the separate fixed-canvas algorithm.

Strict/balanced horizontal rules are compiled as exactly one unit in both view adapters, with zero theme margins and a centered stroke. Print preparation forces the current renderer generation, fonts, image decode, and page fitting to settle before temporary scoped `@media print`/`@page` rules invoke the host print action.

## Source map

### Application entry and contracts

| Path | Responsibility |
| --- | --- |
| `src/main.ts` | Plugin lifecycle, registrations, command routing, event coordination, notices, and status bar. Keep orchestration here. |
| `src/types.ts` | Internal template, note page, settings, validation, metrics, and compiled-style contracts. |
| `src/constants.ts` | Format/version IDs, runtime class names, custom-CSS byte limit, and public virtual selectors. |

### Templates and persistence

| Path | Responsibility |
| --- | --- |
| `src/templates/defaults.ts` | Safe default template, default note page options, and default plugin settings. |
| `src/templates/settings.ts` | Backward-compatible settings/rule/ID normalization. |
| `src/templates/schema.ts` | Kebab/camel alias handling, normalization, folder sanitation, page-option normalization, source validation, numeric/color/CSS-value validation. |
| `src/templates/note-format.ts` | Canonical internal-object ↔ readable YAML conversion for notes and `.templar` exports. |
| `src/templates/builtins.ts` | Core hand-tuned catalog, folder assignments, expanded catalog assembly, and catalog-wide readability enforcement. |
| `src/templates/packs/catalog.ts` | Compact data seeds and factory for 13 themed packs / 104 generated styles. |
| `src/templates/accessibility.ts` | Color parsing/compositing, WCAG contrast calculation, and hue-preserving readable-palette correction. |
| `src/templates/llm-kit.ts` | Versioned portable authoring instructions copied/exported by the UI. |

### Services and compilers

| Path | Responsibility |
| --- | --- |
| `src/services/frontmatter.ts` | Obsidian MetadataCache/process-frontmatter boundary and optimistic style state. |
| `src/services/template-library.ts` | Built-in/custom catalog snapshots, folder discovery, IDs, save/duplicate/remove, and favorites. |
| `src/services/preview-session.ts` | Owner/leaf-scoped draft preview sessions, frame coalescing, restore, and cleanup. |
| `src/services/synchronization.ts` | Provenance snapshots, status classification, safe replacement, legacy handling, and recursive three-way merge. |
| `src/services/style-rules.ts` | Pure rule condition matching, priority, metadata readiness, and page-flow presets. |
| `src/services/note-style-index.ts` | Lazy in-memory usage/folder index with incremental metadata/delete/rename updates. |
| `src/services/template-pack.ts` | Pack parse/export, member review, and conflict-copy IDs. |
| `src/services/print-layout.ts` | Pure `@page` size selection for pageless/A4/Letter/custom output. |
| `src/services/print-service.ts` | Renderer/font/image/page settlement, temporary print CSS, host invocation, and restoration. |
| `src/services/style-compiler.ts` | Structured template → scoped CSS, paper patterns, typography/baseline, blocks, images, watermark, metadata hiding, and page guards. |
| `src/services/css-validator.ts` | AST validation for custom CSS selectors, at-rules, values, geometry, resources, and performance hazards. |
| `src/services/css-compiler.ts` | Virtual-selector expansion, per-note scope replacement, and keyframe namespacing. |
| `src/services/page-renderer.ts` | Leaf discovery, scoped style lifecycle, font-generation guards, Reading sections/spacers, image compensation, and PageLayout ownership. |
| `src/services/page-layout.ts` | Paged scale, geometry detection, rendered-block fitting, observers, and page-break cleanup. |
| `src/services/font-metrics.ts` | Browser font loading, baseline probes, Canvas diagnostics, and bounded LRU measurements. |
| `src/services/reading-whitespace.ts` | Pure blank-line parsing and spacer construction helpers. |

### UI and editor

| Path | Responsibility |
| --- | --- |
| `src/ui/styles-view.ts` | Current Note states/actions, four library sections, search/folder/usage/density, lightweight cards, live preview, and roving keyboard navigation. |
| `src/ui/settings-tab.ts` | Rendering toggles, default style/page flow, rules, library/creator/import, diagnostics, authoring kit, selector reference, issues, and reset. |
| `src/ui/modals.ts` | Pick/apply/create/page flows, draft inspector, standalone/pack import, pack export, synchronization, rules/dry runs, raw editor, creator, chunked batch apply, and confirmation. |
| `src/ui/template-preview.ts` | Isolated sample content using the production compiler. |
| `src/ui/issues.ts` | Human-readable validation issue rendering. |
| `src/editor/hide-metadata.ts` | CodeMirror 6 line decorations for the root `templar:` YAML block; never mutates document text. |

### Utilities, tests, and tooling

| Path | Responsibility |
| --- | --- |
| `src/utils/grid.ts` | Grid fitting, heading/image correction, page-gap alignment, and geometry scale helpers. |
| `src/utils/value.ts` | Safe unknown-value coercion, enum/array handling, cloning, slugification, CSS attribute escaping, and rounding. |
| `src/utils/clipboard.ts` | Browser/mobile-safe clipboard write with a selection fallback. |
| `tests/*.test.ts` | Pure schema/catalog/CSS/compiler/grid/font/whitespace plus synchronization, rules, index, settings, packs, and print regression suites. |
| `scripts/verify-mobile-bundle.mjs` | Scans generated `main.js` for Node/Electron imports and runtime globals. |
| `scripts/verify-release.mjs` | Confirms a release tag, package/manifest/versions metadata, and matching release-notes file agree. |
| `version-bump.mjs` | Synchronizes `manifest.json` and `versions.json` from `package.json` during `npm version`. |
| `esbuild.config.mjs` | Browser-targeted production/development bundle configuration; `main.js` is generated output. |
| `.github/workflows/ci.yml` | Runs `npm ci` and `npm run check` on pushes to `main` and pull requests. |
| `.github/workflows/release.yml` | Verifies metadata, installs dependencies, runs lint/test/build, and attaches the three manual-install artifacts to a tag release. |

## Extension recipes

### Add a persisted template field

Use this order so no boundary is skipped:

1. Add the internal type in `src/types.ts`.
2. Add a safe value in `src/templates/defaults.ts`.
3. Accept both persisted kebab-case and internal camel-case aliases in `src/templates/schema.ts`; clamp values and choose enum fallbacks.
4. Serialize the field in `src/templates/note-format.ts`.
5. Add source validation and compiled behavior/UI controls.
6. Add normalization, validation, round-trip, compiler, and UI smoke coverage as appropriate.
7. Update `TEMPLATE_SPEC.md`, this reference, and `src/templates/llm-kit.ts`.
8. Decide whether the addition is a backward-compatible v1 default or requires a new schema version. Never silently reinterpret an existing v1 unit.

### Add a built-in or template pack

- Keep a released ID permanent; notes and `defaultTemplateId` depend on it.
- Prefer a compact seed and `createPackedTemplate()` in `src/templates/packs/catalog.ts` for a themed family; use `builtIn()` in `src/templates/builtins.ts` for a one-off hand-tuned design.
- Assign a stable folder and useful tags; folders are labels, not directories.
- Configure structured fields and safe virtual CSS only.
- Run the catalog identity, folder, schema/CSS, and contrast tests. Readability correction is a release invariant, not an optional aesthetic trade-off.
- Preview both page modes and inspect at least one rich Markdown note.

### Add a virtual CSS element or Obsidian adapter

The public vocabulary is declared in `src/constants.ts`. Live Preview expansion is localized to `src/services/css-compiler.ts`; root/content discovery is localized to `PageRenderer.prepareViewRoots()`. Keep Obsidian class names out of the template contract, add a focused compiler regression, and inspect Reading plus Live Preview on desktop and mobile.

### Add a command or setting

Keep command orchestration in `src/main.ts`, setting controls in `src/ui/settings-tab.ts`, and state changes in a service. A persisted setting needs a default, load normalization, save behavior, reset behavior, documentation, and a test or smoke step. Avoid default hotkeys and do not add a setting that duplicates a note-level field.

## Verification and release runbook

From the plugin root:

```bash
npm install                 # first setup; npm ci is preferred in CI
npm audit                   # zero known vulnerabilities is the release expectation
npm run lint                # Obsidian-aware ESLint
npm test                    # 76 pure Vitest tests at this snapshot
npm run build               # strict tsc, production browser bundle, mobile guard
npm run check               # lint + test + build
npm run verify:mobile       # scan the generated main.js directly
npm run verify:release -- 1.2.0-alpha.1
git diff --check
```

`npm run dev` starts the esbuild watcher and emits a development bundle. Production/manual-install artifacts are produced by `npm run build`: `main.js`, `manifest.json`, and `styles.css`. The source repository ignores `main.js`, but a release and a local vault install require all three files.

### Local live-vault smoke test

Use a disposable or backed-up vault. After `npm run build`, copy the three artifacts into the vault's plugin folder and reload Obsidian:

```bash
VAULT_PLUGIN_DIR="/path/to/vault/.obsidian/plugins/templar"
mkdir -p "$VAULT_PLUGIN_DIR"
cp main.js manifest.json styles.css "$VAULT_PLUGIN_DIR/"
```

The current development setup uses a vault named **Lightweight Vault**. The path is machine-specific; do not hard-code it into source or release automation. Verify the copied artifact hashes if a live test appears to be running an older build.

### Release sequence

1. Use `npm version <exact-version> --no-git-tag-version`; the version script synchronizes `manifest.json` and `versions.json`.
2. Move shipped entries from **Unreleased** into a dated `CHANGELOG.md` heading and add `docs/releases/<exact-version>.md`.
3. Run `npm audit`, `npm run check`, `npm run verify:release -- <exact-version>`, and `git diff --check`.
4. Complete the desktop Reading/Live Preview and mobile/emulation smoke gates; record pending physical-device gates in the release notes when shipping an alpha.
5. Commit and push the release state.
6. Create and push a tag that exactly equals the manifest version and has no `v` prefix.
7. Confirm the release workflow publishes `main.js`, `manifest.json`, and `styles.css`, and mark hyphenated prereleases as prereleases.

Never repoint an existing release tag. If a released artifact is wrong, increment the prerelease suffix and publish a corrective release.

## Known limitations and intentional behavior

- Templar is alpha software and manual-install only; it is not searchable in Obsidian's Community Plugins browser.
- Physical iOS and Android release smoke testing is still a maintainer gate. The bundle guard and responsive CSS are automated checks, not proof of every device behavior.
- A style is a self-contained snapshot copied into each note. Changing a source never changes notes automatically; provenance makes explicit review/merge/replace possible. Older notes without provenance receive conservative legacy choices.
- Folder organization is one display level. It does not create or infer vault folders, and folder separators are flattened.
- Reading View blank-line spacing is exact at section render time. If both adjacent sections remain cached while only the number of blank lines changes, convergence waits for one of those sections to render again.
- Live Preview is virtualized. Page fitting handles rendered lines/widgets and deliberately does not split one giant widget across sheets.
- Custom CSS cannot target global Obsidian UI, root/page geometry, viewport/container/environment units, or resources/URLs. Use structured fields for page geometry and portable virtual selectors for note content.
- Paged mode preserves a fixed layout width and scales the whole sheet. When **Fit narrow screens** is disabled, a narrow pane may scroll horizontally by design.
- Built-in palette correction enforces readable text/interactive surfaces. A custom import may still produce warnings or reduced readability if its colors rely on unsupported compositing or browser-specific values.
- Obsidian's internal DOM adapters can change between app releases. Adapter changes should be localized and tested against the minimum supported version where possible.
- Printing uses the host browser/Obsidian capability. Platforms without a supported print action may leave the command unavailable; custom physical page sizes remain subject to the system print driver.

## Documentation maintenance checklist

When behavior changes, update the narrowest normative document and this handoff summary:

- user-visible behavior or installation → `README.md`;
- schema, YAML, migration, or selector contract → `docs/TEMPLATE_SPEC.md` and `src/templates/llm-kit.ts`;
- renderer, lifecycle, CSS isolation, or service ownership → `docs/ARCHITECTURE.md`;
- paged geometry or pagination → `docs/PAGED_LAYOUT.md`;
- trust boundary or dependency policy → `docs/SECURITY.md` and root `SECURITY.md` if the reporting policy changes;
- tests, smoke matrix, release artifacts, or versioning → `docs/MAINTAINER_GUIDE.md`, `CONTRIBUTING.md`, and release notes;
- current counts, source map, commands, limitations, or handoff state → this file and `docs/README.md`.

Before handing work to another agent:

1. run `git status --short` and describe any intentional dirty files;
2. record the source commit/tag and whether `main.js` was rebuilt;
3. run the required checks or clearly record the first failing command;
4. state which docs and tests were updated;
5. do not include private vault notes, `data.json`, credentials, or generated screenshots without their intended license/context.
