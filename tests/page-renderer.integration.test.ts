/* @vitest-environment happy-dom */

import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  MarkdownView: class MarkdownView {},
  TFile: class TFile {},
}));

import { MarkdownView, TFile, type WorkspaceLeaf } from 'obsidian';
import { PageRenderer } from '../src/services/page-renderer';
import { DEFAULT_SETTINGS } from '../src/templates/defaults';
import { BUILT_IN_TEMPLATES } from '../src/templates/builtins';
import { templateToNoteStyle } from '../src/templates/note-format';
import type { FontMetrics, TemplarNoteStyle } from '../src/types';
import type { PageMetricSet } from '../src/services/style-compiler';
import { createObserverHarness } from './harness/dom-realm';
import { installObsidianDomExtensions } from './harness/obsidian';

function file(path: string): TFile {
  return Object.assign(Object.create(TFile.prototype) as TFile, {
    path,
    basename: path.split('/').pop()?.replace(/\.md$/, '') ?? path,
    extension: 'md',
  });
}

function metrics(): PageMetricSet {
  const metric: FontMetrics = {
    baseline: 14,
    ascent: 11,
    descent: 4,
    lineHeight: 24,
    measuredAt: 0,
  };
  return { body: metric, h1: metric, h2: metric, h3: metric, h4: metric, h5: metric, h6: metric, code: metric };
}

function leafFor(ownerWindow: Window, note: TFile): WorkspaceLeaf {
  installObsidianDomExtensions(ownerWindow);
  const content = ownerWindow.document.createElement('div');
  const readingRoot = ownerWindow.document.createElement('div');
  readingRoot.className = 'markdown-preview-view';
  const sizer = ownerWindow.document.createElement('div');
  sizer.className = 'markdown-preview-sizer';
  const section = ownerWindow.document.createElement('div');
  section.className = 'markdown-preview-section';
  section.textContent = 'A rendered paragraph.';
  sizer.append(section);
  readingRoot.append(sizer);
  content.append(readingRoot);
  ownerWindow.document.body.append(content);

  const view = Object.create(MarkdownView.prototype) as MarkdownView & {
    contentEl: HTMLElement;
    containerEl: HTMLElement;
    file: TFile;
  };
  view.contentEl = content;
  view.containerEl = content;
  view.file = note;
  return { view } as unknown as WorkspaceLeaf;
}

function styleAt(index: number): TemplarNoteStyle {
  const style = templateToNoteStyle(BUILT_IN_TEMPLATES[index]!);
  style.page.mode = 'paged';
  return style;
}

