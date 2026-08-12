# Recovery

Protected Templar data is never silently discarded. Before replacing or removing unreadable note data, Templar writes a JSON recovery record under `Templar Recovery/` using the Vault API. Records include the source path, schema versions, plugin version, reason, timestamp, and the original raw value.

Recovery files are never overwritten or automatically deleted. Names contain the recovery kind, source basename, timestamp, and a collision suffix when needed. Records larger than 8 MB are refused, so a destructive action cannot continue without a durable recovery copy.

The Recovery command and modal show the status, migration trace, and diagnostics. Users can copy the raw data, export a recovery copy, replace protected data with a style, or remove the Templar property. Replace and remove operations use the raw fingerprint captured during review and a guarded frontmatter callback; if the note changes first, the operation is refused.

Settings migration follows the same rule. Legacy flat settings are loaded in memory and are not written at startup. The first explicit finalization or settings write creates a recovery copy before persisting `settings-data-version: 1`. Future settings remain protected and safe defaults are used without overwriting the raw future object.
