# Security model

The current runtime/source map and release status are summarized in [`DEVELOPER_REFERENCE.md`](DEVELOPER_REFERENCE.md). This document is the normative threat model for note frontmatter, imported YAML, custom CSS, runtime APIs, and dependencies.

## Trust boundaries

Templar processes four user-controlled inputs:

1. note frontmatter;
2. pasted/imported template YAML;
3. advanced template CSS.
4. `.templar-pack` files containing multiple templates.

All four can be synced or received from someone else and are treated as untrusted until normalized and validated.

## YAML and frontmatter

- YAML parsing uses Obsidian's parser.
- Imported objects are normalized into the known v1 schema; unknown keys are dropped.
- Numeric values are finite and clamped.
- Enum values fall back to a documented safe member.
- Note styles require the supported explicit version and otherwise fail closed; unsupported content is not silently normalized into a styled note.
- Writes use `FileManager.processFrontMatter()` and touch only `frontmatter.templar`.
- No imported text is passed to `innerHTML` or executed.
- Import preview is isolated and saving requires an explicit user action.
- Raw imports are capped at 8 MB before YAML parsing; packs are capped at 256 members and 8 MB of aggregate custom CSS.
- Normalized settings and note styles have bounded collections: 64 callout variants, 512 attachment overrides with 512-byte UTF-8 filenames, 64 tags with 80-byte values, 128 style rules with 32 conditions each, and a 512 KB serialized note-style budget.
- Every pack member traverses the standalone normalizer, source validator, structured validator, and CSS validator independently. Duplicate member IDs are errors, invalid members are blocked, built-in IDs cannot be overwritten, and folder labels never become filesystem paths.

## CSS controls

Custom CSS has a 50 KB limit and is parsed by patched PostCSS plus `postcss-selector-parser`; generated structured/custom output is capped at 1 MB before it is installed.

Before PostCSS recovery, a small tokenizer rejects physical control characters inside strings and unterminated strings/comments. This closes browser/parser differentials where a malformed quoted value could terminate a scoped declaration and create a global rule. Structured frontmatter strings are independently escaped/guarded before interpolation; `var()`, `env()`, and `attr()` are rejected in structured values so note metadata cannot escape or inherit an unexpected host CSS value.

Every non-keyframe selector must start with `.page` or `.page-content`. The validator rejects:

- `html`, `body`, `:root`, workspace, leaf, sidebar, modal, and settings selectors;
- `:global()`;
- `@import`, `@font-face`, `@document`, `@namespace`, `@page`, `@property`, and `@charset`;
- all `url()`/HTTP values;
- `position: fixed`;
- z-index above 20;
- legacy executable binding/behavior properties;
- viewport media queries that would make a fixed page reflow;
- viewport/container/environment-dependent lengths, container queries, `!important`, and private runtime selectors that could override the fixed canvas.
- vertical box/font geometry on rhythmic descendants while a baseline grid is active.
- availability-affecting declarations on the virtual root or universal descendant coverage (`.page *`, `.page > :is(*)`, and `.page > :where(*)`), including display, visibility, opacity, filters, masks, clipping, transforms, scale, and zoom.

Infinite animations and backdrop filters produce warnings. Validation errors omit advanced CSS from rendering.

The compiler replaces virtual roots with a collision-free per-leaf runtime scope and plugin-owned page class. It maps stable element vocabulary—including selectors nested in functional pseudos—onto Reading/Live Preview adapters and prefixes keyframe names per leaf. File paths are not used as scope identity, so two panes showing the same note cannot share a preview stylesheet. CSS is assigned with `style.textContent`, not HTML parsing.

Structured fields pass through a conservative scalar CSS-value guard that rejects declaration terminators, braces, markup delimiters, `url()`, and `expression()` before interpolation.

## Network and privacy

Templar makes no network requests and has no telemetry, analytics, ads, accounts, payments, or secrets. The LLM workflow is manual copy/paste; Templar never sends note/template content to a model or service.

## Filesystem

Runtime code uses Obsidian Vault/FileManager APIs only. It does not import Node.js or Electron and does not access files outside the vault. The production build explicitly targets browsers, applies PostCSS’s browser shims, disables source-map handling during parsing, and fails a bundle scan if any Node/Electron import or Node global remains. Template/pack exports and print actions are explicit user actions; print delegates to the host browser instead of adding an independent document engine.

## Dependency policy

Runtime dependencies are limited to the CodeMirror view type package supplied externally by Obsidian plus bundled PostCSS selector tooling. The lockfile is committed. Release verification runs:

```bash
npm audit --audit-level=moderate
npm audit --omit=dev --audit-level=moderate
npm run check
npm run verify:ship -- <exact-version>
npm run verify:mobile
```

The initial implementation upgraded PostCSS and Vitest in response to advisories before release. Future advisories must be evaluated for both bundled runtime and development exposure.

## Denial-of-service considerations

- Raw import bytes, pack members, aggregate pack CSS, and per-template CSS are bounded before expensive validation/rendering.
- font cache size is bounded.
- refreshes and pagination are animation-frame/microtask coalesced.
- observers are per open styled leaf and disconnect on reconfigure/cleanup.
- over-tall page blocks are not repeatedly moved.
- imported animations/effects receive performance validation.
- library cards are lightweight swatches; only one selected actual-note preview uses the production renderer per sidebar owner.
- usage and rules are event-driven with one lazy metadata index, no polling, no listener per note, and no scan on each sidebar render.
- bulk writes yield in chunks, inspector updates coalesce to animation frames, and preview/print generations ignore stale asynchronous work.

Future work should benchmark very large notes and consider viewport-aware page fitting limits if observer work becomes significant.

## Reporting

Report security issues privately through the process in the repository root [`SECURITY.md`](../SECURITY.md). Do not include private vault content in a public issue.
