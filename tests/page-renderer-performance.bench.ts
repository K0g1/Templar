/* @vitest-environment happy-dom */
/* global process -- Vitest benchmarks read an explicit test-only stress opt-in. */

import { bench, describe, vi } from 'vitest';

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

function note(path: string): TFile {
  return Object.assign(new TFile(), {
    path,
    basename: path.split('/').pop()?.replace(/\.md$/, '') ?? path,
    extension: 'md',
  });
}

function benchmarkStyle(mode: 'pageless' | 'paged', page: 'a4' | 'letter' | 'custom'): TemplarNoteStyle {
  const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
  style.page.mode = mode;
  style.page.size = page === 'a4' ? 'a4' : page === 'letter' ? 'letter' : 'custom';
  if (page === 'custom') {
    style.page.width = 920;
    style.page.height = 1_360;
  }
  style.baseline.enabled = true;
  style.baseline.mode = 'balanced';
  style.baseline.snapImages = true;
  return style;
}

function fixture(
  blocks: number,
  leafCount: number,
  images: number,
  differentFiles = false,
): {
  app: { workspace: { getLeavesOfType: (type: string) => WorkspaceLeaf[] }; vault: { getAbstractFileByPath: (path: string) => TFile | null }; metadataCache: { getFileCache: (file: TFile) => unknown } };
  leaves: WorkspaceLeaf[];
  close(): void;
} {
  const harness = createObserverHarness();
  installObsidianDomExtensions(harness.window);
  harness.window.getComputedStyle = (() => ({
    borderTopWidth: '0px',
    marginBlockEnd: '0px',
    marginBlockStart: '0px',
    marginBottom: '0px',
    marginTop: '0px',
    paddingInlineEnd: '0px',
    paddingInlineStart: '0px',
    paddingTop: '0px',
  })) as unknown as typeof harness.window.getComputedStyle;
  const files = Array.from({ length: leafCount }, (_, index) => note(
    differentFiles ? `Benchmarks/renderer-${String(index)}.md` : 'Benchmarks/renderer.md',
  ));
  const leaves: WorkspaceLeaf[] = [];
  const sections = Array.from({ length: blocks }, (_, index) => ({
    type: 'paragraph',
    position: { start: { line: index * 2 }, end: { line: index * 2 } },
  }));
  for (let leafIndex = 0; leafIndex < leafCount; leafIndex += 1) {
    const file = files[leafIndex]!;
    const content = harness.window.document.createElement('div');
    const readingRoot = harness.window.document.createElement('div');
    readingRoot.className = 'markdown-preview-view';
    const sizer = harness.window.document.createElement('div');
    sizer.className = 'markdown-preview-sizer';
    Object.defineProperty(readingRoot, 'clientWidth', { configurable: true, value: 1_024 });
    for (let index = 0; index < blocks; index += 1) {
      const section = harness.window.document.createElement('div');
      section.className = 'markdown-preview-section';
      const kind = index % 9;
      const block = harness.window.document.createElement(
        kind === 0 ? 'h2' : kind === 1 ? 'blockquote' : kind === 2 ? 'table' : kind === 3 ? 'pre' : kind === 8 ? 'ul' : 'div',
      );
      if (kind === 2) {
        const row = harness.window.document.createElement('tr');
        row.append(harness.window.document.createElement('td'));
        block.append(row);
      } else if (kind === 4) {
        block.className = 'callout';
        block.dataset.callout = 'warning';
      } else if (kind === 5) {
        block.className = 'block-language-mermaid';
      } else if (kind === 6) {
        block.className = 'internal-embed';
      } else if (kind === 7) {
        block.className = 'templar-variable-block';
      } else if (kind === 8) {
        block.append(harness.window.document.createElement('li'));
      }
      block.textContent = `Benchmark block ${String(index)}`;
      section.append(block);
      sizer.append(section);
    }
    for (let index = 0; index < images; index += 1) {
      const section = harness.window.document.createElement('div');
      section.className = 'markdown-preview-section';
      section.append(harness.window.document.createElement('img'));
      sizer.append(section);
    }
    readingRoot.append(sizer);
    content.append(readingRoot);
    harness.window.document.body.append(content);
    const view = Object.create(MarkdownView.prototype) as MarkdownView & {
      contentEl: HTMLElement;
      containerEl: HTMLElement;
      file: TFile;
    };
    view.contentEl = content;
    view.containerEl = content;
    view.file = file;
    leaves.push({ view } as unknown as WorkspaceLeaf);
  }
  return {
    app: {
      workspace: { getLeavesOfType: () => leaves },
      vault: { getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? null },
      metadataCache: { getFileCache: () => ({ sections, frontmatterPosition: { end: { line: -1 } } }) },
    },
    leaves,
    close: () => harness.window.close(),
  };
}

const benchmarkOptions = {
  iterations: 1,
  time: 20,
  warmupIterations: 0,
  warmupTime: 0,
};

const stressEnabled = process.env.TEMPLAR_BENCH_STRESS === '1';

describe('full PageRenderer performance fixtures', () => {
  const scenarios = [
    { name: '100 blocks / one leaf / pageless A4', blocks: 100, leaves: 1, images: 0, mode: 'pageless' as const, page: 'a4' as const },
    { name: '1,000 blocks / three leaves / paged A4', blocks: 1_000, leaves: 3, images: 0, mode: 'paged' as const, page: 'a4' as const },
    { name: '1,000 blocks / three same-file leaves / one preview / paged A4', blocks: 1_000, leaves: 3, images: 0, mode: 'paged' as const, page: 'a4' as const, preview: true },
    { name: '100 blocks / ten different files / paged Letter', blocks: 100, leaves: 10, images: 0, mode: 'paged' as const, page: 'letter' as const, differentFiles: true },
    { name: '100 images / one leaf / pageless A4', blocks: 100, leaves: 1, images: 100, mode: 'pageless' as const, page: 'a4' as const },
    ...(stressEnabled ? [
      { name: '5,000 blocks / one leaf / paged Letter', blocks: 5_000, leaves: 1, images: 0, mode: 'paged' as const, page: 'letter' as const },
      { name: '10,000 blocks / one leaf / paged Custom', blocks: 10_000, leaves: 1, images: 0, mode: 'paged' as const, page: 'custom' as const },
    ] : []),
  ];

  for (const scenario of scenarios) {
    bench(scenario.name, async () => {
      const testFixture = fixture(scenario.blocks, scenario.leaves, scenario.images, scenario.differentFiles);
      const style = benchmarkStyle(scenario.mode, scenario.page);
      const renderer = new PageRenderer(
        testFixture.app as never,
        { ...DEFAULT_SETTINGS, enableReadingView: true, enableLivePreview: false },
        { getStyle: () => style, hasStyle: () => true } as never,
        { measurePage: async () => metrics, clear: () => undefined } as never,
      );
      try {
        await renderer.refreshAll();
        if (scenario.preview) {
          const previewLeaf = testFixture.leaves[0]!;
          const previewFile = (previewLeaf.view as MarkdownView).file;
          if (!previewFile) throw new Error('Benchmark fixture lost its note file.');
          await renderer.setPreview(previewLeaf, 'benchmark-preview', previewFile.path, benchmarkStyle('paged', 'a4'));
        }
      } finally {
        renderer.destroy();
        testFixture.close();
      }
    }, benchmarkOptions);
  }
});
