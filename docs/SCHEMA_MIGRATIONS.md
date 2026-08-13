# Schema migrations

Templar currently reads version 1 note styles, templates, and packs. Settings use the flat `settings-data-version: 1` field. Reads classify data before normalization and never rewrite it automatically.

`current` is readable version 1 data. `migrated` is data transformed in memory by contiguous, pure migration steps. `unsupported-future`, `unsupported-legacy`, `invalid`, and `migration-failed` are protected: they remain raw and cannot be replaced by ordinary actions. Missing note/template version is invalid; only missing settings data version is treated as legacy settings v0.

The runtime consumer is always the classified result, never a direct raw-to-current parser: `FrontmatterService.getStyle()` uses the note-style inspection result, user-template settings use template inspection, and pack parsing inspects both its wrapper and each member before exposing a value. These read paths do not persist migration results. The first explicit settings persistence after a legacy load creates a recovery record before writing current settings data.

`provenance.source-snapshot` is a second versioned template boundary. A current outer note can still render if its embedded snapshot is future, invalid, legacy, or migration-failed, but the protected path is reported. Page-only edits preserve the original nested raw value; replacement, removal, and synchronization require the Recovery flow and a fresh raw fingerprint.

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
