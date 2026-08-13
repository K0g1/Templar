// render-field-guide.mjs — compiles the real Templar stylesheet for each field-guide note
// (via the bundled plugin compiler) and renders the note bodies as Obsidian-reading-view
// HTML. Output is consumed by the Astro components; the website displays live HTML, never
// screenshots.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compilePageStyle } from './vendor/style-compiler.bundle.cjs';
import { renderMarkdown, styleFromYaml } from './lib/note-render.mjs';

const websiteDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootDir = path.resolve(websiteDir, '..');
const sourceDir = path.join(rootDir, 'examples', 'Templar Field Guide');
const assetSourceDir = path.join(sourceDir, 'Assets');
const assetOutputDir = path.join(websiteDir, 'public', 'field-guide');
const outputFile = path.join(websiteDir, 'src', 'data', 'field-guide.generated.json');

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

// A tiny shared sample note for the interactive style demo.
const sampleMarkdown = [
  '# Field Notes',
  '',
  'Today the light moved slowly across the ridge.',
  '',
  '- Route planned',
  '- Camera packed',
  '- Thermos full',
].join('\n');
const sampleHtml = rewriteAssetTargets(renderMarkdown(sampleMarkdown).html);
const styleSamples = notes.map((note) => {
  // Rebuild the style from its own note to produce a scoped stylesheet for the sample.
  const sourceMarkdown = fs.readFileSync(path.join(sourceDir, note.basename + '.md'), 'utf8');
  const style = styleFromYaml(extractTemplarBlock(splitFrontmatter(sourceMarkdown).frontmatter));
  const scopeId = note.scopeId + '-sample';
  return {
    slug: note.slug,
    label: note.styleName,
    paperColor: style.paper.color || '#fdfaf0',
    accentColor: style.blocks.linkColor || style.headings.h1.color || '#8a3b2c',
    scopeId,
    css: compile(style, scopeId, note.slug + ' sample'),
  };
});

// The page-mode demo: one style compiled pageless and paged against a shared sheet.
const pageModeSource = fs.readFileSync(path.join(sourceDir, notes[0].basename + '.md'), 'utf8');
const pageModeStyle = styleFromYaml(extractTemplarBlock(splitFrontmatter(pageModeSource).frontmatter));
const pageModeMarkdown = [
  '# One design. Two ways to read it.',
  '',
  'The stored page width remains fixed. In paged mode the entire sheet scales as one unit, preserving line breaks and page positions.',
  '',
  '![[Assets/field-manual-compass.svg]]',
  '',
  '| Item | Packed |',
  '| --- | ---: |',
  '| Rope | 12 m |',
  '| Water | 2 L |',
  '| Map | 1:25k |',
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
  sampleHtml,
  pageModeDemo,
};
await fs.promises.mkdir(path.dirname(outputFile), { recursive: true });
await fs.promises.writeFile(outputFile, JSON.stringify(output, null, 2) + '\n');
console.log('Wrote ' + outputFile);
console.log('Notes:', notes.length, '| samples:', styleSamples.length, '| pageMode css: pageless ' + pageModeDemo.pageless.css.length + 'B, paged ' + pageModeDemo.paged.css.length + 'B');
