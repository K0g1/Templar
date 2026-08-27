/* @vitest-environment happy-dom */
/* global process -- the stress benchmark is an explicit test-only opt-in. */

import { afterAll, bench, describe } from 'vitest';
import type { WorkspaceLeaf } from 'obsidian';
import { BaselineGridController } from '../src/services/rendering/baseline-grid/controller';
import { BUILT_IN_TEMPLATES } from '../src/templates/builtins';
import { templateToNoteStyle } from '../src/templates/note-format';
import type { FontMetrics } from '../src/types';
import type { PageMetricSet } from '../src/services/style-compiler';
import { createObserverHarness } from './harness/dom-realm';
import { installObsidianDomExtensions } from './harness/obsidian';

const metric: FontMetrics = { baseline: 14, ascent: 11, descent: 4, lineHeight: 30, measuredAt: 0 };
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
const options = { iterations: 1, time: 20, warmupIterations: 0, warmupTime: 0 };
const counts = process.env.TEMPLAR_BENCH_STRESS === '1' ? [5_000, 10_000] : [100, 1_000, 10_000];

function fixture(count: number): { harness: ReturnType<typeof createObserverHarness>; root: HTMLElement; leaf: WorkspaceLeaf } {
  const harness = createObserverHarness();
  installObsidianDomExtensions(harness.window);
  harness.window.getComputedStyle = (() => ({
    borderTopWidth: '0px',
    float: 'none',
    marginBlockEnd: '0px',
    marginBlockStart: '0px',
    marginBottom: '0px',
    marginTop: '0px',
    paddingTop: '0px',
  })) as unknown as typeof harness.window.getComputedStyle;
  const root = harness.window.document.createElement('div');
  root.className = 'templar-page';
  const content = harness.window.document.createElement('div');
  content.className = 'templar-page-content markdown-preview-sizer';
  const section = harness.window.document.createElement('div');
  section.className = 'markdown-preview-section';
  for (let index = 0; index < count; index += 1) {
    const kind = index % 10;
    const block = harness.window.document.createElement(
      kind === 0 ? 'h2' : kind === 1 ? 'blockquote' : kind === 2 ? 'ul' :
        kind === 3 ? 'pre' : kind === 4 ? 'table' : kind === 5 ? 'div' :
          kind === 6 ? 'div' : kind === 7 ? 'img' : kind === 8 ? 'hr' : 'p',
    );
    if (kind === 1) {
      const quote = harness.window.document.createElement('p');
      quote.textContent = `Quoted ${String(index)}`;
      block.append(quote);
    } else if (kind === 2) {
      const item = harness.window.document.createElement('li');
      item.textContent = `Item ${String(index)}`;
      block.append(item);
    } else if (kind === 3) {
      const code = harness.window.document.createElement('code');
      code.textContent = `code ${String(index)}`;
      block.append(code);
    } else if (kind === 4) {
      const row = harness.window.document.createElement('tr');
      row.append(harness.window.document.createElement('td'));
      block.append(row);
    } else if (kind === 5) {
      block.className = 'callout';
    } else if (kind === 6) {
      block.className = 'block-language-mermaid';
    }
    block.textContent ||= `Benchmark block ${String(index)}`;
    section.append(block);
  }
  content.append(section);
  root.append(content);
  harness.window.document.body.append(root);
  return { harness, root, leaf: {} as WorkspaceLeaf };
}

const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
style.baseline.enabled = true;
style.baseline.mode = 'balanced';

const fixtures = counts.map((count) => fixture(count));
afterAll(() => {
  for (const value of fixtures) value.harness.window.close();
});

describe('fixed baseline-grid performance', () => {
  for (const [index, count] of counts.entries()) {
    const value = fixtures[index]!;
    bench(`${String(count)} Reading blocks / one full scan`, () => {
      const controller = new BaselineGridController();
      controller.configure(value.leaf, { contentEl: value.root, style, metrics });
      controller.clear(value.leaf);
    }, options);
  }
});
