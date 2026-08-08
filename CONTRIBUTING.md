# Contributing to Templar

Thank you for helping build Templar. The core design promise is unusually strict: visual richness must never require Templar to own or rewrite Markdown.

## Getting started

- Browse open work in [issues](https://github.com/K0g1/Templar/issues) and discuss a feature before implementing it.
- Start with [`docs/README.md`](docs/README.md) for the reading order of the technical documentation.
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

## Pull request expectations

- Explain the user-visible behavior and the notes/frontmatter it touches.
- Add tests for pure logic, schema changes, CSS rules, or regressions.
- Update the template specification and architecture docs when contracts change.
- Include desktop Reading/Live Preview results and mobile/emulation results for renderer work.
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
