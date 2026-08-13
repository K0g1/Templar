# Website content source map

| Public fact or content | Authority |
| --- | --- |
| Version, plugin ID, minimum Obsidian, desktop/mobile | `manifest.json` |
| Package version and license | `package.json` |
| Version compatibility | `versions.json` |
| Built-in catalog counts and folders | `src/templates/builtins.ts`, `src/templates/packs/catalog.ts` |
| Installation behavior | `docs/INSTALLATION.md`, `README.md` |
| Current and historical changes | `CHANGELOG.md`, `docs/releases/*.md` |
| Technical documentation | root `docs/` |
| Example content and original artwork | `examples/Templar Showcase/` |
| Field-guide display notes (live renders) | `examples/Templar Field Guide/` (compiled via `scripts/render-field-guide.mjs`) |
| Generated stylesheet for the live notes | `scripts/vendor/style-compiler.bundle.cjs` (from `src/services/style-compiler/*.ts`) |
| Distribution availability | generated site policy flag, currently `communityPluginListed: false` |

Generated files under `website/src/data/`, `website/public/field-guide/`, and `website/src/content/docs/` are build artifacts. Do not edit them directly.
