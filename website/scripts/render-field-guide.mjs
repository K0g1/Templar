// render-field-guide.mjs — compiles the real Templar stylesheet for each field-guide note
// (via the bundled plugin compiler) and renders the note bodies as Obsidian-reading-view
// HTML. It also compiles every one of the 132 built-in styles for the interactive style
// library. Output is consumed by the Astro components; the website displays live HTML,
// never screenshots.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { compilePageStyle } from './vendor/style-compiler.bundle.cjs';
import { renderMarkdown, styleFromYaml } from './lib/note-render.mjs';

const require = createRequire(import.meta.url);
const { STYLE_LIBRARY } = require('./vendor/style-library.bundle.cjs');

const websiteDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootDir = path.resolve(websiteDir, '..');
const sourceDir = path.join(rootDir, 'examples', 'Templar Field Guide');
const assetSourceDir = path.join(sourceDir, 'Assets');
const assetOutputDir = path.join(websiteDir, 'public', 'field-guide');
const outputFile = path.join(websiteDir, 'src', 'data', 'field-guide.generated.json');

const PAGE_DEFAULTS = { mode: 'pageless', size: 'a4', width: 794, height: 1123, gap: 32, scaleToFit: true };

function fitToGrid(requiredHeight, gridUnit) {
  if (gridUnit <= 0) return Math.max(0, requiredHeight);
  return Math.ceil(Math.max(0, requiredHeight) / gridUnit) * gridUnit;
}

function round(value, places = 3) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

// Replicates FontMetricsService.measurePage's fallback path (the same math the plugin
// uses when live DOM measurement is unavailable).
function fallbackMetrics(style) {
  const gridded = style.baseline.enabled && style.baseline.mode !== 'free';
  const bodyLineHeight = gridded
    ? style.baseline.unit
    : style.typography.bodyLineHeight > 0
      ? style.typography.bodyLineHeight
      : Math.max(style.typography.bodySize * 1.55, 22);
  const headingLineHeight = (size) => (gridded ? fitToGrid(size * 1.18, style.baseline.unit) : size * 1.2);
  const measure = (fontSize, lineHeight) => {
    const baseline = round(lineHeight / 2 + fontSize * 0.36);
    return {
      baseline,
      ascent: baseline,
      descent: Math.max(0, lineHeight - baseline),
      lineHeight,
      measuredAt: Date.now(),
    };
  };
  return {
    body: measure(style.typography.bodySize, bodyLineHeight),
    h1: measure(style.headings.h1.size, headingLineHeight(style.headings.h1.size)),
    h2: measure(style.headings.h2.size, headingLineHeight(style.headings.h2.size)),
    h3: measure(style.headings.h3.size, headingLineHeight(style.headings.h3.size)),
    h4: measure(style.headings.h4.size, headingLineHeight(style.headings.h4.size)),
    h5: measure(style.headings.h5.size, headingLineHeight(style.headings.h5.size)),
    h6: measure(style.headings.h6.size, headingLineHeight(style.headings.h6.size)),
    code: measure(style.blocks.codeSize, bodyLineHeight),
  };
}

function splitFrontmatter(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  if (!lines[0] || lines[0].trim() !== '---') {
    return { frontmatter: '', body: markdown };
  }
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') {
      return {
        frontmatter: lines.slice(1, index).join('\n'),
        body: lines.slice(index + 1).join('\n'),
      };
    }
  }
  return { frontmatter: lines.slice(1).join('\n'), body: '' };
}

function extractTemplarBlock(frontmatter) {
  const lines = frontmatter.split('\n');
  const start = lines.findIndex((line) => /^templar:\s*$/.test(line));
  if (start === -1) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\S/.test(lines[index])) { end = index; break; }
  }
  return lines.slice(start + 1, end).join('\n');
}

