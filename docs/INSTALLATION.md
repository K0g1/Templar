# Installing Templar

Templar is alpha software. Back up important vaults before testing it, and report the Obsidian version, operating system, Templar version, and installation path with any bug report.

## BRAT alpha installation

BRAT is a supported alpha installation path under final clean-vault validation. This project does not call BRAT recommended until the release E2E matrix is recorded. At this documentation update, BRAT 2.2.0 requires Obsidian 1.11.4 or newer; Templar's own minimum is 1.8.0. Use manual installation for older supported Obsidian versions.

1. Install **Obsidian42 - BRAT** from Obsidian's Community Plugins and enable it.
2. Run **BRAT: Add a beta plugin for testing** from the command palette.
3. Enter `K0g1/Templar` and add the plugin.
4. Enable **Templar** under **Settings → Community plugins → Installed plugins**.

You can also try the deep link: [Add Templar to BRAT](obsidian://brat?plugin=K0g1/Templar). If your renderer does not make the link clickable, copy `obsidian://brat?plugin=K0g1/Templar` and use the command-palette route above.

BRAT normally tracks the current release. To reproduce a report against a specific version, run **BRAT: Add a beta plugin with frozen version based on a release tag**, enter `K0g1/Templar`, and enter the exact release tag, for example `1.2.0-alpha.5`. A frozen plugin does not follow later updates automatically.

BRAT updates can be enabled at startup from BRAT's settings. The plugin folder should be `.obsidian/plugins/templar/`; compare the installed `manifest.json` version when diagnosing an update that appears stuck.

## Manual installation

1. Open the [Templar releases](https://github.com/K0g1/Templar/releases) page.
2. Download `main.js`, `manifest.json`, and `styles.css` from the release you want.
3. Create `<your-vault>/.obsidian/plugins/templar/`.
4. Copy all three files into that directory. Keep the filenames and lowercase plugin folder exact.
5. Reload Obsidian and enable **Templar** in **Settings → Community plugins → Installed plugins**.

Manual installation is also the fallback when GitHub rate limits prevent BRAT from downloading a release. Do not copy the repository source files or a development checkout into the plugin directory.

## Update, reinstall, or remove

For a BRAT-managed plugin, run BRAT's update command or use its configured startup update behavior. To reinstall, remove Templar through BRAT, reload Obsidian, and add `K0g1/Templar` again. Removing BRAT tracking is different from uninstalling Templar: follow BRAT's remove/untrack action first if you want to keep the installed plugin files, and use Obsidian's installed-plugin controls when you want the plugin removed entirely.

Before updating an alpha build, export or back up important notes. Templar stores each applied design in the note's `templar` frontmatter property and does not rewrite ordinary Markdown body text, but a vault backup remains the right recovery path for prerelease testing.

## Troubleshooting

- If BRAT reports a GitHub rate limit, wait for the limit to reset, authenticate where BRAT supports it, refresh the Community Plugins list, or use the release assets manually.
- If Templar does not appear, reload Obsidian and check **Installed plugins** rather than Browse; Templar is not yet in the Community Plugins directory.
- If an update appears stale, inspect `.obsidian/plugins/templar/manifest.json` and verify its `version`, then reinstall through BRAT.
- If the plugin fails to load, compare all three filenames and confirm that `main.js`, `manifest.json`, and `styles.css` are in the lowercase `templar` folder.
- If the current alpha is incompatible with an older Obsidian build, use a release whose `minAppVersion` is compatible or fall back to the manual release assets. Do not override the manifest minimum version.
