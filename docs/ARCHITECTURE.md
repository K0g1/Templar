# Architecture

## Design goals

Templar is a rendering adapter around ordinary Markdown. It owns neither note content nor Obsidian's global interface. Its responsibilities are:

1. normalize and persist one versioned style object;
2. validate and compile a stable virtual CSS vocabulary;
3. attach the compiled design to only the corresponding Markdown view;
4. calculate baseline and page-layout metrics from the actual browser environment;
5. expose safe library/editor/import workflows.

## Runtime data flow

```text
Markdown frontmatter
      │ MetadataCache / optimistic write-through
      ▼
FrontmatterService ── normalizeNoteStyle()
      │
      ▼
PageRenderer ─────── FontMetricsService
      │                      │
      │                      └─ measured body + heading baselines
      ▼
compilePageStyle()
      ├─ structured module CSS
      └─ validateCustomCss() → compileCustomCss()
                                   ├─ virtual selector mapping
                                   └─ keyframe namespacing
      │
      ▼
one scoped <style> in one Markdown view
      │
      ├─ Image grid compensation
      └─ PageLayoutService (paged only)
```

Library templates enter the same path after being copied into a note. Preview UI enters the same compilers with an isolated preview scope.

## Entry point

`src/main.ts` owns plugin lifecycle and registration. It:

- loads normalized settings;
- constructs services;
- registers the sidebar view, CodeMirror extension, settings tab, commands, ribbon, menus, post-processor, and lifecycle-safe events;
- defers initial rendering until `workspace.onLayoutReady()`;
- coordinates user notices and view refreshes.

It must remain orchestration code. Parsing, compilation, persistence, and complex UI belong elsewhere.

## Data model

`src/types.ts` defines two related objects:

- `TemplarTemplate`: reusable design data. It intentionally has no page mode.
- `TemplarNoteStyle`: a complete template copy plus note-only `page`, optional attachment overrides, and source-template metadata.

This separation guarantees that paged/pageless is a note choice. The same template renders in both modes.

`src/templates/defaults.ts` contains safe fallbacks. `schema.ts` accepts kebab-case persisted keys and camel-case internal keys, clamps bounded numeric values, and fills missing v1 properties. `note-format.ts` is the only canonical conversion between internal objects and readable YAML objects.

## Frontmatter boundary

`FrontmatterService` reads parsed metadata and writes through `FileManager.processFrontMatter()`. It maintains a small optimistic map because MetadataCache updates after the filesystem operation. This lets the active view render immediately without reading or rewriting the note body.

The service exposes:

- `getStyle()` / `hasStyle()`;
- `applyTemplate()`;
- `writeStyle()`;
- `removeStyle()`;
- cache settlement for metadata, rename, and delete events.

No UI class should hand-edit YAML text for persistence.

## CSS trust boundary

Structured properties are compiled by `style-compiler.ts`. All user-controlled scalar CSS values pass through a conservative declaration-value guard before interpolation.

Advanced CSS follows a separate pipeline:

1. `postcss` parses the stylesheet.
2. `postcss-selector-parser` verifies each ordinary selector.
3. `css-validator.ts` rejects unsupported/global/dangerous constructs.
4. `css-compiler.ts` replaces `.page`/`.page-content` roots with the unique note scope and plugin-owned page classes.
5. Virtual element selectors expand to Reading and Live Preview equivalents.
6. Keyframes receive a note-specific prefix and animation declarations are rewritten.

Invalid advanced CSS is omitted from rendering and reported as human-readable issues; structured style modules still render.

## View scoping

Each Markdown leaf receives:

```text
data-templar-scope="templar-<stable-path-hash>"
data-templar-file="path/to/note.md"
data-templar-mode="pageless|paged"
```

The renderer adds `.templar-page` to the active Reading/Live Preview surface and `.templar-page-content` to its content box. Generated CSS starts with the exact scope attribute. Even two panes showing differently styled notes remain isolated.

