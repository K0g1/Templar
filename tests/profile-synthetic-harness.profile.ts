/* @vitest-environment happy-dom */

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  MarkdownView: class MarkdownView {},
  TFile: class TFile {},
}));

import { MarkdownView, TFile, type WorkspaceLeaf } from 'obsidian';
import { PerformanceMonitor } from '../src/performance/performance-monitor';
import { PageRenderer } from '../src/services/page-renderer';
import { FontMetricsService } from '../src/services/font-metrics';
import { DEFAULT_SETTINGS } from '../src/templates/defaults';
import { BUILT_IN_TEMPLATES } from '../src/templates/builtins';
import { templateToNoteStyle } from '../src/templates/note-format';
import type { PerfFeatureMask, PerformanceCapture } from '../src/performance/performance-types';
import { createObserverHarness } from './harness/dom-realm';
import { installObsidianDomExtensions } from './harness/obsidian';

function syntheticFile(): TFile {
  return Object.assign(Object.create(TFile.prototype) as TFile, {
    path: 'Synthetic/F002-medium-mixed.md',
    basename: 'F002-medium-mixed',
    extension: 'md',
    parent: { path: 'Synthetic' },
  });
}

function createLeaf(ownerWindow: Window, file: TFile, blocks: number, sections: number): WorkspaceLeaf {
  installObsidianDomExtensions(ownerWindow);
  const content = ownerWindow.document.createElement('div');
  const readingRoot = ownerWindow.document.createElement('div');
  readingRoot.className = 'markdown-preview-view';
  const sizer = ownerWindow.document.createElement('div');
  sizer.className = 'markdown-preview-sizer';
  for (let index = 0; index < sections; index += 1) {
    const section = ownerWindow.document.createElement('div');
    section.className = 'markdown-preview-section';
    const heading = ownerWindow.document.createElement('h2');
    heading.textContent = `Section ${String(index)}`;
    const paragraph = ownerWindow.document.createElement('p');
    paragraph.textContent = `Synthetic section ${String(index)} with deterministic Reading content.`;
    section.append(heading, paragraph);
    sizer.append(section);
  }
  if (sections === 0) {
    const section = ownerWindow.document.createElement('div');
    section.className = 'markdown-preview-section';
    for (let index = 0; index < blocks; index += 1) {
      const element = ownerWindow.document.createElement(index % 8 === 0 ? 'h2' : index % 5 === 0 ? 'table' : 'p');
      element.textContent = `Synthetic block ${String(index)}`;
      section.append(element);
    }
    sizer.append(section);
  }
  readingRoot.append(sizer);
  Object.defineProperty(readingRoot, 'clientWidth', { configurable: true, value: 1000 });
  Object.defineProperty(sizer, 'offsetWidth', { configurable: true, value: 794 });
  content.append(readingRoot);
  ownerWindow.document.body.append(content);
  const view = Object.create(MarkdownView.prototype) as MarkdownView & {
    contentEl: HTMLElement;
    containerEl: HTMLElement;
    file: TFile;
  };
  view.contentEl = content;
  view.containerEl = content;
  view.file = file;
  return { view } as unknown as WorkspaceLeaf;
}

function fixtureContext(file: TFile, index: number): { sourcePath: string; getSectionInfo: () => { lineStart: number; lineEnd: number; text: string } } {
  return {
    sourcePath: file.path,
    getSectionInfo: () => ({
      lineStart: index * 3,
      lineEnd: index * 3 + 2,
      text: `Section ${String(index)}\n\nSynthetic content`,
    }),
  };
}

interface ScenarioDefinition {
  id: string;
  category: string;
  blocks?: number;
  sections?: number;
  mode?: 'pageless' | 'paged';
  grid?: boolean;
  snapImages?: boolean;
  leafCount?: number;
  featureMask?: Partial<PerfFeatureMask>;
}

const scenarios: ScenarioDefinition[] = [
  { id: 'A-existing-F002-pageless-free', category: 'A-existing', blocks: 500, mode: 'pageless', grid: false },
  { id: 'A-existing-F002-pageless-grid', category: 'A-existing', blocks: 500, mode: 'pageless', grid: true },
  { id: 'E-paged-vs-pageless-F002-paged-grid', category: 'E-paged-vs-pageless', blocks: 500, mode: 'paged', grid: true },
  { id: 'C-reading-100', category: 'C-reading-scaling', sections: 100, mode: 'paged', grid: true },
  { id: 'C-reading-500', category: 'C-reading-scaling', sections: 500, mode: 'paged', grid: true },
  { id: 'C-reading-1000', category: 'C-reading-scaling', sections: 1000, mode: 'paged', grid: true },
  { id: 'L-multileaf-3', category: 'L-multileaf', blocks: 500, mode: 'paged', grid: true, leafCount: 3 },
  { id: 'ablation-no-PageLayout', category: 'ablation', blocks: 500, mode: 'paged', grid: true, featureMask: { pageLayout: false } },
  { id: 'ablation-no-ReadingWhitespace', category: 'ablation', sections: 500, mode: 'paged', grid: true, featureMask: { readingWhitespace: false } },
  { id: 'ablation-no-PaperOrigin', category: 'ablation', blocks: 500, mode: 'paged', grid: true, featureMask: { paperOrigin: false } },
  { id: 'ablation-no-VariableRhythm', category: 'ablation', blocks: 500, mode: 'paged', grid: true, featureMask: { variableRhythm: false } },
  { id: 'ablation-no-ImageSnap', category: 'ablation', blocks: 500, mode: 'paged', grid: true, snapImages: true, featureMask: { imageSnap: false } },
];

