# Security policy

Templar takes the security of your vault seriously.

## Supported versions

Security fixes are released for the latest published version. When a fix requires a new version, the release tag exactly matches the version in `manifest.json` and is attached to the [releases page](https://github.com/K0g1/Templar/releases).

## Reporting a vulnerability

Please use GitHub's **[Report a vulnerability](https://github.com/K0g1/Templar/security/advisories/new)** form so the report and any follow-up remain private. If that form is unavailable, open a public issue containing no sensitive details and ask the maintainer for a private contact channel.

Never include private vault content, exploit details, or secrets in a public issue. In the private report, include:

- the Templar and Obsidian versions involved;
- the steps to reproduce;
- the expected and actual behavior;
- whether the issue affects imported YAML, custom CSS, or rendered notes.

## What Templar guarantees

- No network requests, telemetry, analytics, ads, accounts, payments, or secrets are stored or transmitted.
- The plugin reads and writes only inside the vault, through Obsidian Vault/FileManager APIs.
- Note and template content is never sent to any service.
- Imported YAML, note frontmatter, and CSS are treated as untrusted; unsupported note versions fail closed and unsafe input is rejected with human-readable diagnostics.
- Every template inside an imported `.templar-pack` is validated independently, raw imports and member counts are bounded, duplicate IDs/conflicts are explicit, and imported built-in IDs can never replace shipped definitions.
- Custom CSS is size-limited, tokenizer-hardened, selector-scoped to a collision-free leaf token, and compiled onto plugin-owned classes. Baseline-enabled templates cannot override the geometry that keeps editor hit-testing and document rhythm correct.
- Temporary previews remain leaf-local and in memory; printing delegates to the host and adds no PDF engine or network service.

The detailed threat model lives in [`docs/SECURITY.md`](docs/SECURITY.md); the current runtime/source map is in [`docs/DEVELOPER_REFERENCE.md`](docs/DEVELOPER_REFERENCE.md).
