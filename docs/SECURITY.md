# Security model

## Trust boundaries

Templar processes three user-controlled inputs:

1. note frontmatter;
2. pasted/imported template YAML;
3. advanced template CSS.

All three can be synced or received from someone else and are treated as untrusted until normalized and validated.

## YAML and frontmatter

- YAML parsing uses Obsidian's parser.
- Imported objects are normalized into the known v1 schema; unknown keys are dropped.
- Numeric values are finite and clamped.
- Enum values fall back to a documented safe member.
- Writes use `FileManager.processFrontMatter()` and touch only `frontmatter.templar`.
- No imported text is passed to `innerHTML` or executed.
- Import preview is isolated and saving requires an explicit user action.

## CSS controls

Custom CSS has a 50 KB limit and is parsed by patched PostCSS plus `postcss-selector-parser`.

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

Infinite animations and backdrop filters produce warnings. Validation errors omit advanced CSS from rendering.

The compiler replaces virtual roots with a unique view scope and plugin-owned page class. It maps stable element vocabulary onto Reading/Live Preview adapters and prefixes keyframe names per note. CSS is assigned with `style.textContent`, not HTML parsing.

Structured fields pass through a conservative scalar CSS-value guard that rejects declaration terminators, braces, markup delimiters, `url()`, and `expression()` before interpolation.

## Network and privacy

Templar makes no network requests and has no telemetry, analytics, ads, accounts, payments, or secrets. The LLM workflow is manual copy/paste; Templar never sends note/template content to a model or service.

## Filesystem

Runtime code uses Obsidian Vault/FileManager APIs only. It does not import Node.js or Electron and does not access files outside the vault. The production build explicitly targets browsers, applies PostCSS’s browser shims, disables source-map handling during parsing, and fails a bundle scan if any Node/Electron import or Node global remains. Exports are explicit user actions into visible vault paths.

## Dependency policy

Runtime dependencies are limited to the CodeMirror view type package supplied externally by Obsidian plus bundled PostCSS selector tooling. The lockfile is committed. Release verification runs:

```bash
npm audit
npm run check
npm run verify:mobile
```

The initial implementation upgraded PostCSS and Vitest in response to advisories before release. Future advisories must be evaluated for both bundled runtime and development exposure.

## Denial-of-service considerations

- CSS size is bounded.
- font cache size is bounded.
- refreshes and pagination are animation-frame/microtask coalesced.
- observers are per open styled leaf and disconnect on reconfigure/cleanup.
- over-tall page blocks are not repeatedly moved.
- imported animations/effects receive performance validation.

Future work should benchmark very large notes and consider viewport-aware page fitting limits if observer work becomes significant.

## Reporting

Report security issues privately through the process in the repository root [`SECURITY.md`](../SECURITY.md). Do not include private vault content in a public issue.