The style element is a direct child of the leaf's content root and is removed when the style disappears, the leaf closes, or the plugin unloads.

## Rendering services

### FontMetricsService

- Waits for `document.fonts.load()` where available.
- Creates an invisible inline marker whose bottom border-box edge is the browser's real baseline within the requested line box.
- Uses Canvas text metrics for ascent/descent diagnostics.
- Caches family/size/weight/line-height/device-scale combinations with a bounded LRU policy.
- Measures body, H1–H6, and fenced-code typography separately.

The compiler derives one paper coordinate system from the measured body baseline plus the effective content padding. Ruled strokes, dot centers, and graph intersections share that origin in both page modes. A ruled stroke begins at the baseline and paints downward, keeping normal glyph bodies above the line while allowing descenders to cross it.

The rhythm compiler never emits a fractional-grid block offset in a gridded mode: strict reserves one extra grid row, balanced reserves none, and list items explicitly inherit the body line-height with theme list padding neutralized. Consequently, every following block remains congruent with the paper pattern.

Heading padding makes the heading baseline congruent with the body baseline modulo the grid and adds complementary padding so the total remains a grid multiple. Structured block colors also compile explicit background and foreground colors for Markdown highlights, covering Reading View's `mark` and Live Preview's highlight spans without inheriting theme defaults.

Reading code blocks use the same complementary baseline-padding calculation as headings, but retain a configurable monospace font. `reading-whitespace.ts` provides the pure helpers for source blank lines that standard Markdown normally collapses: `internalBlankLineRuns` counts runs inside a section while ignoring fenced-code bodies, `blankLinesBetweenSections` derives the inter-section gap from exact line ranges, and `createBlankLineSpacer` builds the owned grid-sized element. `PageRenderer` owns the reconciliation policy:

- **Synchronous insertion inside the post-processor.** Obsidian's Reading View renders a section, runs post-processors, attaches the section to the sizer, measures its height, and paints — all within one task. Inserting spacers during the post-processor therefore puts them in the DOM before the first paint (no flash) and before the height measurement (the virtual scroller's stored heights always include the spacers, so its layout model never drifts).
- **Spacers live inside section elements, never in the sizer.** Obsidian's virtual scroller owns the sizer's direct children: it calls `setChildrenInPlace` on every render pass and scroll and *removes* any child it does not list. A spacer that is the first child of the section below its gap is invisible to that bookkeeping, survives scrolling (detach/attach cycles travel with the section), and survives cached-view reuse.
- **Fresh ranges from the renderer, not from stale registries.** `context.getSectionInfo(element)` resolves any element — attached or detached — against Obsidian's live section objects, which are updated at every parse. The Reading root stashes the last post-processor context so deferred passes get the same fresh lookups. The function returns the whole note text; `PageRenderer` slices the section's own line range for internal blank-line runs.
- **One deferred pass remains.** Style changes and cached Reading Views do not re-run post-processors, so `refreshFile` schedules a single animation-frame reconcile for those paths. Because spacers are inside section elements, this pass cannot be wiped and does not flicker.

Two residual behaviors follow from Obsidian's measurement model (heights are re-measured only when a section re-renders): a gap count that changes while both adjacent sections stay rendered (for example, adding a blank line without touching either section's content) converges on the next re-render of either section, and a section measured before such a change drifts by at most the gap delta until then. Spacers are grid-sized, participate in pagination, and are removed during leaf cleanup.

### PageRenderer

- Enumerates current Markdown leaves rather than holding view instances.
- Uses a per-leaf generation number to prevent an old async font measurement from overwriting a newer render.
- Adds/removes classes and the owned style element.
- Configures image and page-layout observers.
- records validation issues per file for settings diagnostics.
- Per Reading root, tracks the post-processor context and a source-ordered section list (including temporarily detached virtual-scroller elements) that feeds blank-line reconciliation; discarded sections are compacted after `getSectionInfo` marks them stale, and replaced roots are pruned with their scheduled frames.

