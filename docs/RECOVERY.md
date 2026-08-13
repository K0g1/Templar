# Recovery

Protected Templar data is never silently discarded. Before replacing or removing unreadable note data, Templar writes a JSON recovery record under `Templar Recovery/` using the Vault API. Records include the source path, schema versions, plugin version, reason, timestamp, and the original raw value.

Recovery files are never overwritten or automatically deleted. Names contain the recovery kind, source basename, timestamp, and a collision suffix when needed. Records larger than 8 MB are refused, so a destructive action cannot continue without a durable recovery copy.

The Recovery command and modal show the status, migration trace, protected nested paths, and diagnostics. Users can copy the raw data, export a recovery copy, replace protected data with a style, or remove the Templar property. A supported migrated note is read-only until it is explicitly upgraded after backup. Every destructive action creates a new recovery file first, then passes a recovery authorization and the raw fingerprint captured during review into the frontmatter callback; if the note changes first, the operation is refused and the backup remains available.

An unreadable `provenance.source-snapshot` is protected independently from its otherwise readable outer note. Templar continues to render the outer style and allows page-only edits that preserve the exact nested raw snapshot. Applying a new full style, removing the style, or synchronizing to a template is blocked until Recovery has created a backup and the user deliberately chooses a replacement or removal.

Settings migration follows the same rule. Missing settings are a clean first install; legacy flat settings are loaded in memory and are not written at startup. Future, malformed object, primitive, and array settings remain protected while Templar uses safe defaults. The settings recovery screen can copy/export the original value or reset it only after a new backup succeeds. Quarantined imported templates are backed up before removal.