function compile(style, scopeId, slug) {
  const scope = '[data-templar-scope="' + scopeId + '"]';
  const metrics = fallbackMetrics(style);
  const result = compilePageStyle(style, scope, scopeId, metrics);
  if (result.issues.length > 0) {
    console.warn('Issues compiling ' + slug + ':', result.issues.map((issue) => issue.message).join('; '));
  }
  if (!result.css) throw new Error('Empty stylesheet for ' + slug);
  return result.css;
}

function slugify(filename) {
  return filename
    .replace(/\.md$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function rewriteAssetTargets(html) {
  return html.replace(/src="Assets\/([^"]+)"/g, (match, filename) => 'src="field-guide/' + filename + '"');
}

// Copy the SVG artwork so the live notes can embed it from the site's public root.
await fs.promises.mkdir(assetOutputDir, { recursive: true });
for (const entry of await fs.promises.readdir(assetSourceDir)) {
  if (entry.endsWith('.svg')) {
    await fs.promises.copyFile(path.join(assetSourceDir, entry), path.join(assetOutputDir, entry));
  }
}

const notes = [];
for (const entry of (await fs.promises.readdir(sourceDir)).sort()) {
  if (!entry.endsWith('.md')) continue;
  const markdown = await fs.promises.readFile(path.join(sourceDir, entry), 'utf8');
  const { frontmatter, body } = splitFrontmatter(markdown);
  const templarBlock = extractTemplarBlock(frontmatter);
  if (!templarBlock) throw new Error(entry + ' has no templar frontmatter block');
  const style = styleFromYaml(templarBlock);
  const rendered = renderMarkdown(body);
  const slug = slugify(entry);
  const scopeId = 'templar-live-' + slug;
  notes.push({
    slug,
    basename: entry.replace(/\.md$/i, ''),
    title: rendered.title,
    styleName: style.name,
    styleFolder: style.metadata.folder || '',
    styleDescription: style.metadata.description || '',
    paperColor: style.paper.color || '#fdfaf0',
    accentColor: style.blocks.linkColor || style.headings.h1.color || '#8a3b2c',
    pattern: style.paper.pattern || 'blank',
    scopeId,
    css: compile(style, scopeId, slug),
    html: rewriteAssetTargets(rendered.html),
    bodyLength: rendered.html.length,
  });
}

// ------------------------------------------------------------------------
// Style library: all 132 built-in styles, compiled once each. The demo
// renders every swatch and preview pane from these scoped stylesheets.
// ------------------------------------------------------------------------
const RANKED_PACK_ORDER = [
  'Vintage & Editorial',
  'Dark & Neon',
  'Academia',
  'Journaling & Wellness',
  'Nature',
  'Color Stories',
  'Travel',
  'Professional',
  'Pastels',
  'Seasons',
  'Celebrations & Occasions',
  'Fantasy & Whimsy',
  'Essentials',
];

function rankedTemplates(templates) {
  const byFolder = new Map();
  for (const template of templates) {
    const folder = template.metadata.folder || 'Unfiled';
    if (!byFolder.has(folder)) byFolder.set(folder, []);
    byFolder.get(folder).push(template);
  }
  const ordered = [];
  for (const folder of RANKED_PACK_ORDER) {
    const entries = byFolder.get(folder);
    if (entries) ordered.push(...entries);
  }
  for (const [folder, entries] of byFolder) {
    if (!RANKED_PACK_ORDER.includes(folder)) ordered.push(...entries);
  }
  return ordered;
}

const sampleMarkdown = [
  '# Field Notes',
  '',
  'Today the light moved slowly across the ridge. ==Route planned==, camera packed.',
  '',
  '- Route planned',
  '- Camera packed',
  '- Thermos full',
].join('\n');
const sampleHtml = rewriteAssetTargets(renderMarkdown(sampleMarkdown).html);

const styleSamples = [];
const styleBundleParts = [];
for (const template of rankedTemplates(STYLE_LIBRARY)) {
  const style = { ...template, page: { ...PAGE_DEFAULTS } };
  const scopeId = 'templar-live-sample-' + template.id;
  const css = compile(style, scopeId, 'style sample ' + template.id);
  styleBundleParts.push(css);
  styleSamples.push({
    slug: template.id,
    label: template.name,
    folder: template.metadata.folder || 'Unfiled',
    paperColor: style.paper.color || '#fdfaf0',
    accentColor: style.blocks.linkColor || style.headings.h1.color || '#8a3b2c',
    scopeId,
  });
}
const styleBundle = styleBundleParts.join('\n');
const styleBundleUrl = '/field-guide/style-library.css';
await fs.promises.mkdir(assetOutputDir, { recursive: true });
await fs.promises.writeFile(path.join(assetOutputDir, 'style-library.css'), styleBundle);

// The page-mode demo: one style compiled pageless and paged against a shared sheet.
const pageModeSource = fs.readFileSync(path.join(sourceDir, notes[0].basename + '.md'), 'utf8');
const pageModeStyle = styleFromYaml(extractTemplarBlock(splitFrontmatter(pageModeSource).frontmatter));
const pageModeMarkdown = [
  '# Trip Planning Notes',
  '',
  '**Friday 14 Aug** · 08:12 · *draft, still packing*',
  '',
  '## Packing checklist',
  '',
  '- [x] Tent and footprint',
  '- [x] Stove and fuel canister',
  '- [x] Map and compass',
  '- [ ] First-aid kit',
  '- [ ] Extra batteries',
  '',
  '## Route',
  '',
  '| Day | Leg | Distance | Notes |',
  '| --- | --- | ---: | --- |',
  '| 1 | Trailhead to Meadow Camp | 8.4 km | Water at km 6 |',
  '| 2 | Meadow Camp to Ridge Pass | 11.2 km | ==Exposed after noon== |',
  '| 3 | Ridge Pass to Lake Loop | 9.7 km | Easy descent |',
  '',
  '> [!tip] Leave no trace',
  '> Pack out everything. Fires only in established rings.',
  '',
  '~~~text',
  'Gear weight target: 14.2 kg',
  'Food per day:      0.8 kg',
  '~~~',
  '',
  '## Page behavior',
  '',
  'The stored page width stays fixed. In **paged** mode the entire sheet scales as one unit, preserving line breaks and page positions. Drag the pane-width slider to watch the sheet scale instead of reflow.',
].join('\n');
const pageModeHtml = rewriteAssetTargets(renderMarkdown(pageModeMarkdown).html);
const pagelessStyle = JSON.parse(JSON.stringify(pageModeStyle));
pagelessStyle.page = { mode: 'pageless', size: 'a4', width: 794, height: 1123, gap: 32, scaleToFit: true };
const pagedStyle = JSON.parse(JSON.stringify(pageModeStyle));
pagedStyle.page = { mode: 'paged', size: 'a4', width: 794, height: 1123, gap: 32, scaleToFit: true };
const pageModeDemo = {
  html: pageModeHtml,
  pageless: { scopeId: 'templar-demo-pageless', css: compile(pagelessStyle, 'templar-demo-pageless', 'page-mode pageless') },
  paged: { scopeId: 'templar-demo-paged', css: compile(pagedStyle, 'templar-demo-paged', 'page-mode paged') },
};

const output = {
  generatedAt: new Date().toISOString(),
  notes,
  styleSamples,
  styleBundle: styleBundleUrl,
  sampleHtml,
  pageModeDemo,
};
await fs.promises.mkdir(path.dirname(outputFile), { recursive: true });
await fs.promises.writeFile(outputFile, JSON.stringify(output, null, 2) + '\n');
console.log('Wrote ' + outputFile);
console.log('Notes:', notes.length, '| samples:', styleSamples.length, '| bundle: ' + styleBundle.length + 'B | pageMode css: pageless ' + pageModeDemo.pageless.css.length + 'B, paged ' + pageModeDemo.paged.css.length + 'B');
