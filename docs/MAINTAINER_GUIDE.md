# Maintainer guide

## Local workflow

```bash
npm install
npm run dev
```

Reload Templar in Obsidian after builds. For a clean handoff:

```bash
npm audit
npm run check
```

`npm run check` runs Obsidian-aware ESLint, Vitest, strict TypeScript, a minified browser-targeted esbuild bundle, and the mobile bundle guard. The guard fails if `main.js` retains Node/Electron imports, dynamic `require`, `Buffer`, or `process` access.

## Test layout

- `grid.test.ts`: grid fitting, heading correction, image compensation, aligned page gaps.
- `font-metrics.test.ts`: baseline probe geometry and the no-DOM fallback.
- `reading-whitespace.test.ts`: exact source-line gaps and fenced-code exclusion.
- `schema.test.ts`: normalization, note/frontmatter round trips, built-in validity.
- `css.test.ts`: virtual mapping, scope guarantees, keyframes, global/resource rejection, paged media-query rule.
- `style-compiler.test.ts`: shared pattern origin, editor list normalization, measured Reading code padding, highlight palettes, injection containment, and fixed-page CSS.

Pure tests deliberately avoid importing Obsidian's Electron runtime. UI/runtime behavior needs an Obsidian smoke test.

## Manual smoke test

Create a note containing:

```markdown
# Heading one

Paragraph with **bold**, *italic*, `code`, a [[link]], and ==highlighted text==.

## Heading two

- [x] Completed task
- [ ] Open task

> A multi-line quotation.

| Column A | Column B |
| --- | --- |
| One | Two |

![[an-image.png]]

```js
console.log('code block');
```
```

Check every built-in in Reading and Live Preview. Confirm ordinary source text and undo/redo remain unchanged.

Add one, three, and five empty source lines between paragraphs; confirm Reading View preserves those exact counts. Test an already-styled note, applying a style while an unstyled note is open, and reloading the plugin while Reading View is already cached. These protect the metadata-cache fallback and post-render scheduling paths. Add a multi-line fenced code block with an internal blank line and confirm every code baseline follows the ruling without creating an external spacer.

For ruled, dot-grid, and graph templates, zoom in far enough to confirm that the ordinary glyph body sits immediately above the pattern anchor, the one-pixel rule extends downward, and descenders cross it naturally. Confirm consecutive bullets use the same line-height as ordinary text and that the block after a list still lands on the grid. Confirm each built-in supplies a readable highlight background and foreground in both views.

Open the Template Creator's Simple, Detailed, and Advanced tabs. In Detailed mode exercise H2–H4 font controls, margin color/offset, code typography, table header color, image filters, and paged/pageless preview.

For paged mode, follow `docs/PAGED_LAYOUT.md`'s resize matrix. For per-note isolation, open at least three split leaves with different styles and modes.

## Mobile release gate

The code is designed for mobile but release claims require evidence:

1. In desktop developer tools, run `this.app.emulateMobile(true)` and check narrow/touch layouts.
2. Test a physical iOS device supported by current Obsidian.
3. Test a physical Android device or representative emulator.
4. Exercise the software keyboard in creator/import/raw modals.
5. Create, apply, switch mode, edit, scroll a long paged note, load images, and disable/re-enable the plugin.
6. Confirm there are no Node/Electron or adapter errors in logs.

Record app version, OS version, device, orientation, and result in the release checklist.

## Schema change recipe

1. Add the internal type.
2. Add a safe default.
3. Normalize both kebab-case persisted and camel-case internal spellings.
4. Serialize a readable kebab-case field.
5. Add validation/clamping.
6. Compile the behavior or expose the setting.
7. Round-trip it in tests.
8. Update `TEMPLATE_SPEC.md` and the LLM authoring kit.
9. Decide whether the change is backward-compatible v1 or requires v2.

## Adding a built-in template

- Use `builtIn()` in `src/templates/builtins.ts`.
- Pick a permanent unique ID.
- Configure only structured modules and safe virtual CSS.
- Test pageless and paged preview.
- Keep font stacks portable with fallbacks.
- Run the built-in schema/CSS test.
- Add it to README and screenshots when a public repository exists.

## Obsidian DOM changes

Templar intentionally localizes internal selectors to two places:

- root/content discovery in `PageRenderer.prepareViewRoots()`;
- Live Preview element expansion in `css-compiler.ts`.

When an Obsidian release changes DOM:

1. inspect both Reading and Live Preview on desktop and mobile;
2. update only the adapter mapping;
3. keep the public virtual vocabulary unchanged;
4. add a compiler regression test;
5. verify older supported Obsidian versions if possible.

## Performance debugging

- Obsidian exposes plugin startup timing under general advanced settings.
- Keep `onload()` to registrations/data construction.
- Watch for repeated pagination frames or ResizeObserver loop warnings.
- Profile long notes in Reading and Live Preview separately.
- Check the number of open styled leaves and observers.
- Test production `main.js`; development source maps distort size/startup.

## Version and release

1. Update `minAppVersion` only when API usage requires it.
2. Run `npm version patch|minor|major`; the version script updates manifest and versions map.
3. Update `CHANGELOG.md`.
4. Run audit and check.
5. Complete manual desktop/mobile verification.
6. Create a GitHub release tagged exactly `x.y.z`.
7. Attach production `main.js`, `manifest.json`, and `styles.css`.

Tag the release with GitHub (`git tag 1.0.1` and push). The repository's release workflow builds the production bundle and attaches `main.js`, `manifest.json`, and `styles.css` automatically; before first community submission, verify those assets on the release.
