# Templar documentation

Technical documentation for the Templar Obsidian plugin.

## Getting started

- [`../README.md`](../README.md) — user-facing behavior, installation, and commands.

## Reference

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — design goals, runtime data flow, service responsibilities, and where to add new features.
- [`TEMPLATE_SPEC.md`](TEMPLATE_SPEC.md) — the Templar v1 template schema, field constraints, baseline behavior, and the virtual CSS vocabulary.
- [`PAGED_LAYOUT.md`](PAGED_LAYOUT.md) — the fixed-canvas invariant, whole-page scaling, page-break fitting, and mobile behavior for paged notes.
- [`SECURITY.md`](SECURITY.md) — trust boundaries, CSS validation model, privacy, and denial-of-service considerations.
- [`MAINTAINER_GUIDE.md`](MAINTAINER_GUIDE.md) — test layout, manual smoke tests, the mobile release gate, schema change recipe, and release steps.
- [`releases/`](releases/) — versioned GitHub release notes, including validation status and known alpha limitations.

## Reading order

For new contributors, the recommended order is: `ARCHITECTURE.md` → `TEMPLATE_SPEC.md` → `PAGED_LAYOUT.md` → `SECURITY.md` → `MAINTAINER_GUIDE.md`.
