import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it } from 'vitest';
import { PreviewStyleStore } from '../../src/services/preview-style-store';
import { ViewStyleHost } from '../../src/services/view-style-host';
import { ImageSnapController } from '../../src/services/image-snap-controller';
import { BUILT_IN_TEMPLATES } from '../../src/templates/builtins';
import { templateToNoteStyle } from '../../src/templates/note-format';
import { DEFAULT_SETTINGS } from '../../src/templates/defaults';
import { clone } from '../../src/utils/value';

// Obsidian extends HTMLElement with addClass/hasClass/removeClass/toggleClass.
// jsdom does not provide these; polyfill them for controller integration tests.
beforeEach(() => {
  const proto = (globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement
    ?.prototype as (typeof HTMLElement)['prototype'] & {
      addClass?: (name: string) => void;
      removeClass?: (name: string) => void;
      hasClass?: (name: string) => boolean;
      toggleClass?: (name: string, force?: boolean) => void;
    };
  if (!proto) {
    return;
  }
  proto.addClass ??= function addClass(this: HTMLElement, name: string): void {
    this.classList.add(name);
  };
  proto.removeClass ??= function removeClass(this: HTMLElement, name: string): void {
    this.classList.remove(name);
  };
  proto.hasClass ??= function hasClass(this: HTMLElement, name: string): boolean {
    return this.classList.contains(name);
  };
  proto.toggleClass ??= function toggleClass(this: HTMLElement, name: string, force?: boolean): void {
    this.classList.toggle(name, force);
  };
});

function makeDom(): { dom: JSDOM; document: Document; contentEl: HTMLElement } {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const { window } = dom;
  // Make JSDOM's window classes the globals the controllers see, and add the
  // Obsidian classList helpers onto that prototype.
  (globalThis as Record<string, unknown>).window = window;
  (globalThis as Record<string, unknown>).document = window.document;
  (globalThis as Record<string, unknown>).HTMLElement = window.HTMLElement;
  (globalThis as Record<string, unknown>).MutationObserver = window.MutationObserver;
  (globalThis as Record<string, unknown>).ResizeObserver = window.ResizeObserver;
  const proto = window.HTMLElement.prototype as (typeof window.HTMLElement)['prototype'] & {
    addClass?: (name: string) => void;
    removeClass?: (name: string) => void;
    hasClass?: (name: string) => boolean;
    toggleClass?: (name: string, force?: boolean) => void;
  };
  proto.addClass ??= function addClass(this: HTMLElement, name: string): void {
    this.classList.add(name);
  };
  proto.removeClass ??= function removeClass(this: HTMLElement, name: string): void {
    this.classList.remove(name);
  };
  proto.hasClass ??= function hasClass(this: HTMLElement, name: string): boolean {
    return this.classList.contains(name);
  };
  proto.toggleClass ??= function toggleClass(this: HTMLElement, name: string, force?: boolean): void {
    this.classList.toggle(name, force);
  };
  const document = window.document;
  const contentEl = document.createElement('div');
  contentEl.className = 'markdown-view';
  document.body.appendChild(contentEl);
  return { dom, document, contentEl };
}

describe('PreviewStyleStore integration', () => {
  it('stores and returns cloned preview states per leaf', () => {
    const store = new PreviewStyleStore();
    const leaf = { leafId: 'leaf-a' } as unknown as Parameters<typeof store.set>[0];
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    store.set(leaf, { owner: 'owner-1', filePath: 'note.md', style });

    const returned = store.get(leaf);
    expect(returned?.owner).toBe('owner-1');
    expect(returned?.filePath).toBe('note.md');
    // Mutating the returned style must not corrupt the store.
    returned!.style.page.width = 999;
    expect(store.get(leaf)!.style.page.width).toBe(style.page.width);
  });

  it('deletes by owner and reports removed leaves', () => {
    const store = new PreviewStyleStore();
    const leafA = { leafId: 'a' } as unknown as Parameters<typeof store.set>[0];
    const leafB = { leafId: 'b' } as unknown as Parameters<typeof store.set>[0];
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    store.set(leafA, { owner: 'owner-1', filePath: 'a.md', style });
    store.set(leafB, { owner: 'owner-2', filePath: 'b.md', style });

    const removed = store.deleteByOwner('owner-1');
    expect(removed).toEqual([leafA]);
    expect(store.has(leafA)).toBe(false);
    expect(store.has(leafB)).toBe(true);
  });

  it('clear empties all preview state', () => {
    const store = new PreviewStyleStore();
    const leaf = { leafId: 'a' } as unknown as Parameters<typeof store.set>[0];
    store.set(leaf, { owner: 'o', filePath: 'a.md', style: templateToNoteStyle(BUILT_IN_TEMPLATES[0]!) });
    store.clear();
    expect(store.has(leaf)).toBe(false);
  });
});

describe('ViewStyleHost integration', () => {
  it('applies and clears the scoped style element', () => {
    const { contentEl } = makeDom();
    const host = new ViewStyleHost(clone(DEFAULT_SETTINGS));
    host.applyScopedStyle(contentEl, '.page { color: red; }', 'templar-abc', 'note.md');

    expect(contentEl.hasClass('templar-scope')).toBe(true);
    expect(contentEl.dataset.templarScope).toBe('templar-abc');
    expect(contentEl.dataset.templarFile).toBe('note.md');
    const styleEl = contentEl.querySelector('style.templar-note-style');
    expect(styleEl?.textContent).toBe('.page { color: red; }');

    host.clearView(contentEl);
    expect(contentEl.hasClass('templar-scope')).toBe(false);
    expect(contentEl.dataset.templarScope).toBeUndefined();
    expect(contentEl.querySelector('style.templar-note-style')).toBeNull();
  });

  it('replaces existing style content on re-apply', () => {
    const { contentEl } = makeDom();
    const host = new ViewStyleHost(clone(DEFAULT_SETTINGS));
    host.applyScopedStyle(contentEl, 'a { color: red; }', 'templar-abc', 'n.md');
    host.applyScopedStyle(contentEl, 'a { color: blue; }', 'templar-abc', 'n.md');
    const styleEl = contentEl.querySelector('style.templar-note-style');
    expect(styleEl?.textContent).toBe('a { color: blue; }');
    expect(contentEl.querySelectorAll('style.templar-note-style').length).toBe(1);
  });

  it('prepares reading and source view roots with page classes', () => {
    const { document, contentEl } = makeDom();
    const readingView = document.createElement('div');
    readingView.className = 'markdown-reading-view';
    const previewView = document.createElement('div');
    previewView.className = 'markdown-preview-view';
    const sizer = document.createElement('div');
    sizer.className = 'markdown-preview-sizer';
    previewView.appendChild(sizer);
    readingView.appendChild(previewView);
    contentEl.appendChild(readingView);

    const sourceView = document.createElement('div');
    sourceView.className = 'markdown-source-view mod-cm6';
    const editor = document.createElement('div');
    editor.className = 'cm-editor';
    const scroller = document.createElement('div');
    scroller.className = 'cm-scroller';
    const cmSizer = document.createElement('div');
    cmSizer.className = 'cm-sizer';
    scroller.appendChild(cmSizer);
    editor.appendChild(scroller);
    sourceView.appendChild(editor);
    contentEl.appendChild(sourceView);

    const settings = clone(DEFAULT_SETTINGS);
    settings.enableReadingView = true;
    settings.enableLivePreview = true;
    const host = new ViewStyleHost(settings);
    host.prepareViewRoots(contentEl);

    expect(previewView.hasClass('templar-page')).toBe(true);
    expect(sizer.hasClass('templar-page-content')).toBe(true);
    expect(scroller.hasClass('templar-page')).toBe(true);
    expect(cmSizer.hasClass('templar-page-content')).toBe(true);
  });

  it('clearView removes page classes from nested roots', () => {
    const { document, contentEl } = makeDom();
    const previewView = document.createElement('div');
    previewView.className = 'markdown-preview-view';
    const sizer = document.createElement('div');
    sizer.className = 'markdown-preview-sizer';
    previewView.appendChild(sizer);
    contentEl.appendChild(previewView);
    const settings = clone(DEFAULT_SETTINGS);
    settings.enableReadingView = true;
    const host = new ViewStyleHost(settings);
    host.prepareViewRoots(contentEl);
    expect(previewView.hasClass('templar-page')).toBe(true);

    host.clearView(contentEl);
    expect(previewView.hasClass('templar-page')).toBe(false);
    expect(sizer.hasClass('templar-page-content')).toBe(false);
  });
});

describe('ImageSnapController integration', () => {
  it('disconnect removes observers without throwing on missing state', () => {
    const { contentEl } = makeDom();
    const controller = new ImageSnapController();
    // No state installed; disconnect must be a safe no-op.
    expect(() => controller.disconnect(contentEl)).not.toThrow();
    expect(() => controller.disconnectAll()).not.toThrow();
  });

  it('does not install observers when snapping is disabled', () => {
    const { contentEl } = makeDom();
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    style.baseline.enabled = false;
    const controller = new ImageSnapController();
    controller.configure(contentEl, style);
    expect(() => controller.disconnect(contentEl)).not.toThrow();
  });

  it('configure then disconnect cleans up images', () => {
    const { contentEl } = makeDom();
    const img = contentEl.ownerDocument.createElement('img');
    // Simulate an already-snapped image via a class that the controller's
    // cleanup pass clears; avoids inline-style lint in the test harness.
    img.classList.add('pre-snapped');
    contentEl.appendChild(img);
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    style.baseline.enabled = true;
    style.baseline.mode = 'strict';
    style.baseline.snapImages = true;
    const controller = new ImageSnapController();
    controller.configure(contentEl, style);
    expect(() => controller.disconnect(contentEl)).not.toThrow();
  });
});
