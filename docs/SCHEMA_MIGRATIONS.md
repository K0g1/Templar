# Schema migrations

Templar currently reads version 1 note styles, templates, and packs. Settings use the flat `settings-data-version: 1` field. Reads classify data before normalization and never rewrite it automatically.

`current` is readable version 1 data. `migrated` is data transformed in memory by contiguous, pure migration steps. `unsupported-future`, `unsupported-legacy`, `invalid`, and `migration-failed` are protected: they remain raw and cannot be replaced by ordinary actions. Missing note/template version is invalid; only missing settings data version is treated as legacy settings v0.

When adding v2:

1. Change `CURRENT_TEMPLAR_FORMAT_VERSION`.
2. Leave `MIN_SUPPORTED_TEMPLAR_FORMAT_VERSION` unchanged unless support is deliberately dropped.
3. Add an `N -> N+1` migration step.
4. Add raw fixtures for the old schema.
5. Update serializers and parsers.
6. Update `TEMPLATE_SPEC.md` and the authoring kit.
7. Add release notes.
8. Test old-note rendering and migration.
9. Test future-version protection and downgrade behavior.

Migration steps must have unique IDs, unique source versions, advance exactly one version, avoid mutation, and return the declared next version. Source snapshots are inspected independently; an unreadable nested snapshot does not prevent an otherwise readable outer note from rendering, but safe synchronization is unavailable. Pack wrappers and members are classified independently. Exporters always write the current version.
