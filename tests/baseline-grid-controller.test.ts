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
      resize.callback = (entries) => callback(entries, this);
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
    const eventConstructor = owner.window.Event as unknown as { new (type: string): Event };
    dom.root.dispatchEvent(new eventConstructor('scroll'));
    expect(controller.stats(leaf)).toEqual(before);
    expect(dom.content.style.getPropertyValue('--templar-grid-origin')).toBe('81px');
    expect(dom.content.style.getPropertyValue('--templar-paper-baseline-position')).toBe('');
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
    expect(controller.toggleDebugOverlay(leaf)).toBe(false);
    expect(dom.content.querySelectorAll('.templar-baseline-debug-overlay')).toHaveLength(0);
    controller.destroy();
    expect(owner.resize.disconnects).toBe(1);
    expect(owner.mutation.disconnects).toBe(1);
  });
});
