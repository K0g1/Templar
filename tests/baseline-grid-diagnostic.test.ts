/* @vitest-environment happy-dom */

import { describe, expect, it } from 'vitest';
import {
  diagnoseBaselineAlignment,
  formatBaselineDiagnostic,
} from '../src/services/baseline-diagnostic';
import type { PageMetricSet } from '../src/services/style-compiler';
import { installObsidianDomExtensions } from './harness/obsidian';

const metric = { baseline: 21, ascent: 14, descent: 4, lineHeight: 30, measuredAt: 0 };
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

function rect(top: number, height: number, width = 800): DOMRect {
  return { top, bottom: top + height, left: 0, right: width, width, height, x: 0, y: top, toJSON: () => ({}) };
}

function setRect(element: HTMLElement, value: DOMRect): void {
  Object.defineProperty(element, 'getBoundingClientRect', { configurable: true, value: () => value });
  Object.defineProperty(element, 'offsetWidth', { configurable: true, value: value.width });
  Object.defineProperty(element, 'offsetHeight', { configurable: true, value: value.height });
}

function fixture(): { host: HTMLElement; root: HTMLElement; content: HTMLElement; paragraph: HTMLElement; image: HTMLElement } {
  const owner = window.open() as Window;
  installObsidianDomExtensions(owner);
  const root = owner.document.createElement('div');
  root.className = 'templar-page';
  root.dataset.templarMode = 'pageless';
  const content = owner.document.createElement('div');
  content.className = 'templar-page-content markdown-preview-sizer';
  content.setCssProps({
    '--templar-grid': '30px',
    '--templar-grid-origin': '81px',
    '--templar-page-width': '794px',
    '--templar-page-height': '1123px',
    '--templar-page-span': '1170px',
  });
  const section = owner.document.createElement('div');
  section.className = 'markdown-preview-section';
  const paragraph = owner.document.createElement('p');
  paragraph.textContent = 'Agpqy descenders';
  const image = owner.document.createElement('img');
  const blank = owner.document.createElement('div');
  blank.className = 'templar-blank-line-spacer templar-baseline-grid-item';
  blank.dataset.templarBaselineOwner = 'true';
  blank.setCssProps({ '--templar-blank-lines': '1' });
  const table = owner.document.createElement('table');
  const row = owner.document.createElement('tr');
  const cell = owner.document.createElement('td');
  cell.textContent = 'Cell';
  row.append(cell);
  table.append(row);
  const callout = owner.document.createElement('div');
  callout.className = 'callout templar-baseline-grid-item';
  callout.dataset.templarBaselineOwner = 'true';
  const title = owner.document.createElement('div');
  title.className = 'callout-title';
  title.textContent = 'Title';
  const body = owner.document.createElement('div');
  body.className = 'callout-content';
  const bodyParagraph = owner.document.createElement('p');
  bodyParagraph.textContent = 'Body';
  body.append(bodyParagraph);
  callout.append(title, body);
  const divider = owner.document.createElement('hr');
  for (const item of [paragraph, image, table, divider]) {
    item.classList.add('templar-baseline-grid-item');
    item.dataset.templarBaselineOwner = 'true';
  }
  section.append(paragraph, image, blank, table, callout, divider);
  content.append(section);
  root.append(content);
  const host = owner.document.createElement('div');
  host.append(root);
  owner.document.body.append(host);

  setRect(root, rect(0, 321));
  setRect(content, rect(0, 321));
  setRect(section, rect(0, 321));
  setRect(paragraph, rect(60, 51));
  setRect(image, rect(111, 30, 240));
  setRect(blank, rect(141, 30));
  setRect(table, rect(171, 30));
  setRect(row, rect(180, 30));
  setRect(cell, rect(180, 30, 200));
  setRect(callout, rect(201, 60));
  setRect(title, rect(180, 30));
  setRect(body, rect(210, 30));
  setRect(bodyParagraph, rect(210, 30));
  setRect(divider, rect(261, 30));
  return { host, root, content, paragraph, image };
}