describe('PageRenderer integration lifecycle', () => {
  it('keeps Reading View whitespace identical for preview, persisted apply, and style removal', async () => {
    const harness = createObserverHarness();
    const note = file('Notes/reading-whitespace.md');
    const leaf = leafFor(harness.window, note);
    const content = (leaf.view as unknown as { contentEl: HTMLElement }).contentEl;
    const readingRoot = content.querySelector<HTMLElement>('.markdown-preview-view')!;
    const sizer = readingRoot.querySelector<HTMLElement>('.markdown-preview-sizer')!;
    const first = sizer.querySelector<HTMLElement>('.markdown-preview-section')!;
    const second = harness.window.document.createElement('div');
    second.className = 'markdown-preview-section';
    second.append(harness.window.document.createElement('p'));
    sizer.append(second);
    let stored: TemplarNoteStyle | null = null;
    const sectionInfo = new Map<HTMLElement, { lineStart: number; lineEnd: number; text: string }>([
      [first, { lineStart: 4, lineEnd: 4, text: '' }],
      [second, { lineStart: 8, lineEnd: 8, text: '' }],
    ]);
    const context = {
      sourcePath: note.path,
      getSectionInfo: (element: HTMLElement) => sectionInfo.get(element) ?? null,
    };
    const app = {
      workspace: { getLeavesOfType: () => [leaf] },
      vault: { getAbstractFileByPath: () => note },
      metadataCache: {
        getFileCache: () => ({ frontmatterPosition: { end: { line: 1 } } }),
      },
    };
    const renderer = new PageRenderer(
      app as never,
      { ...DEFAULT_SETTINGS, enableReadingView: true, enableLivePreview: false },
      { getStyle: vi.fn(() => stored), hasStyle: vi.fn(() => stored !== null) } as never,
      { measurePage: vi.fn(async () => metrics()), clear: vi.fn() } as never,
    );

    await renderer.refreshAll();
    expect(readingRoot.hasClass('templar-page')).toBe(false);
    expect(readingRoot.querySelectorAll('.templar-blank-line-spacer')).toHaveLength(0);

    renderer.registerReadingSection(first, context as never);
    renderer.registerReadingSection(second, context as never);

    const style = styleAt(0);
    await renderer.setPreview(leaf, 'preview', note.path, style);
    const previewSpacers = Array.from(readingRoot.querySelectorAll<HTMLElement>('.templar-blank-line-spacer'))
      .map((element) => element.style.getPropertyValue('--templar-blank-lines'));
    expect(first.hasClass('templar-reading-section')).toBe(true);
    expect(second.hasClass('templar-reading-section')).toBe(true);
    expect(previewSpacers.length).toBeGreaterThan(0);

    stored = style;
    await renderer.cancelPreview(leaf, 'preview');
    expect(Array.from(readingRoot.querySelectorAll<HTMLElement>('.templar-blank-line-spacer'))
      .map((element) => element.style.getPropertyValue('--templar-blank-lines'))).toEqual(previewSpacers);

    stored = null;
    await renderer.refreshAll();
    expect(readingRoot.hasClass('templar-page')).toBe(false);
    expect(first.hasClass('templar-reading-section')).toBe(false);
    expect(second.hasClass('templar-reading-section')).toBe(false);
    expect(readingRoot.querySelectorAll('.templar-blank-line-spacer')).toHaveLength(0);
    renderer.destroy();
  });

  it('keeps renderer scopes, observers, and temporary previews leaf-local', async () => {
    const first = createObserverHarness();
    const second = createObserverHarness();
    const note = file('Notes/shared.md');
    const firstLeaf = leafFor(first.window, note);
    const secondLeaf = leafFor(second.window, note);
    const persistent = styleAt(0);
    const preview = styleAt(1);
    const app = {
      workspace: { getLeavesOfType: () => [firstLeaf, secondLeaf] },
      vault: { getAbstractFileByPath: () => note },
      metadataCache: { getFileCache: () => null },
    };
    const frontmatter = {
      getStyle: vi.fn(() => persistent),
      hasStyle: vi.fn(() => true),
    };
    const fontMetrics = {
      measurePage: vi.fn(async () => metrics()),
      clear: vi.fn(),
    };
    const renderer = new PageRenderer(
      app as never,
      { ...DEFAULT_SETTINGS, enableReadingView: true, enableLivePreview: false },
      frontmatter as never,
      fontMetrics as never,
    );

    await renderer.refreshAll();

    const firstContent = (firstLeaf.view as unknown as { contentEl: HTMLElement }).contentEl;
    const secondContent = (secondLeaf.view as unknown as { contentEl: HTMLElement }).contentEl;
    expect(firstContent.dataset.templarScope).not.toBe(secondContent.dataset.templarScope);
    expect(firstContent.querySelector(':scope > style.templar-note-style')).not.toBeNull();
    expect(secondContent.querySelector(':scope > style.templar-note-style')).not.toBeNull();
    expect(first.resizeInstances.length).toBeGreaterThan(0);
    expect(second.resizeInstances.length).toBeGreaterThan(0);
    expect(first.mutationInstances.length).toBeGreaterThan(0);
    expect(second.mutationInstances.length).toBeGreaterThan(0);

    await renderer.setPreview(firstLeaf, 'first-owner', note.path, preview);
    expect(renderer.previewStyle(firstLeaf)?.id).toBe(preview.id);
    expect(renderer.previewStyle(secondLeaf)).toBeNull();
    await renderer.cancelPreview(firstLeaf, 'first-owner');
    expect(renderer.previewStyle(firstLeaf)).toBeNull();

    renderer.destroy();
    expect(first.resizeInstances.every((instance) => instance.disconnects > 0)).toBe(true);
    expect(second.resizeInstances.every((instance) => instance.disconnects > 0)).toBe(true);
    expect(first.mutationInstances.every((instance) => instance.disconnects > 0)).toBe(true);
    expect(second.mutationInstances.every((instance) => instance.disconnects > 0)).toBe(true);
    expect(firstContent.querySelector(':scope > style.templar-note-style')).toBeNull();
    expect(secondContent.querySelector(':scope > style.templar-note-style')).toBeNull();
    expect(firstContent.dataset.templarScope).toBeUndefined();
    expect(secondContent.dataset.templarScope).toBeUndefined();
  });

  it('keeps validation issues owned by the leaf that produced them', async () => {
    const first = createObserverHarness();
    const second = createObserverHarness();
    const note = file('Notes/shared.md');
    const firstLeaf = leafFor(first.window, note);
    const secondLeaf = leafFor(second.window, note);
    const leaves = [firstLeaf, secondLeaf];
    const persistent = styleAt(0);
    const invalidPreview = styleAt(1);
    invalidPreview.css = 'body { color: red; }';
    const app = {
      workspace: { getLeavesOfType: () => leaves },
      vault: { getAbstractFileByPath: () => note },
      metadataCache: { getFileCache: () => null },
    };
    const renderer = new PageRenderer(
      app as never,
      { ...DEFAULT_SETTINGS, enableReadingView: true, enableLivePreview: false },
      { getStyle: vi.fn(() => persistent), hasStyle: vi.fn(() => true) } as never,
      { measurePage: vi.fn(async () => metrics()), clear: vi.fn() } as never,
    );

    await renderer.refreshAll();
    await renderer.setPreview(firstLeaf, 'invalid-preview', note.path, invalidPreview);
    expect(renderer.issuesFor(note).some((issue) => issue.path === 'css.selector')).toBe(true);

    leaves.splice(1, 1);
    await renderer.refreshAll();
    expect(renderer.issuesFor(note).some((issue) => issue.path === 'css.selector')).toBe(true);

    leaves.splice(0, 1);
    await renderer.refreshAll();
    expect(renderer.issuesFor(note)).toEqual([]);
    renderer.destroy();
  });
});
