/* @vitest-environment happy-dom */

import { describe, expect, it } from 'vitest';
import type { WorkspaceLeaf } from 'obsidian';
import { BaselineGridController } from '../src/services/rendering/baseline-grid/controller';
import { BUILT_IN_TEMPLATES } from '../src/templates/builtins';
import { templateToNoteStyle } from '../src/templates/note-format';
import { installObsidianDomExtensions } from './harness/obsidian';

interface ManualObserverHarness {
  window: Window;
  resize: { callback: (entries: ResizeObserverEntry[]) => void; observed: Element[]; disconnects: number };
  mutation: { callback: MutationCallback; observed: Element[]; disconnects: number };
  frames: Map<number, FrameRequestCallback>;
}

function harness(): ManualObserverHarness {
  const owner = window.open() as Window;
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 1;
  const resize = { callback: (_entries: ResizeObserverEntry[]) => undefined, observed: [] as Element[], disconnects: 0 };
  const mutation = { callback: (() => undefined) as MutationCallback, observed: [] as Element[], disconnects: 0 };
  class TestResizeObserver {
    public constructor(callback: ResizeObserverCallback) {
      resize.callback = (entries) => { callback(entries, this); };
    }
    public observe(element: Element): void { resize.observed.push(element); }
    public unobserve(element: Element): void { resize.observed.splice(resize.observed.indexOf(element), 1); }
    public disconnect(): void { resize.disconnects += 1; }
  }
  class TestMutationObserver {
    public constructor(callback: MutationCallback) { mutation.callback = callback; }
    public observe(element: Element): void { mutation.observed.push(element); }
    public disconnect(): void { mutation.disconnects += 1; }
    public takeRecords(): MutationRecord[] { return []; }
  }
  Object.defineProperty(owner, 'ResizeObserver', { configurable: true, value: TestResizeObserver });
  Object.defineProperty(owner, 'MutationObserver', { configurable: true, value: TestMutationObserver });
  Object.defineProperty(owner, 'requestAnimationFrame', {
    configurable: true,
    value: (callback: FrameRequestCallback): number => {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    },
  });
  Object.defineProperty(owner, 'cancelAnimationFrame', {
    configurable: true,
    value: (id: number): void => { frames.delete(id); },
  });
  installObsidianDomExtensions(owner);
  return { window: owner, resize, mutation, frames };
}

function styledRoot(owner: Window): { root: HTMLElement; content: HTMLElement; paragraph: HTMLElement; image: HTMLElement } {
  const root = owner.document.createElement('div');
  root.className = 'templar-page';
  root.setCssProps({ '--templar-grid': '30px' });
  const content = owner.document.createElement('div');
  content.className = 'templar-page-content markdown-preview-sizer';
  content.setCssProps({ '--templar-grid-origin': '81px', '--templar-page-span': '1170px' });
  const section = owner.document.createElement('div');
  section.className = 'markdown-preview-section';
  const paragraph = owner.document.createElement('p');
  paragraph.textContent = 'A paragraph with fractional geometry.';
  const image = owner.document.createElement('img');
  section.append(paragraph, image);
  content.append(section);
  root.append(content);
  owner.document.body.append(root);
  return { root, content, paragraph, image };
}

function rect(top: number, height: number, width = 800): DOMRect {
  return { top, bottom: top + height, left: 0, right: width, width, height, x: 0, y: top, toJSON: () => ({}) };
}

function setRect(element: HTMLElement, value: DOMRect): void {
  Object.defineProperty(element, 'getBoundingClientRect', { configurable: true, value: () => value });
  Object.defineProperty(element, 'offsetWidth', { configurable: true, value: value.width });
  Object.defineProperty(element, 'offsetHeight', { configurable: true, value: value.height });
}

function liveRoot(owner: Window): { root: HTMLElement; content: HTMLElement; line: HTMLElement; widget: HTMLElement } {
  const root = owner.document.createElement('div');
  root.className = 'templar-page';
  const content = owner.document.createElement('div');
  content.className = 'templar-page-content cm-sizer';
  content.setCssProps({ '--templar-grid-origin': '81px', '--templar-page-span': '1170px' });
  const editor = owner.document.createElement('div');
  editor.className = 'cm-content';
  const line = owner.document.createElement('div');
  line.className = 'cm-line HyperMD-paragraph';
  line.textContent = 'Live line';
  const widget = owner.document.createElement('div');
  widget.className = 'cm-table-widget';
  widget.textContent = 'Rendered table widget';
  editor.append(line, widget);
  content.append(editor);
  root.append(content);
  owner.document.body.append(root);
  return { root, content, line, widget };
}

function testStyle() {
  const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
  style.baseline.enabled = true;
  style.baseline.mode = 'balanced';
  style.baseline.unit = 30;
  style.baseline.snapImages = true;
  return style;
}

