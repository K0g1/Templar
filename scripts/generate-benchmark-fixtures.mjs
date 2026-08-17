import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const DEFAULT_OUTPUT = resolve('perf-results/b63adb76/fixtures/vault');
const outputArg = process.argv.find((arg) => arg.startsWith('--output='));
const output = resolve(outputArg?.slice('--output='.length) ?? DEFAULT_OUTPUT);
const seed = 12345;

function rng(initial) {
  let value = initial >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

function pad(number, width = 4) {
  return String(number).padStart(width, '0');
}

function mixedBlock(index, random) {
  const kind = index % 10;
  if (kind === 0) return `## Heading ${pad(index)}\n\nA deterministic heading block for fixture ${pad(index)}.`;
  if (kind === 1) return `- list item ${pad(index)}\n  - nested item ${pad(index)}\n  - another nested item`;
  if (kind === 2) return `> Quote block ${pad(index)} with seed value ${String(Math.floor(random() * 1000))}.`;
  if (kind === 3) return '```ts\nconst fixtureValue = 12345;\nconsole.log(fixtureValue);\n```';
  if (kind === 4) return `| key | value |\n| --- | --- |\n| ${pad(index)} | deterministic |`;
  if (kind === 5) return `> [!warning] Variable callout ${pad(index)}\n> This block is intentionally synthetic.`;
  if (kind === 6) return `1. ordered item ${pad(index)}\n2. second ordered item`;
  if (kind === 7) return `---\n\nDivider block ${pad(index)}.`;
  if (kind === 8) return `**Bold ${pad(index)}** with ==highlight==, [a link](https://example.invalid/${pad(index)}), and inline code.`;
  return `Paragraph ${pad(index)} with stable text generated from seed 12345.`;
}

function mixedNote(blocks, options = {}) {
  const random = rng(seed + blocks + (options.variant ?? 0));
  const blocksText = Array.from({ length: blocks }, (_, index) => mixedBlock(index, random)).join('\n\n');
  const images = options.images ?? 0;
  const imageText = images > 0
    ? `\n\n${Array.from({ length: images }, (_, index) => `![[Assets/fixture-image-${pad(index + 1)}.svg]]`).join('\n\n')}`
    : '';
  return `${options.frontmatter ?? ''}${blocksText}${imageText}\n`;
}

function sectionNote(sections) {
  return Array.from({ length: sections }, (_, index) =>
    `## Reading section ${pad(index + 1)}\n\nSection ${pad(index + 1)} contains deterministic Reading whitespace input.`,
  ).join('\n\n') + '\n';
}

function variableBlockNote() {
  const intro = mixedNote(500);
  const variable = Array.from({ length: 100 }, (_, index) => {
    if (index % 4 === 0) return `> [!note] Callout ${pad(index)}\n> Variable block content.`;
    if (index % 4 === 1) return `\`\`\`mermaid\ngraph TD\n  A${pad(index)} --> B${pad(index)}\n\`\`\``;
    if (index % 4 === 2) return `<details>\n<summary>Details ${pad(index)}</summary>\nExpanded deterministic content.\n</details>`;
    return `| row | value |\n| --- | --- |\n| ${pad(index)} | variable |`;
  }).join('\n\n');
  return `${intro}\n\n${variable}\n`;
}

function longParagraphNote() {
  const sentence = 'Long deterministic paragraph text keeps DOM block count separate from text volume. ';
  return Array.from({ length: 100 }, (_, index) =>
    `## Long paragraph ${pad(index + 1)}\n\n${sentence.repeat(30)}\n`,
  ).join('\n');
}

function frontmatterHeavyNote() {
  const properties = Array.from({ length: 100 }, (_, index) => `  unrelated-${pad(index)}: value-${pad(index)}`).join('\n');
  return `---\ntemplar-fixture: true\nfixture-seed: 12345\n${properties}\n---\n\n${mixedNote(500)}`;
}

const fixtures = [
  { fixtureId: 'F001', name: 'small-plain', content: mixedNote(100), blocks: 100, sections: 0, images: 0, variableBlocks: 0 },
  { fixtureId: 'F002', name: 'medium-mixed', content: mixedNote(500), blocks: 500, sections: 0, images: 0, variableBlocks: 50 },
  { fixtureId: 'F003', name: 'large-mixed', content: mixedNote(2000), blocks: 2000, sections: 0, images: 0, variableBlocks: 200 },
  { fixtureId: 'F004', name: 'xl-mixed', content: mixedNote(10000), blocks: 10000, sections: 0, images: 0, variableBlocks: 1000 },
  ...[100, 500, 1000, 2000, 5000].map((sections) => ({
    fixtureId: `F005-${String(sections)}`,
    name: `reading-sections-${String(sections)}`,
    content: sectionNote(sections),
    blocks: sections,
    sections,
    images: 0,
    variableBlocks: 0,
  })),
  { fixtureId: 'F006', name: 'image-heavy', content: mixedNote(500, { images: 100, variant: 6 }), blocks: 500, sections: 0, images: 100, variableBlocks: 50 },
  { fixtureId: 'F007', name: 'variable-block-heavy', content: variableBlockNote(), blocks: 600, sections: 0, images: 0, variableBlocks: 100 },
  { fixtureId: 'F008', name: 'live-preview-line-heavy', content: Array.from({ length: 2000 }, (_, index) => `Live Preview line ${pad(index + 1)} with deterministic editor content.`).join('\n') + '\n', blocks: 2000, sections: 0, images: 0, variableBlocks: 0 },
  { fixtureId: 'F009', name: 'long-paragraphs', content: longParagraphNote(), blocks: 100, sections: 0, images: 0, variableBlocks: 0 },
  { fixtureId: 'F010', name: 'frontmatter-heavy', content: frontmatterHeavyNote(), blocks: 500, sections: 0, images: 0, variableBlocks: 50 },
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await mkdir(join(output, 'Assets'), { recursive: true });

const svg = (hue) => `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="320" height="180" fill="hsl(${String(hue)} 45% 25%)"/><circle cx="160" cy="90" r="58" fill="hsl(${String((hue + 120) % 360)} 65% 65%)"/></svg>\n`;
for (let index = 0; index < 4; index += 1) {
  await writeFile(join(output, 'Assets', `fixture-image-${pad(index + 1)}.svg`), svg((index * 83) % 360));
}

const manifests = [];
for (const fixture of fixtures) {
  const path = join(output, `${fixture.fixtureId}-${fixture.name}.md`);
  const lines = fixture.content.split('\n').length - 1;
  const manifest = {
    fixtureId: fixture.fixtureId,
    seed,
    blocks: fixture.blocks,
    sections: fixture.sections,
    images: fixture.images,
    variableBlocks: fixture.variableBlocks,
    lines,
    file: `${fixture.fixtureId}-${fixture.name}.md`,
  };
  await writeFile(path, fixture.content);
  await writeFile(`${path}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  manifests.push(manifest);
}

await writeFile(join(output, 'MANIFEST.json'), `${JSON.stringify({ schemaVersion: 1, seed, fixtures: manifests }, null, 2)}\n`);
await writeFile(join(output, 'README.md'), [
  '# Synthetic benchmark fixtures',
  '',
  `Generated with seed ${String(seed)} by \`scripts/generate-benchmark-fixtures.mjs\`.`,
  '',
  'All notes and SVGs in this directory are synthetic and contain no private vault data or network references used at runtime.',
  '',
].join('\n'));
console.log(`Generated ${String(fixtures.length)} fixture families in ${output}`);
