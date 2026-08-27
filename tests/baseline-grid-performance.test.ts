/* @vitest-environment happy-dom */

import { describe, expect, it } from 'vitest';
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

function largeFixture(count: number): { harness: ReturnType<typeof createObserverHarness>; root: HTMLElement; image: HTMLElement } {
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
  const first = harness.window.document.createElement('p');
  first.textContent = 'First';
  const image = harness.window.document.createElement('img');
  section.append(first, image);
  for (let index = 2; index < count; index += 1) {
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
      block.append(
        harness.window.document.createElement('div'),
        harness.window.document.createElement('div'),
      );
    } else if (kind === 6) {
      block.className = 'block-language-mermaid';
    }
    block.textContent ||= `Block ${String(index)}`;
    section.append(block);
  }
  content.append(section);
  root.append(content);
  harness.window.document.body.append(root);
  return { harness, root, image };
}

describe('baseline-grid structural performance', () => {
  it('processes a 10,000-block mixed document and a resized image without a second full scan', async () => {
    const fixture = largeFixture(10_000);
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    style.baseline.enabled = true;
    style.baseline.mode = 'balanced';
    style.baseline.unit = 30;
    const controller = new BaselineGridController();
    const leaf = {} as WorkspaceLeaf;
    controller.configure(leaf, { contentEl: fixture.root, style, metrics });
    const initial = controller.stats(leaf)!;
    expect(initial.fullScans).toBe(1);
    expect(initial.nodesMeasured).toBeGreaterThanOrEqual(10_000);
    expect(initial.measurementPasses).toBeGreaterThanOrEqual(2);

    const observer = fixture.harness.resizeInstances[0];
    expect(observer).toBeDefined();
    observer!.callback([{
      target: fixture.image,
      contentRect: fixture.image.getBoundingClientRect(),
      borderBoxSize: [],
      contentBoxSize: [],
      devicePixelContentBoxSize: [],
    }], {} as ResizeObserver);
    await Promise.resolve();

    const after = controller.stats(leaf)!;
    expect(after.fullScans).toBe(1);
    expect(after.dirtyScans).toBe(1);
    expect(after.nodesMeasured - initial.nodesMeasured).toBe(1);
    expect(after.nonConvergedElements).toEqual([]);
    controller.destroy();
    fixture.harness.window.close();
  }, 30_000);
});
