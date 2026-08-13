/* @vitest-environment happy-dom */

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_TEMPLATES } from '../src/templates/builtins';
import { compilePageStyle, type PageMetricSet } from '../src/services/style-compiler';
import { templateToNoteStyle } from '../src/templates/note-format';
import { PerformanceMonitor } from '../src/performance/performance-monitor';
import { ImageSnapController } from '../src/services/rendering/image-snap-controller';
import { PaperOriginController } from '../src/services/rendering/paper-origin-controller';
import { VariableBlockRhythmController } from '../src/services/rendering/variable-block-rhythm-controller';
import { createObserverHarness } from './harness/dom-realm';
import { installObsidianDomExtensions } from './harness/obsidian';
import type { WorkspaceLeaf } from 'obsidian';

const metric = { baseline: 14, ascent: 11, descent: 4, lineHeight: 24, measuredAt: 0 };
const metrics: PageMetricSet = { body: metric, h1: metric, h2: metric, h3: metric, h4: metric, h5: metric, h6: metric, code: metric };
const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
style.baseline.enabled = true;
style.baseline.mode = 'balanced';
style.baseline.snapImages = true;

type Mode = 'normal' | 'profile-capture-off' | 'profile-capture-on';

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function controllerFixture(blocks: number): { content: HTMLElement; window: Window } {
  const harness = createObserverHarness();
  installObsidianDomExtensions(harness.window);
  const content = harness.window.document.createElement('div');
  const page = harness.window.document.createElement('div');
  page.className = 'templar-page';
  const pageContent = harness.window.document.createElement('div');
  pageContent.className = 'templar-page-content';
  for (let index = 0; index < blocks; index += 1) {
    const block = harness.window.document.createElement(index % 5 === 0 ? 'table' : 'p');
    block.textContent = `Overhead block ${String(index)}`;
    pageContent.append(block);
  }
  page.append(pageContent);
  content.append(page);
  harness.window.document.body.append(content);
  harness.window.getComputedStyle = (() => ({
    marginBlockEnd: '0px', marginBlockStart: '0px', marginBottom: '0px', marginTop: '0px',
    paddingTop: '0px', borderTopWidth: '0px',
  })) as unknown as typeof harness.window.getComputedStyle;
  return { content, window: harness.window };
}

function monitorFor(mode: Mode): PerformanceMonitor | undefined {
  if (mode === 'normal') return undefined;
  return new PerformanceMonitor({ enabled: mode === 'profile-capture-on' });
}

function measureCompile(mode: Mode): number {
  const monitor = monitorFor(mode);
  if (mode === 'profile-capture-on') monitor?.startScenario({ scenarioId: 'overhead-compile', ownerWindow: null });
  const samples: number[] = [];
  for (let sample = 0; sample < 12; sample += 1) {
    const start = performance.now();
    for (let index = 0; index < 100; index += 1) {
      const operation = () => compilePageStyle(style, '[data-templar-scope="overhead"]', 'overhead', metrics);
      if (monitor) monitor.measureSync('overhead.compilePageStyle', operation);
      else operation();
    }
    samples.push(performance.now() - start);
  }
  monitor?.stopScenario();
  return median(samples);
}

function measureControllers(mode: Mode, blocks: number): number {
  const monitor = monitorFor(mode);
  const fixture = controllerFixture(blocks);
  const leaf = {} as WorkspaceLeaf;
  const image = new ImageSnapController(monitor);
  const paper = new PaperOriginController(monitor);
  const rhythm = new VariableBlockRhythmController(monitor);
  if (mode === 'profile-capture-on') monitor?.startScenario({ scenarioId: `overhead-controllers-${String(blocks)}`, ownerWindow: fixture.window });
  const samples: number[] = [];
  for (let sample = 0; sample < 8; sample += 1) {
    const start = performance.now();
    const operation = () => {
      image.configure(leaf, fixture.content, style);
      paper.configure(leaf, fixture.content, style, metrics);
      rhythm.configure(leaf, fixture.content, style);
      image.clear(leaf);
      paper.clear(leaf);
      rhythm.clear(leaf);
    };
    if (monitor) monitor.measureSync(`overhead.controllers.${String(blocks)}`, operation);
    else operation();
    samples.push(performance.now() - start);
  }
  monitor?.stopScenario();
  fixture.window.close();
  return median(samples);
}

describe('instrumentation overhead calibration', () => {
  it('records normal, capture-off, and capture-on timing for required fixtures', async () => {
    const rows = [];
    for (const fixture of ['compilePageStyle', 'controllers-1000', 'controllers-5000']) {
      const normal = fixture === 'compilePageStyle' ? measureCompile('normal') : measureControllers('normal', Number(fixture.split('-')[1]));
      const captureOff = fixture === 'compilePageStyle' ? measureCompile('profile-capture-off') : measureControllers('profile-capture-off', Number(fixture.split('-')[1]));
      const captureOn = fixture === 'compilePageStyle' ? measureCompile('profile-capture-on') : measureControllers('profile-capture-on', Number(fixture.split('-')[1]));
      rows.push({
        fixture,
        normalMs: normal,
        profileCaptureOffMs: captureOff,
        profileCaptureOnMs: captureOn,
        captureOffOverheadPercent: normal > 0 ? ((captureOff - normal) / normal) * 100 : null,
        captureOnOverheadPercent: normal > 0 ? ((captureOn - normal) / normal) * 100 : null,
      });
    }
    const output = resolve('perf-results/b63adb76/instrumentation/instrumentation-overhead.json');
    await mkdir(resolve('perf-results/b63adb76/instrumentation'), { recursive: true });
    await writeFile(output, `${JSON.stringify({ algorithm: 'median of 12 compile samples or 8 controller samples; all raw sample timing is retained in the test process only', rows }, null, 2)}\n`);
    expect(rows).toHaveLength(3);
  }, 120_000);
});
