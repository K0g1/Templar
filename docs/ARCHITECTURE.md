# Architecture

For the current alpha snapshot, complete command/settings inventory, source map, release runbook, and known-limitations handoff, see [`DEVELOPER_REFERENCE.md`](DEVELOPER_REFERENCE.md). This document remains the detailed runtime and ownership contract.

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
SettingsStore ── durable settings transactions
      │
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
      ├─ measured paper origin
      ├─ image/variable-block grid compensation
      └─ PageLayoutService (paged only)
```

Library templates enter the same path after being copied into a note. `PreviewSessionService` installs a leaf-local renderer override, so try-on and inspector drafts use this exact production path without changing frontmatter or other panes showing the same file.

Metadata-driven workflow services sit beside the renderer rather than inside it:

```text
MetadataCache events ── NoteStyleIndex ── usage/folder/update counts
                    └── StyleRules ───── first eligible rule for unstyled notes

Library snapshot + note provenance ── Synchronization ── status/merge/replace
Untrusted YAML/pack ── Schema + CSS validation ── accepted library templates
StyleApplicationService ── note write + index + refresh
Renderer settled state ── PrintService ── temporary print scope → host print
```

## Entry point

`src/main.ts` is the composition root. It:

- loads normalized settings;
- constructs services;
- registers the sidebar view, CodeMirror extension, settings tab, ribbon, menus, post-processor, commands through `src/commands/register.ts`, and events through `src/events/register.ts`;
- defers initial rendering until `workspace.onLayoutReady()`;
- coordinates user notices and view refreshes.

It must remain orchestration code. Parsing, compilation, persistence, and complex UI belong elsewhere.

## Data model

`src/types.ts` defines two related objects:

- `TemplarTemplate`: reusable design data. It intentionally has no page mode.
- `TemplarNoteStyle`: a complete template copy plus note-only `page`, optional attachment overrides, and provenance containing the source snapshot and optional rule attribution.

This separation guarantees that paged/pageless is a note choice. The same template renders in both modes.

`src/templates/defaults.ts` contains safe fallbacks. `schema.ts` accepts kebab-case persisted keys and camel-case internal keys, clamps bounded numeric values, and fills missing v1 properties. `note-format.ts` is the only canonical conversion between internal objects and readable YAML objects.

## Frontmatter boundary

`FrontmatterService` reads parsed metadata and writes through `FileManager.processFrontMatter()`. It maintains a per-file serialized queue, generation-aware optimistic state, and last-committed snapshot because MetadataCache updates after the filesystem operation. This lets the active view render immediately without reading or rewriting the note body; stale metadata events cannot clear a newer result.

The service exposes:

- `getStyle()` / `hasStyle()`;
- `applyTemplate()`;
- `writeStyle()`;
- `removeStyle()`;
- cache settlement for metadata, rename, and delete events.

Applying a template always preserves attachment overrides. Ordinary one-click apply also preserves every existing page option; unstyled notes use the global default page flow. A source snapshot is embedded at apply time so later synchronization can distinguish source changes from local design edits.

No UI class should hand-edit YAML text for persistence.

## CSS trust boundary

Structured properties are compiled by the pure modules under `src/services/style-compiler/`, with `index.ts` owning stable output ordering and `style-compiler.ts` remaining a compatibility barrel. All user-controlled scalar CSS values pass through a conservative declaration-value guard before interpolation.

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
data-templar-scope="templar-leaf-<runtime-sequence>"
data-templar-file="path/to/note.md"
data-templar-mode="pageless|paged"
```

The scope value is a collision-free, runtime leaf token (`templar-leaf-<sequence>`), not a file-path hash. The renderer adds `.templar-page` to the active Reading/Live Preview surface and `.templar-page-content` to its content box. Generated CSS starts with the exact scope attribute. Two panes remain isolated even when they show the same file and only one pane owns a temporary preview.

The style element is a direct child of the leaf's content root and is removed when the style disappears, the leaf closes, or the plugin unloads.

