/* @vitest-environment happy-dom */

import { bench, describe } from 'vitest';
import type { WorkspaceLeaf } from 'obsidian';
import { BUILT_IN_TEMPLATES } from '../src/templates/builtins';
import { templateToNoteStyle } from '../src/templates/note-format';
import { ImageSnapController } from '../src/services/rendering/image-snap-controller';
import { PaperOriginController } from '../src/services/rendering/paper-origin-controller';
import { VariableBlockRhythmController } from '../src/services/rendering/variable-block-rhythm-controller';
import type { PageMetricSet } from '../src/services/style-compiler';
import { createObserverHarness } from './harness/dom-realm';
import { installObsidianDomExtensions } from './harness/obsidian';

const metric = { baseline: 14, ascent: 11, descent: 4, lineHeight: 24, measuredAt: 0 };
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

function fixture(blocks: number, images: number): {
  content: HTMLElement;
  leaves: WorkspaceLeaf[];
  window: Window;
} {
  const harness = createObserverHarness();
  installObsidianDomExtensions(harness.window);
  // Keep the benchmark focused on DOM ownership/scanning. Browser CSS
  // computation is a separate engine concern and makes large happy-dom
  // fixtures needlessly hardware-sensitive.
  harness.window.getComputedStyle = (() => ({
    borderTopWidth: '0px',
    marginBlockEnd: '0px',
    marginBlockStart: '0px',
    marginBottom: '0px',
    marginTop: '0px',
    paddingTop: '0px',
  })) as unknown as typeof harness.window.getComputedStyle;
  const content = harness.window.document.createElement('div');
  const page = harness.window.document.createElement('div');
  page.className = 'templar-page';
  const pageContent = harness.window.document.createElement('div');
  pageContent.className = 'templar-page-content';
  page.append(pageContent);
  content.append(page);
  for (let index = 0; index < blocks; index += 1) {
    const kind = index % 8;
    const block = harness.window.document.createElement(
      kind === 1 ? 'h2' : kind === 2 ? 'ul' : kind === 3 ? 'blockquote' : kind === 4 ? 'pre' : kind === 5 ? 'table' : kind === 6 ? 'div' : kind === 7 ? 'figure' : 'p',
    );
    if (kind === 2) {
      const item = harness.window.document.createElement('li');
      const nested = harness.window.document.createElement('ul');
      nested.append(harness.window.document.createElement('li'));
      item.append(nested);
      block.append(item);
    }
    if (kind === 5) block.append(harness.window.document.createElement('tr'));
    if (kind === 6) {
      block.className = 'callout';
      block.dataset.callout = 'warning';
      block.append(harness.window.document.createElement('div'));
    }
    if (kind === 7) {
      block.className = 'templar-variable-block';
      block.style.height = `${String(48 + (index % 5) * 24)}px`;
    }
    block.textContent = `Block ${String(index)}`;
    pageContent.append(block);
  }
  for (let index = 0; index < images; index += 1) {
    pageContent.append(harness.window.document.createElement('img'));
  }
  harness.window.document.body.append(content);
  return {
    content,
    leaves: Array.from({ length: 10 }, () => ({}) as WorkspaceLeaf),
    window: harness.window,
  };
}

const styles = {
  pageless: templateToNoteStyle(BUILT_IN_TEMPLATES[0]!),
  paged: templateToNoteStyle(BUILT_IN_TEMPLATES[0]!),
};
styles.paged.page.mode = 'paged';
styles.paged.baseline.snapImages = true;

// DOM scans are intentionally sampled briefly: these fixtures are for relative
// comparisons, not for a hardware-sensitive pass/fail threshold.
const rendererBenchOptions = {
  iterations: 1,
  time: 20,
  warmupIterations: 0,
  warmupTime: 0,
};

let activeFixture: { key: string; value: ReturnType<typeof fixture> } | undefined;
function fixtureForBenchmark(key: string, blocks: number, images: number): ReturnType<typeof fixture> {
  if (activeFixture?.key === key) return activeFixture.value;
  activeFixture?.value.window.close();
  const value = fixture(blocks, images);
  activeFixture = { key, value };
  return value;
}

describe('renderer controller performance fixtures', () => {
  for (const blocks of [100, 1_000, 5_000, 10_000]) {
    describe(`${String(blocks)} block fixture`, () => {
      for (const mode of ['pageless', 'paged'] as const) {
        for (const leafCount of [1, 3, 10]) {
          bench(`${String(blocks)} blocks / same file / ${mode} / ${String(leafCount)} leaves`, () => {
            const testFixture = fixtureForBenchmark(`blocks:${String(blocks)}`, blocks, 0);
            const image = new ImageSnapController();
            const paper = new PaperOriginController();
            const rhythm = new VariableBlockRhythmController();
            for (const leaf of testFixture.leaves.slice(0, leafCount)) {
              image.configure(leaf, testFixture.content, styles[mode]);
              paper.configure(leaf, testFixture.content, styles[mode], metrics);
              rhythm.configure(leaf, testFixture.content, styles[mode]);
              image.clear(leaf, testFixture.content);
              paper.clear(leaf, testFixture.content);
              rhythm.clear(leaf, testFixture.content);
            }
          }, rendererBenchOptions);
        }
      }
    });
  }

  describe('image fixture', () => {
    bench('100 data-free images / one leaf', () => {
      const imageFixture = fixtureForBenchmark('images:100', 100, 100);
      const controller = new ImageSnapController();
      const leaf = imageFixture.leaves[0]!;
      controller.configure(leaf, imageFixture.content, styles.pageless);
      controller.clear(leaf, imageFixture.content);
    }, rendererBenchOptions);
  });
});
