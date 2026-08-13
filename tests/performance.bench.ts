import { bench, describe } from 'vitest';
import { BUILT_IN_TEMPLATES } from '../src/templates/builtins';
import { templateToNoteStyle } from '../src/templates/note-format';
import { normalizeTemplate } from '../src/templates/schema';
import { compilePageStyle, type PageMetricSet } from '../src/services/style-compiler';
import { firstMatchingRule } from '../src/services/style-rules';
import { internalBlankLineRuns } from '../src/services/reading-whitespace';
import { alignedPageGap, gridCompensation } from '../src/utils/grid';
import { clone } from '../src/utils/value';
import type { FontMetrics, StyleRule } from '../src/types';

const metric: FontMetrics = {
  baseline: 14,
  ascent: 11,
  descent: 4,
  lineHeight: 24,
  measuredAt: 0,
};
const metrics: PageMetricSet = {
  body: metric,
  h1: metric,
  h2: metric,
  h3: metric,
  h4: metric,
  h5: metric,
  h6: metric,
  code: metric,
};
const noteStyle = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
const sourceBySize = new Map(
  [100, 1_000, 5_000, 10_000].map((blocks) => [
    blocks,
    Array.from({ length: blocks }, (_, index) => `Paragraph ${String(index)}\n`).join(''),
  ]),
);
const catalogBySize = new Map(
  [132, 500, 1_000].map((count) => [
    count,
    Array.from({ length: count }, (_, index) => normalizeTemplate({
      ...clone(BUILT_IN_TEMPLATES[index % BUILT_IN_TEMPLATES.length]!),
      id: `benchmark-${String(index)}`,
    })),
  ]),
);
const rule: StyleRule = {
  id: 'benchmark-rule',
  name: 'Benchmark rule',
  enabled: true,
  conditions: [{ type: 'folder', folder: 'Projects', includeSubfolders: true }],
  templateId: 'classic-ruled',
  pageFlow: 'default',
};

describe('Templar pure performance fixtures', () => {
  for (const blocks of [100, 1_000, 5_000, 10_000]) {
    bench(`reading whitespace scan: ${String(blocks)} blocks`, () => {
      internalBlankLineRuns(sourceBySize.get(blocks)!);
    });
  }

  bench('structured compiler: representative style', () => {
    compilePageStyle(noteStyle, '[data-templar-scope="bench"]', 'bench', metrics);
  });

  for (const count of [132, 500, 1_000]) {
    bench(`catalog normalization: ${String(count)} templates`, () => {
      for (const template of catalogBySize.get(count)!) normalizeTemplate(template);
    });
  }

  for (const count of [1_000, 10_000]) {
    const notes = Array.from({ length: count }, (_, index) => ({
      path: `Projects/Note-${String(index)}.md`,
      basename: `Note-${String(index)}`,
      folder: 'Projects/Subfolder',
      tags: [],
      frontmatter: {},
      metadataReady: true,
    }));
    bench(`vault rule matching: ${String(count)} files`, () => {
      for (const note of notes) firstMatchingRule([rule], note);
    });
  }

  for (const page of ['A4', 'Letter', 'Custom']) {
    const height = page === 'A4' ? 1123 : page === 'Letter' ? 1056 : 1440;
    bench(`pagination math: ${page}`, () => {
      for (let index = 0; index < 10_000; index += 1) {
        gridCompensation(height + index % 37, 24);
        alignedPageGap(height, 32, 24);
      }
    });
  }
});