`DomRealm` derives observers, animation frames, timers, and cross-window constructor checks from the target content element. This is required for pop-out windows, whose `Window`, `Document`, and DOM constructors are distinct from the main workspace.

## Rendering services

### FontMetricsService

- Waits for `document.fonts.load()` where available.
- Creates an invisible inline marker whose bottom border-box edge is the browser's real baseline within the requested line box.
- Records the browser's actual rendered line-box height when a font's ascent/descent expands it beyond the requested CSS line-height.
- Uses Canvas text metrics for ascent/descent diagnostics.
- Caches family/size/weight/line-height/device-scale combinations with a bounded LRU policy.
- Measures body, H1–H6, and fenced-code typography separately.

The compiler provides a safe fallback origin, then `PageRenderer` measures the first real rhythmic text target in each attached content root and writes `--templar-paper-baseline-position` for that root. Source and Live Preview use the first ordinary CodeMirror line outside frontmatter, rules, tables, code boundaries, and renderer widgets; Reading uses the first visible heading, paragraph, list item, or code line outside Properties/frontmatter and variable-height blocks. The target's DOM position, border/padding, font-specific alphabetic baseline, CSS zoom, and grid unit define the repeating paper phase. Properties panes, inline titles, and note-specific top structure can therefore change height without shifting text relative to the ruling. While a virtual scroller has moved away from the document start, the renderer retains the established origin instead of re-anchoring to the first currently attached block. A ruled stroke begins at the measured alphabetic baseline and paints downward, keeping ordinary glyph bodies above the line while allowing descenders to cross it.

Paper and watermark pseudo-elements sit at negative z-indices inside an isolated `.templar-page-content` stacking context. This keeps them behind note content while preventing the Reading-view page background from covering pattern and margin layers.

Every paper pattern serializes parallel `background-image`, `background-size`, `background-position`, and `background-repeat` lists. Optional margin lines are inserted as a complete non-repeating layer rather than relying on CSS list-value repetition. Diagonal and cross-hatch tiles use centered edge-to-edge strokes, hex uses six anchored edge layers, and scallop uses two staggered outline layers; this prevents missing directions, corner specks, and layer-repeat drift.

The rhythm compiler never emits a fractional-grid block offset in a gridded mode: strict reserves one extra grid row, balanced reserves none, and list items explicitly inherit the body line-height with theme list padding neutralized. Consequently, every following block remains congruent with the paper pattern.

Live Preview treats CodeMirror line geometry as an editor-owned measurement contract. Generated CSS never adds vertical margins to `.cm-line` elements: ordinary block spacing remains a Reading View concern, while Live Preview headings express their visual space as border-box padding that CodeMirror can measure. This keeps pointer coordinates, the visible glyph line, and CodeMirror's height map congruent even around headings and long source blank-line runs.

In strict and balanced modes, Reading `<hr>` blocks and Live Preview `HyperMD-hr` lines own exactly one baseline unit with zero theme margins. The visible solid/dashed/dotted/double/fade stroke is centered inside that row and its rendered thickness is clamped without mutating the stored template value. Free or disabled baseline modes retain ordinary divider spacing.

Heading padding makes the heading baseline congruent with the body baseline modulo the grid and adds the remaining padding so the actual rendered line box plus padding remains a grid multiple. Structured block colors also compile explicit background and foreground colors for Markdown highlights, covering Reading View's `mark` and Live Preview's highlight spans without inheriting theme defaults.

Reading code blocks use the same measured baseline-padding calculation as headings, but retain a configurable monospace font. `reading-whitespace.ts` provides the pure helpers for source blank lines that standard Markdown normally collapses: `internalBlankLineRuns` counts runs inside a section while ignoring fenced-code bodies, `blankLinesBetweenSections` derives the inter-section gap from exact line ranges, and `createBlankLineSpacer` builds the owned grid-sized element. `PageRenderer` owns the reconciliation policy:

