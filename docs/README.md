# Templar documentation

Technical documentation for the Templar Obsidian plugin.

The current implementation snapshot is `1.1.0-alpha.3`: 132 built-in styles, portable single-level folders, paged/pageless notes, and manual installation only. [`DEVELOPER_REFERENCE.md`](DEVELOPER_REFERENCE.md) is the handoff document for the complete feature map, source map, persistence rules, test/release runbook, and known limitations.

## Getting started

- [`../README.md`](../README.md) — user-facing behavior, installation, and commands.
- [`../examples/Templar Showcase/`](../examples/Templar%20Showcase/) — copy-ready Markdown showcase notes and their local image assets.

## Reference

- [`DEVELOPER_REFERENCE.md`](DEVELOPER_REFERENCE.md) — current-state handoff: every user-facing feature, command and setting, source module, persistence boundary, lifecycle, QA gate, release procedure, and known limitation.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — design goals, runtime data flow, service responsibilities, and where to add new features.
- [`TEMPLATE_SPEC.md`](TEMPLATE_SPEC.md) — the Templar v1 template schema, field constraints, baseline behavior, and the virtual CSS vocabulary.
- [`PAGED_LAYOUT.md`](PAGED_LAYOUT.md) — the fixed-canvas invariant, whole-page scaling, page-break fitting, and mobile behavior for paged notes.
- [`SECURITY.md`](SECURITY.md) — trust boundaries, CSS validation model, privacy, and denial-of-service considerations.
- [`MAINTAINER_GUIDE.md`](MAINTAINER_GUIDE.md) — test layout, manual smoke tests, the mobile release gate, schema change recipe, and release steps.
- [`releases/`](releases/) — versioned GitHub release notes, including validation status and known alpha limitations.

## Reading order

For a new agent or contributor, read `DEVELOPER_REFERENCE.md` first for the current snapshot and source map, then: `ARCHITECTURE.md` → `TEMPLATE_SPEC.md` → `PAGED_LAYOUT.md` → `SECURITY.md` → `MAINTAINER_GUIDE.md`. The root [`AGENTS.md`](../AGENTS.md) contains non-negotiable invariants that apply before editing.

## Documentation authority

- The root [`README.md`](../README.md) is the concise user-facing introduction and manual-install guide.
- `TEMPLATE_SPEC.md` is authoritative for v1 YAML names, defaults, ranges, migration semantics, and virtual CSS.
- `ARCHITECTURE.md` is authoritative for service ownership, renderer data flow, and lifecycle boundaries.
- `PAGED_LAYOUT.md` is authoritative for fixed-canvas geometry, scaling, and page fitting.
- `SECURITY.md` is authoritative for imported YAML/CSS trust boundaries and dependency/runtime restrictions.
- `MAINTAINER_GUIDE.md` is the practical smoke-test and release checklist; the developer reference summarizes it for handoff.
- `releases/<version>.md` and `CHANGELOG.md` are historical. Keep prior release notes immutable and add new entries for new behavior.

When docs and a current test disagree, investigate the implementation and update the relevant contract before handing off. Do not paper over a failing test by changing documentation alone.