### Image compensation

A `ResizeObserver` measures rendered image boxes. In strict/balanced gridded modes, it adds only the missing bottom space needed to reach the next grid multiple. Original image files are untouched.

### PageLayoutService

Paged notes are described fully in [`PAGED_LAYOUT.md`](PAGED_LAYOUT.md). The service owns scale calculation, rendered-block page breaks, DOM observers, animation-frame coalescing, and cleanup.

## Editor metadata hiding

`src/editor/hide-metadata.ts` is a CodeMirror 6 view plugin. It identifies only the root `templar:` YAML range and adds line decorations. CSS collapses those decorated lines when the setting is enabled.

It does not mutate the editor document. The raw style command edits a normalized YAML copy in a modal, validates it, then persists through `FrontmatterService`.

## Template library

`TemplateLibrary` combines immutable built-ins and settings-backed custom templates. Returned objects are deep clones to prevent accidental shared mutation.

The built-in catalog is assembled from the original hand-tuned designs plus data-driven themed packs in `src/templates/packs/`. Pack seeds remain compact, while the factory applies shared defaults and a catalog-wide readability pass. Folder metadata is a portable, single-level label—not a vault directory—and comparisons are case-insensitive while preserving the first display spelling.

- Saving normalizes and validates.
- Editing a built-in first duplicates it; customizing always writes a new `-custom` id, which is what "reset to default" removes.
- Favorites are a settings-level list of template IDs; `remove()` also prunes them.
- IDs are stable, slugged, and uniquified.
- Deleting a library entry does not touch notes because notes contain full copies.

The Page Styles view takes one catalog snapshot per shell render, indexes its search strings and folder counts once, and renders folder summaries by default. Search input is coalesced to one animation frame, and only the selected/searched result cards enter the DOM. This keeps the 132-style catalog inexpensive without compiling full note previews for every card; cards use CSS-only paper swatches and the production preview remains on demand.

## UI modules

- `styles-view.ts`: searchable, folder-organized sidebar library with Favorites / Built-in styles / My custom styles sections, plus active-note controls.
- `settings-tab.ts`: global behavior, library/creator entry points, baseline diagnostics, authoring kit, selector reference, and the reset-all-settings flow.
- `modals.ts`: selection, application, page mode, new note, creator (including reset-to-default for built-ins), raw YAML, import, batch, and confirmation flows.
- `template-preview.ts`: isolated sample document that uses the production compiler.
- `issues.ts`: consistent human-readable validation output.

UI builds elements through DOM/Obsidian helpers; it never renders imported strings as HTML.

The Template Creator has three levels: Simple for common choices, Detailed for the full structured schema, and Advanced for scoped CSS/YAML inspection. Detailed mode intentionally edits structured fields so the same result remains safe and portable on mobile.

## Settings persistence

Only global preferences and custom library templates live in plugin `data.json`. Note styles never depend on `data.json`.

Current settings:

- Reading view enabled;
- Live Preview enabled;
- Templar YAML hidden;
- default template ID;
- default creator grid unit;
- font cache capacity;
- favorite template IDs;
- custom templates.

`loadSettings` merges defaults with persisted data and normalizes arrays, so new fields (such as favorites) migrate without a settings migration step. Resetting all settings mutates the settings object in place — the `TemplateLibrary` holds a reference to it — while preserving `userTemplates`.

## Adding a feature

Choose the narrowest layer:

- new persisted property: types → default → normalize → serialize → validate → compile/UI → tests/docs;
- new visual module: types/defaults/schema plus a focused compiler function;
- new Obsidian DOM mapping: `css-compiler.ts`, with selector regression tests;
- new per-view behavior: a cleanup-owning service configured by `PageRenderer`;
- new library action: service method first, UI trigger second;
- new note mutation: `FrontmatterService`, never a modal-local file rewrite.