- **Synchronous insertion inside the post-processor.** Obsidian's Reading View renders a section, runs post-processors, attaches the section to the sizer, measures its height, and paints — all within one task. Inserting spacers during the post-processor therefore puts them in the DOM before the first paint (no flash) and before the height measurement (the virtual scroller's stored heights always include the spacers, so its layout model never drifts).
- **Spacers live inside section elements, never in the sizer.** Obsidian's virtual scroller owns the sizer's direct children: it calls `setChildrenInPlace` on every render pass and scroll and *removes* any child it does not list. A spacer that is the first child of the section below its gap is invisible to that bookkeeping, survives scrolling (detach/attach cycles travel with the section), and survives cached-view reuse.
- **Fresh ranges from the renderer, not from stale registries.** `context.getSectionInfo(element)` resolves any element — attached or detached — against Obsidian's live section objects, which are updated at every parse. The Reading root stashes the last post-processor context so deferred passes get the same fresh lookups. The function returns the whole note text; `PageRenderer` slices the section's own line range for internal blank-line runs.
- **Reading roots are retargeted by file path.** Obsidian can reuse one `.markdown-preview-view` as a leaf opens a different note. Templar records which file owns each root and clears its context, section ownership, and owned spacers before adopting another file. A cached reopen may not invoke post-processors; in that case complete `MetadataCache.sections` mappings remain eligible for reconciliation without a context.
- **The hidden-frontmatter boundary is the body origin.** Obsidian's `frontmatterPosition.end.line` identifies the closing YAML delimiter. The first Markdown-body row is therefore `end.line + 1`; the gap from that row to the first rendered section becomes an owned leading spacer. YAML lines themselves never contribute to the visible count.
- **One deferred pass remains.** Style changes and cached Reading Views do not re-run post-processors, so `refreshFile` schedules a single animation-frame reconcile for those paths. Because spacers are inside section elements, this pass cannot be wiped and does not flicker.

Two residual behaviors follow from Obsidian's measurement model (heights are re-measured only when a section re-renders): a gap count that changes while both adjacent sections stay rendered (for example, adding a blank line without touching either section's content) converges on the next re-render of either section, and a section measured before such a change drifts by at most the gap delta until then. Spacers are grid-sized, participate in pagination, and are removed during leaf cleanup.

### PageRenderer

- Enumerates current Markdown leaves rather than holding view instances.
- Uses a per-leaf generation number to prevent an old async font measurement from overwriting a newer render.
- Adds/removes classes and the owned style element.
- Configures image and page-layout observers.
- Records validation issues per file for settings diagnostics.
- Owns leaf-scoped temporary style overrides and generation checks, so a stale async measurement from preview A cannot overwrite preview B.
- Exposes an explicit print-preparation refresh that waits for the current compiler/layout state.
- Per Reading root, tracks the post-processor context and a source-ordered section list (including temporarily detached virtual-scroller elements) that feeds blank-line reconciliation; discarded sections are compacted after `getSectionInfo` marks them stale, and replaced roots are pruned with their scheduled frames.

Focused ownership primitives live under `src/services/rendering/`: `OwnedStyleHost` owns generated style elements, `ReadingRootRegistry` owns root state, and observer/controller modules expose pure compensation and cleanup contracts. `PageRenderer` remains the public high-level leaf orchestrator while these concepts are extracted incrementally.

### Image compensation

A `ResizeObserver` measures rendered image boxes. In strict/balanced gridded modes, it includes the configured block-start/block-end margins and adds only the missing bottom space needed to make the complete image footprint a grid multiple. Original image files are untouched.