async function runScenario(definition: ScenarioDefinition, runNumber: string): Promise<PerformanceCapture> {
  const harness = createObserverHarness();
  const file = syntheticFile();
  const leaves = Array.from({ length: definition.leafCount ?? 1 }, () =>
    createLeaf(harness.window, file, definition.blocks ?? 0, definition.sections ?? 0));
  const app = {
    workspace: { getLeavesOfType: () => leaves, containerEl: harness.window.document.body },
    vault: { getAbstractFileByPath: () => file },
    metadataCache: { getFileCache: () => null },
  };
  const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
  style.page.mode = definition.mode ?? 'pageless';
  style.baseline.enabled = definition.grid ?? false;
  style.baseline.mode = definition.grid ? 'balanced' : 'free';
  style.baseline.snapImages = definition.snapImages ?? false;
  const monitor = new PerformanceMonitor();
  const fontMetrics = new FontMetricsService(() => 128, monitor);
  const renderer = new PageRenderer(
    app as never,
    { ...DEFAULT_SETTINGS, enableReadingView: true, enableLivePreview: false },
    {
      getStyle: () => style,
      hasStyle: () => true,
      inspect: () => ({ fingerprint: 'synthetic-style' }),
    } as never,
    fontMetrics,
    monitor,
  );
  monitor.setStateProvider(() => renderer.stateSnapshot());
  renderer.setFeatureMask(definition.featureMask ?? {}, false);
  monitor.startScenario({
    scenarioId: `${definition.id}-run-${runNumber}`,
    pluginVersion: '1.2.0-alpha.2',
    ownerWindow: harness.window,
    featureMask: definition.featureMask,
    metadata: {
      platform: 'cli',
      environmentId: 'synthetic-happy-dom',
      fixtureId: definition.sections ? `F005-${String(definition.sections)}` : 'F002',
      styleProfile: definition.grid ? (definition.mode === 'paged' ? 'S6' : 'S3') : 'S2',
      leafCount: leaves.length,
      mode: definition.mode ?? 'pageless',
      readingEnabled: true,
      livePreviewEnabled: false,
    },
  });
  monitor.mark('interactionStart');
  await renderer.refreshAll('explicit-refresh');
  if ((definition.sections ?? 0) > 0) {
    const contentEl = (leaves[0]!.view as unknown as { contentEl: HTMLElement }).contentEl;
    const sections = contentEl.querySelectorAll<HTMLElement>('.markdown-preview-section');
    sections.forEach((section: HTMLElement, index: number) => renderer.registerReadingSection(section, fixtureContext(file, index) as never));
  }
  await new Promise<void>((resolve) => harness.window.setTimeout(resolve, 25));
  monitor.mark('interactionEnd');
  monitor.mark('settleEnd');
  renderer.destroy();
  monitor.snapshot('afterCleanup');
  const capture = monitor.stopScenario({ settled: true });
  if (!capture) throw new Error(`Scenario ${definition.id} did not produce a capture.`);
  return capture;
}

describe('synthetic profile harness', () => {
  it('writes bounded raw captures for the reproducible scenario matrix', async () => {
    const runNumber = process.env.TEMPLAR_PROFILE_RUN ?? '1';
    const root = resolve('perf-results/b63adb76/raw');
    for (const definition of scenarios) {
      const capture = await runScenario(definition, runNumber);
      const directory = resolve(root, definition.category);
      await mkdir(directory, { recursive: true });
      const file = resolve(directory, `${definition.id}__run-${runNumber}.templar-perf.json`);
      await writeFile(file, `${JSON.stringify(capture, null, 2)}\n`);
      expect(capture.schemaVersion).toBe(1);
      expect(capture.profileInstrumentation).toBe(true);
      expect(capture.sourceCommit).toBe('b63adb76ed1843d17b680244370085a0002fc89a');
      expect(capture.stateSnapshots.afterCleanup['PageRenderer.styledViews']).toBe(0);
    }
  }, 120_000);
});
