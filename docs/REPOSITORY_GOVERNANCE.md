# Repository governance

This is the observed GitHub governance state for `K0g1/Templar`. Settings were verified on 2026-08-11 after the audit-remediation branch was implemented.

| Control | Observed state |
| --- | --- |
| Default branch | `main` |
| Active ruleset | `Protect main governance` (ruleset `20723295`), targeting `refs/heads/main` |
| Pull requests | Required; zero approvals is intentional for the solo-maintainer repository |
| Required CI | `check`, selected from the successful CI job rather than guessed |
| Conversation resolution | Required |
| Force pushes / branch deletion | Blocked |
| Ruleset bypass actors | None |
| Dependabot vulnerability alerts | Enabled |
| Dependabot security updates | Enabled |
| Immutable releases | Enabled for future releases |

Classic branch protection is also enabled on `main` with the same required `check` status, pull-request, conversation-resolution, force-push, and deletion controls. The existing `1.2.0-alpha.2` release was not rewritten; its historical immutability field remains unchanged. Future releases must be created as new tags and should be checked for immutable status after publication.

When changing CI job names, update both the active ruleset and classic protection after observing a successful run. Do not add a broad bypass actor, delete historical releases, or repoint an existing release tag.