The same renderer owns a generalized rhythm observer for variable-height output. It watches one outer layout owner per table, Mermaid/code-block result, callout, embed, iframe, video, audio, canvas, or corresponding CodeMirror widget. Its natural footprint is the precise border box plus external block margins, with any previous Templar-owned tail subtracted. Wrappers receive a trailing pseudo-element; direct replaced/table elements extend their captured natural end margin. Both strategies add `ceil(outer footprint / unit) * unit - outer footprint` without resizing content. Reading walks to the candidate's direct renderer-owned child of the whole-note `.markdown-preview-section`; it never observes that document root or frontmatter UI. Live Preview uses the containing table/embed widget. Resize entries are frame-coalesced and values within a small sub-pixel tolerance of a grid boundary add no row. This prevents feedback loops while keeping subsequent Markdown on the same ruled phase. Explicit source blank-line spacers remain separate children after this compensation and therefore still contribute their full requested rows. Mutations discover replaced async widgets, resizes update only the active owners, and leaf cleanup cancels pending frames, disconnects all observers, and removes every generated class/property.

Templar defines a complete callout palette, so the callout adapter also normalizes `mix-blend-mode` to `normal` inside the isolated paper surface. Host themes may otherwise blend dark callout content into a light page until it disappears even though the DOM remains visible. Template and per-type callout colors remain authoritative.

### PageLayoutService

Paged notes are described fully in [`PAGED_LAYOUT.md`](PAGED_LAYOUT.md). The service owns scale calculation, rendered-block page breaks, DOM observers, animation-frame coalescing, and cleanup.

### Workflow services

- `PreviewSessionService`: one temporary style per owner and leaf, animation-frame coalescing, exact restoration, and explicit cleanup on cancel/sidebar close/plugin unload.
- `NoteStyleIndex`: lazy in-memory source-template/path index, built once from MetadataCache and updated in O(1)-scope on metadata, create, delete, and rename events.
- `style-rules.ts`: pure AND-condition matching and first-enabled-rule selection. Rules are triggered only by vault/metadata events and never poll or overwrite a styled note.
- `synchronization.ts`: source status calculation, legacy detection, note-template extraction, safe replace, and recursive three-way merge.
- `template-pack.ts`: portable pack parsing/export and conflict-copy ID generation; individual members still traverse normal template validation.
- `PrintService`: waits for compiler, fonts, images, and pagination using target-realm observers, appends temporary scoped print rules to the renderer-owned style element, invokes the host print action, then keeps its busy state until screen-layout restoration and renderer refresh complete. Restoration failures clear print state and report a Notice.

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

The Page Styles view takes one catalog snapshot per render and uses CSS-only paper swatches. Recent, Favorites, Built-in, and My Styles sections can be searched, folder-filtered, usage-sorted, and rendered as Compact, Comfortable, or Gallery cards. Search input and preview updates are coalesced; no card compiles a production document. Only the selected actual-note preview enters the full renderer.

## UI modules

- `styles-view.ts`: Current Note state/actions; Recent/Favorites/Built-in/My Styles; search, folder/usage filters and density; lightweight cards; live preview; and roving keyboard navigation.
- `settings-tab.ts`: rendering/default-page behavior, Style Rules management, library/creator entry points, diagnostics, authoring kit, selector reference, and reset.
- `modals/`: compatibility-barrelled modal workflows, shared page controls, and staged extraction modules. `legacy.ts` currently retains behavior-preserving ownership while individual workflows move without changing imports.
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
- latest 10 unique successfully applied template IDs;
- default page flow for newly styled notes;
- persistent library density;
- ordered style rules;
- custom templates.

`normalizeSettings()` merges defaults with persisted data, normalizes templates/rules/enums, and sanitizes ID arrays. Resetting all settings mutates the settings object in place — the `TemplateLibrary` holds a reference to it — while preserving `userTemplates`.

## Adding a feature

Choose the narrowest layer:

- new persisted property: types → default → normalize → serialize → validate → compile/UI → tests/docs;
- new visual module: types/defaults/schema plus a focused compiler function;
- new Obsidian DOM mapping: `css-compiler.ts`, with selector regression tests;
- new per-view behavior: a cleanup-owning service configured by `PageRenderer`;
- new library action: service method first, UI trigger second;
- new note mutation: `FrontmatterService`, never a modal-local file rewrite.
