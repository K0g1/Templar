# Security policy

Templar takes the security of your vault seriously.

## Supported versions

Security fixes are released for the latest published version. When a fix requires a new version, a release is tagged with the fixed `x.y.z` version and attached to the [releases page](https://github.com/K0g1/Templar/releases).

## Reporting a vulnerability

Please report security issues privately by opening a GitHub issue with the "security" label, or contact the maintainer directly if the issue contains sensitive details.

Do not include private vault content in a public issue. Include:

- the Templar and Obsidian versions involved;
- the steps to reproduce;
- the expected and actual behavior;
- whether the issue affects imported YAML, custom CSS, or rendered notes.

## What Templar guarantees

- No network requests, telemetry, analytics, ads, accounts, payments, or secrets are stored or transmitted.
- The plugin reads and writes only inside the vault, through Obsidian Vault/FileManager APIs.
- Note and template content is never sent to any service.
- Imported YAML and CSS are treated as untrusted and are validated before use; invalid input is rejected with human-readable diagnostics.
- Custom CSS is size-limited, selector-scoped, and compiled onto plugin-owned classes.

The detailed threat model lives in [`docs/SECURITY.md`](docs/SECURITY.md).