function liveFixture(): { host: HTMLElement; gap: HTMLElement; line: HTMLElement } {
  const owner = window.open() as Window;
  installObsidianDomExtensions(owner);
  const root = owner.document.createElement('div');
  root.className = 'templar-page';
  root.dataset.templarMode = 'pageless';
  const content = owner.document.createElement('div');
  content.className = 'templar-page-content cm-sizer';
  content.setCssProps({
    '--templar-grid': '30px',
    '--templar-grid-origin': '81px',
    '--templar-page-width': '794px',
    '--templar-page-height': '1123px',
    '--templar-page-span': '1170px',
  });
  const editor = owner.document.createElement('div');
  editor.className = 'cm-content';
  const gap = owner.document.createElement('div');
  gap.className = 'cm-gap templar-baseline-grid-item templar-baseline-grid-atomic';
  gap.dataset.templarBaselineOwner = 'true';
  const line = owner.document.createElement('div');
  line.className = 'cm-line';
  line.textContent = 'Live text';
  editor.append(gap, line);
  content.append(editor);
  root.append(content);
  const host = owner.document.createElement('div');
  host.append(root);
  owner.document.body.append(host);
  setRect(root, rect(0, 500));
  setRect(content, rect(0, 500));
  setRect(editor, rect(0, 500));
  setRect(gap, rect(111, 39));
  setRect(line, rect(150, 30));
  return { host, gap, line };
}

describe('detailed ruled-line diagnostic', () => {
  it('checks text, blocks, widgets, rows, images, and blank spacers on the same lattice', () => {
    const test = fixture();
    const report = diagnoseBaselineAlignment(test.host, metrics);
    expect(report.gridUnit).toBe(30);
    expect(report.gridOrigin).toBe(81);
    expect(report.textChecked).toBeGreaterThanOrEqual(1);
    expect(report.blocksChecked).toBe(6);
    expect(report.widgetsChecked).toBeGreaterThanOrEqual(2);
    expect(report.failures).toEqual([]);
    expect(formatBaselineDiagnostic(report)).toContain('Ruled-line check PASS');
    test.host.ownerDocument.defaultView?.close();
  });

  it('identifies a fractional text baseline with a structured failure record', () => {
    const test = fixture();
    setRect(test.paragraph, rect(61, 51));
    const report = diagnoseBaselineAlignment(test.host, metrics);
    const failure = report.failures.find((candidate) => candidate.kind === 'text-baseline');
    expect(failure).toMatchObject({ tag: 'p', textPreview: 'Agpqy descenders', pageIndex: 0 });
    expect(failure?.error).toBeCloseTo(1);
    expect(report.failureCount).toBeGreaterThan(0);
    test.host.ownerDocument.defaultView?.close();
  });

  it('validates a composite blockquote by its first semantic text baseline', () => {
    const test = fixture();
    const section = test.content.querySelector<HTMLElement>('.markdown-preview-section')!;
    const blockquote = test.content.ownerDocument.createElement('div');
    blockquote.className = 'el-blockquote templar-baseline-grid-item templar-baseline-grid-atomic';
    blockquote.dataset.templarBaselineOwner = 'true';
    const quote = test.content.ownerDocument.createElement('blockquote');
    const paragraph = test.content.ownerDocument.createElement('p');
    paragraph.textContent = 'A quoted paragraph';
    quote.append(paragraph);
    blockquote.append(quote);
    section.append(blockquote);
    // The wrapper has a nine-pixel border/padding offset. Its text baseline is
    // on the lattice even though its border-box top is not.
    setRect(blockquote, rect(291, 30));
    setRect(quote, rect(291, 30));
    setRect(paragraph, rect(300, 21));
    const report = diagnoseBaselineAlignment(test.host, metrics);
    expect(report.failures.filter((candidate) => candidate.tag === 'div' && candidate.classes.includes('el-blockquote'))).toEqual([]);
    expect(report.failures).toEqual([]);
    test.host.ownerDocument.defaultView?.close();
  });

  it('validates a Live Preview virtual gap against the following line baseline', () => {
    const test = liveFixture();
    const report = diagnoseBaselineAlignment(test.host, metrics);
    expect(report.viewType).toBe('live-preview');
    expect(report.widgetsChecked).toBe(1);
    expect(report.failures).toEqual([]);
    test.host.ownerDocument.defaultView?.close();
  });
});
