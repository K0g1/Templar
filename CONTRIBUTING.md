# Contributing to Templar

Thank you for helping build Templar. The core design promise is unusually strict: visual richness must never require Templar to own or rewrite Markdown.

## Getting started

- Browse open work in [issues](https://github.com/K0g1/Templar/issues) and discuss a feature before implementing it.
- Start with [`docs/README.md`](docs/README.md), then read the [`developer handoff`](docs/DEVELOPER_REFERENCE.md) before editing.
- Report security issues through the process in [`SECURITY.md`](SECURITY.md), not in a public issue.

## Setup

Use a dedicated test vault when developing community plugins. From the plugin folder:

```bash
npm install
npm run dev
```

Reload the plugin after a build. Before opening a pull request:

```bash
npm audit
npm run check
```

`npm run check` is the normal local gate: it runs lint, the pure Vitest suite, strict TypeScript, a production browser bundle, and the mobile-bundle scan. Run `npm run verify:release -- <exact-version>` as well when changing release metadata or release notes. For a local Obsidian smoke test, build first and copy the generated `main.js`, `manifest.json`, and `styles.css` into a disposable vault's `.obsidian/plugins/templar/` folder.

## Pull request expectations

- Explain the user-visible behavior and the notes/frontmatter it touches.
- Add tests for pure logic, schema changes, CSS rules, or regressions.
- Update the template specification, architecture docs, and [`docs/DEVELOPER_REFERENCE.md`](docs/DEVELOPER_REFERENCE.md) when contracts or current behavior change. Update `src/templates/llm-kit.ts` when the authoring schema changes.
- Include desktop Reading/Live Preview results and mobile/emulation results for renderer work.
- For preview, rules, usage, synchronization, inspector, print, or bulk work, document event/observer ownership, stale-work protection, cleanup, and exact confirmation behavior.
- Do not include unrelated formatting or generated dependency churn.
- Do not add default hotkeys.
- Do not commit secrets, vault content, `data.json`, or external user assets.

## Compatibility

The current minimum app version is 1.8.0. Newer API usage needs a documented compatibility decision and a manifest/versions update. Runtime code must remain mobile-safe.

## Release artifacts

The source repository may omit generated `main.js`, but every GitHub release and manual install needs:

- `main.js`
- `manifest.json`
- `styles.css`

Release tags exactly match the manifest version and do not use a `v` prefix. Prerelease versions use SemVer suffixes such as `1.1.0-alpha.1`; their GitHub releases must be marked as prereleases. Each tag also needs a matching `docs/releases/<version>.md` release-notes file.

## Template and pack work

Add a one-off hand-tuned design with `builtIn()` in `src/templates/builtins.ts`; add a shipped family to the compact seeds in `src/templates/packs/catalog.ts`. User-shareable `.templar-pack` files are data containers, not shipped TypeScript packs: every member must remain a complete v1 template and pass the standalone schema/CSS/security path. Every style needs a permanent ID, a display folder, useful tags, both page modes, and readable colors. Run the catalog identity/schema/CSS/contrast tests before treating a palette as complete. Folder metadata is a display label, not a vault path; separators are sanitized and missing values become `Unfiled`.

Do not replace built-in definitions from imported data. New metadata-derived features must use the shared lazy index or Obsidian events—never polling, per-note listeners, or a vault scan on every render. Bulk mutations require a dry run, exact affected/skipped counts, explicit confirmation, and chunked/yielding execution.

For a persisted field, follow the full boundary in [`docs/DEVELOPER_REFERENCE.md`](docs/DEVELOPER_REFERENCE.md): type → default → normalization/aliases → YAML serialization → validation → compiler/UI → round-trip tests → specification/authoring-kit docs. The generated `main.js` is never the place to implement a change.

## Handoff expectations

Leave a future contributor with a clean `git status` when possible, the source commit/tag, the commands that passed, any intentionally pending mobile/manual checks, and links to the docs/tests that define the change. The developer reference contains the current source map, runtime lifecycle, release runbook, and known limitations; update it whenever those facts change.