function testMetrics() {
  const metric = { baseline: 21, ascent: 14, descent: 4, lineHeight: 30, measuredAt: 0 };
  return { body: metric, h1: metric, h2: metric, h3: metric, h4: metric, h5: metric, h6: metric, code: metric };
}

describe('BaselineGridController', () => {
  it('uses one fixed origin and does not respond to ordinary scrolling', () => {
    const owner = harness();
    const dom = styledRoot(owner.window);
    const controller = new BaselineGridController();
    const leaf = {} as WorkspaceLeaf;
    controller.configure(leaf, { contentEl: dom.root, style: testStyle(), metrics: testMetrics() });
    const before = controller.stats(leaf)!;
    dom.root.dispatchEvent(new Event('scroll'));
    expect(controller.stats(leaf)).toEqual(before);
    expect(dom.content.style.getPropertyValue('--templar-grid-origin')).toBe('81px');
    expect(dom.content.style.getPropertyValue('--templar-paper-baseline-position')).toBe('');
    controller.destroy();
  });

  it('handles Obsidian sizers that also carry the preview-section class', () => {
    const owner = harness();
    const dom = styledRoot(owner.window);
    dom.content.addClass('markdown-preview-section');
    const controller = new BaselineGridController();
    const leaf = {} as WorkspaceLeaf;
    controller.configure(leaf, { contentEl: dom.root, style: testStyle(), metrics: testMetrics() });
    expect(controller.stats(leaf)!.nodesMeasured).toBeGreaterThan(0);
    expect(dom.paragraph.hasClass('templar-baseline-grid-item')).toBe(true);
    controller.destroy();
  });

  it('processes a resized flow item as a dirty segment without a full rescan', () => {
    const owner = harness();
    const dom = styledRoot(owner.window);
    const controller = new BaselineGridController();
    const leaf = {} as WorkspaceLeaf;
    controller.configure(leaf, { contentEl: dom.root, style: testStyle(), metrics: testMetrics() });
    const initial = controller.stats(leaf)!;
    owner.resize.callback([{
      target: dom.image,
      contentRect: dom.image.getBoundingClientRect(),
      borderBoxSize: [],
      contentBoxSize: [],
      devicePixelContentBoxSize: [],
    }]);
    const pending = [...owner.frames.entries()];
    expect(pending).toHaveLength(1);
    for (const [id, callback] of pending) {
      owner.frames.delete(id);
      callback(0);
    }
    const after = controller.stats(leaf)!;
    expect(after.fullScans).toBe(initial.fullScans);
    expect(after.dirtyScans).toBe(1);
    expect(after.nodesMeasured).toBeLessThan(initial.nodesMeasured + 2);
    controller.destroy();
  });

  it('renders one pointer-free debug SVG and removes it on teardown', () => {
    const owner = harness();
    const dom = styledRoot(owner.window);
    const controller = new BaselineGridController();
    const leaf = {} as WorkspaceLeaf;
    controller.configure(leaf, { contentEl: dom.root, style: testStyle(), metrics: testMetrics() });
    expect(controller.toggleDebugOverlay(leaf)).toBe(true);
    expect(dom.content.querySelectorAll('.templar-baseline-debug-overlay')).toHaveLength(1);
    const overlay = dom.content.querySelector<SVGElement>('.templar-baseline-debug-overlay')!;
    expect(overlay.dataset.templarOwned).toBe('true');
    expect(overlay.querySelectorAll('text').length).toBeGreaterThan(0);
    expect(overlay.getAttribute('aria-hidden')).toBe('true');
    expect(controller.toggleDebugOverlay(leaf)).toBe(false);
    expect(dom.content.querySelectorAll('.templar-baseline-debug-overlay')).toHaveLength(0);
    controller.destroy();
    expect(owner.resize.disconnects).toBe(1);
    expect(owner.mutation.disconnects).toBe(1);
  });

  it('ignores its own debug-layer mutations but schedules real flow mutations', () => {
    const owner = harness();
    const dom = styledRoot(owner.window);
    const controller = new BaselineGridController();
    const leaf = {} as WorkspaceLeaf;
    controller.configure(leaf, { contentEl: dom.root, style: testStyle(), metrics: testMetrics() });
    controller.toggleDebugOverlay(leaf);
    const overlay = dom.content.querySelector<SVGElement>('.templar-baseline-debug-overlay')!;
    owner.mutation.callback([{
      type: 'childList',
      target: overlay,
      addedNodes: [],
      removedNodes: [],
    } as unknown as MutationRecord], {} as MutationObserver);
    expect(owner.frames).toHaveLength(0);
    owner.mutation.callback([{
      type: 'childList',
      target: dom.content,
      addedNodes: [owner.window.document.createElement('p')],
      removedNodes: [],
    } as unknown as MutationRecord], {} as MutationObserver);
    expect(owner.frames).toHaveLength(1);
    controller.destroy();
  });

  it('keeps CodeMirror line boxes untouched while giving editor widgets an exit tail', () => {
    const owner = harness();
    const dom = liveRoot(owner.window);
    const controller = new BaselineGridController();
    const leaf = {} as WorkspaceLeaf;
    controller.configure(leaf, { contentEl: dom.root, style: testStyle(), metrics: testMetrics() });
    expect(dom.line.hasClass('templar-baseline-grid-item')).toBe(false);
    expect(dom.line.style.getPropertyValue('--templar-grid-before')).toBe('');
    expect(dom.line.style.getPropertyValue('--templar-grid-after')).toBe('');
    expect(dom.line.style.getPropertyValue('margin-block-end')).toBe('');
    expect(dom.widget.hasClass('templar-baseline-grid-atomic')).toBe(true);
    expect(dom.widget.style.getPropertyValue('--templar-grid-after')).not.toBe('');
    controller.destroy();
    expect(dom.line.hasClass('templar-baseline-grid-item')).toBe(false);
    expect(dom.widget.style.getPropertyValue('--templar-grid-after')).toBe('');
  });

  it('corrects fractional text inside a Reading composite without changing its flow footprint', () => {
    const owner = harness();
    const dom = styledRoot(owner.window);
    const section = dom.content.querySelector<HTMLElement>('.markdown-preview-section')!;
    dom.paragraph.remove();
    dom.image.remove();
    const wrapper = owner.window.document.createElement('div');
    wrapper.className = 'el-blockquote';
    const blockquote = owner.window.document.createElement('blockquote');
    const quoted = owner.window.document.createElement('p');
    quoted.textContent = 'Formatted **quoted** text';
    const fractional = owner.window.document.createElement('p');
    fractional.textContent = 'A second paragraph with fractional geometry.';
    blockquote.append(quoted, fractional);
    wrapper.append(blockquote);
    section.append(wrapper);

    setRect(dom.root, rect(0, 600));
    setRect(dom.content, rect(0, 600));
    setRect(section, rect(0, 600));
    Object.defineProperty(wrapper, 'getBoundingClientRect', {
      configurable: true,
      value: () => {
        const before = Number.parseFloat(wrapper.style.getPropertyValue('--templar-grid-before')) || 0;
        return rect(120 + before, 60);
      },
    });
    Object.defineProperty(wrapper, 'offsetWidth', { configurable: true, value: 800 });
    Object.defineProperty(wrapper, 'offsetHeight', { configurable: true, value: 60 });
    Object.defineProperty(blockquote, 'getBoundingClientRect', {
      configurable: true,
      value: () => {
        const before = Number.parseFloat(wrapper.style.getPropertyValue('--templar-grid-before')) || 0;
        return rect(120 + before, 60);
      },
    });
    Object.defineProperty(blockquote, 'offsetWidth', { configurable: true, value: 800 });
    Object.defineProperty(blockquote, 'offsetHeight', { configurable: true, value: 60 });
    Object.defineProperty(quoted, 'getBoundingClientRect', {
      configurable: true,
      value: () => {
        const before = Number.parseFloat(wrapper.style.getPropertyValue('--templar-grid-before')) || 0;
        const shift = Number.parseFloat(quoted.style.getPropertyValue('--templar-grid-composite-text-shift')) || 0;
        return rect(150 + before + shift, 29);
      },
    });
    Object.defineProperty(quoted, 'offsetWidth', { configurable: true, value: 800 });
    Object.defineProperty(quoted, 'offsetHeight', { configurable: true, value: 29 });
    Object.defineProperty(fractional, 'getBoundingClientRect', {
      configurable: true,
      value: () => {
        const before = Number.parseFloat(wrapper.style.getPropertyValue('--templar-grid-before')) || 0;
        const shift = Number.parseFloat(fractional.style.getPropertyValue('--templar-grid-composite-text-shift')) || 0;
        return rect(181 + before + shift, 29);
      },
    });
    Object.defineProperty(fractional, 'offsetWidth', { configurable: true, value: 800 });
    Object.defineProperty(fractional, 'offsetHeight', { configurable: true, value: 29 });

    const controller = new BaselineGridController();
    const leaf = {} as WorkspaceLeaf;
    controller.configure(leaf, { contentEl: dom.root, style: testStyle(), metrics: testMetrics() });

    expect(quoted.hasClass('templar-baseline-grid-composite-text')).toBe(true);
    expect(quoted.style.getPropertyValue('--templar-grid-composite-text-shift')).toBe('0px');
    expect(fractional.style.getPropertyValue('--templar-grid-composite-text-shift')).toBe('-1px');
    expect(controller.stats(leaf)!.nonConvergedElements).toEqual([]);
    expect(wrapper.style.getPropertyValue('--templar-grid-after')).not.toBe('');
    controller.destroy();
    expect(quoted.style.getPropertyValue('--templar-grid-composite-text-shift')).toBe('');
  });
});
