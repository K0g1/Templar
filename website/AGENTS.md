# Templar Website Maintenance

The website is a static Astro site with Starlight documentation and deploys under the GitHub Pages base path `/Templar`.

## Design direction

Warm editorial stationery on a desk: cream paper panels with deckled edges, engraved SVG artwork, display serif headlines, and a dark "night desk" theme where the paper stays paper and the desk goes dark. All artwork is inline SVG; there are no screenshots or raster assets except the generated Open Graph card.

## Sources of truth

- Do not manually duplicate version, compatibility, or style-count facts. `npm run generate` derives them from the root `manifest.json`, `package.json`, `versions.json`, and style registry.
- Do not maintain a second documentation tree. `npm run sync:docs` copies and rewrites the canonical root `docs/` files for Starlight.
- Release cards come from the root `CHANGELOG.md`; GitHub releases remain the immutable download source.
- The field-guide display notes live in `examples/Templar Field Guide/`. Their frontmatter is written by the real plugin; edit the notes, not the generated output.
- Keep the mapping of canonical docs to website sections current in `docs-source-map.md`.

## The live-note pipeline

The showcase and demo sections are not screenshots. `node scripts/render-field-guide.mjs` (part of `npm run generate`):

1. Parses each field-guide note's `templar` frontmatter.
2. Compiles the real plugin stylesheet through the vendored compiler bundle (`scripts/vendor/style-compiler.bundle.cjs`, regenerated from `src/services/style-compiler/*.ts` with esbuild).
3. Renders the Markdown body as Obsidian-reading-view HTML.
4. Writes `src/data/field-guide.generated.json` and copies the SVG artwork into `public/field-guide/`.

Astro components inject the compiled CSS and HTML into a drawn Obsidian-style window (`LiveNote.astro`). Never replace these with screenshots; keep the captions honest.

## Required checks

Run these from `website/` after content or UI changes:

```bash
npm run check
npm run build
```

For layout changes, inspect the homepage, docs, examples, installation, and changelog at desktop (1440px), tablet (1024px), and phone (390px) widths, plus the dark desk theme, a no-JavaScript pass, and 200% zoom. Confirm there is no horizontal overflow and that the `/Templar` base path is preserved in internal URLs.

## Content policy

- Use live HTML renders driven by the plugin's own compiled CSS; label them as such.
- Installation guidance must match the current distribution channel. Templar is currently beta-only through BRAT or manual installation.
- Preserve the quiet editorial stationery direction and the shared token system in `src/styles/tokens.css`.
- Add substantial repeated UI as a component instead of copying page-local markup.
