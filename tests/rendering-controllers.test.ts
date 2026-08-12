/* @vitest-environment happy-dom */

import { describe, expect, it } from 'vitest';
import { OwnedStyleHost } from '../src/services/rendering/style-host';
import { ReadingRootRegistry } from '../src/services/rendering/reading-root-registry';
import { ImageSnapController, imageSnapPixels } from '../src/services/rendering/image-snap-controller';
import { PaperOriginController } from '../src/services/rendering/paper-origin-controller';
import { VariableBlockRhythmController, variableBlockSnapPixels } from '../src/services/rendering/variable-block-rhythm-controller';
import { BUILT_IN_TEMPLATES } from '../src/templates/builtins';
import { templateToNoteStyle } from '../src/templates/note-format';
import type { PageMetricSet } from '../src/services/style-compiler';
import type { WorkspaceLeaf } from 'obsidian';
import { createObserverHarness } from './harness/dom-realm';
import { installObsidianDomExtensions } from './harness/obsidian';

describe('renderer ownership primitives', () => {
  it('keeps one owned stylesheet per content root and removes only that stylesheet', () => {
    const content = document.createElement('div');
    const unrelated = document.createElement('style');
    unrelated.textContent = 'host rule';
    content.append(unrelated);
    const host = new OwnedStyleHost();

    const first = host.ensure(content);
    const second = host.ensure(content);

    expect(second).toBe(first);
    expect(content.querySelectorAll('style')).toHaveLength(2);
    host.clear(content);
    expect(content.querySelector('style')?.textContent).toBe('host rule');
  });

  it('provides isolated registry and pure rhythm calculations', () => {
    const registry = new ReadingRootRegistry<string>();
    const root = document.createElement('div');
    registry.set(root, 'state');
    expect(registry.get(root)).toBe('state');
    expect([...registry.keys()]).toEqual([root]);
    registry.clear();
    expect(registry.get(root)).toBeUndefined();
    expect(imageSnapPixels(47, 30)).toBeTypeOf('number');
    expect(variableBlockSnapPixels(47, 30)).toBeTypeOf('number');
  });

  it('gives each observer controller an explicit configure/clear lifecycle', () => {
    const harness = createObserverHarness();
    installObsidianDomExtensions(harness.window);
    const content = harness.window.document.createElement('div');
    const page = harness.window.document.createElement('div');
    page.className = 'templar-page';
    const pageContent = harness.window.document.createElement('div');
    pageContent.className = 'templar-content';
    const image = harness.window.document.createElement('img');
    const table = harness.window.document.createElement('table');
    pageContent.append(image, table);
    page.append(pageContent);
    content.append(page);
    harness.window.document.body.append(content);

    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    style.baseline.enabled = true;
    style.baseline.mode = 'balanced';
    style.baseline.snapImages = true;
    const metric = { baseline: 14, ascent: 11, descent: 4, lineHeight: 24, measuredAt: 0 };
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
    const leaf = {} as WorkspaceLeaf;
    const imageController = new ImageSnapController();
    const paperController = new PaperOriginController();
    const rhythmController = new VariableBlockRhythmController();

    imageController.configure(leaf, content, style);
    paperController.configure(leaf, content, style, metrics);
    rhythmController.configure(leaf, content, style);
    expect(harness.resizeInstances).toHaveLength(3);
    expect(harness.mutationInstances).toHaveLength(3);

    imageController.clear(leaf);
    paperController.clear(leaf);
    rhythmController.clear(leaf);
    expect(harness.resizeInstances.every((instance) => instance.disconnects > 0)).toBe(true);
    expect(harness.mutationInstances.every((instance) => instance.disconnects > 0)).toBe(true);
    expect(image.style.getPropertyValue('--templar-image-snap')).toBe('');
    expect(pageContent.style.getPropertyValue('--templar-paper-baseline-position')).toBe('');
    imageController.destroy();
    paperController.destroy();
    rhythmController.destroy();
  });

  it('cleans the previous root when a leaf is retargeted before clearing', () => {
    const harness = createObserverHarness();
    installObsidianDomExtensions(harness.window);
    const first = harness.window.document.createElement('div');
    const firstImage = harness.window.document.createElement('img');
    first.append(firstImage);
    const second = harness.window.document.createElement('div');
    const secondImage = harness.window.document.createElement('img');
    second.append(secondImage);
    harness.window.document.body.append(first, second);
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    style.baseline.snapImages = true;
    const leaf = {} as WorkspaceLeaf;
    const imageController = new ImageSnapController();
    imageController.configure(leaf, first, style);
    firstImage.setCssProps({ '--templar-image-snap': '1px' });
    imageController.configure(leaf, second, style);
    expect(firstImage.style.getPropertyValue('--templar-image-snap')).toBe('');
    imageController.clear(leaf);
    expect(secondImage.style.getPropertyValue('--templar-image-snap')).toBe('');
    imageController.destroy();
  });

  it('retargets PaperOrigin and VariableBlockRhythm without leaving old-root artifacts', () => {
    const harness = createObserverHarness();
    installObsidianDomExtensions(harness.window);
    const createRoot = (): { root: HTMLElement; pageContent: HTMLElement; table: HTMLElement } => {
      const root = harness.window.document.createElement('div');
      const page = harness.window.document.createElement('div');
      page.className = 'templar-page';
      const pageContent = harness.window.document.createElement('div');
      pageContent.className = 'templar-page-content';
      const table = harness.window.document.createElement('table');
      pageContent.append(table);
      page.append(pageContent);
      root.append(page);
      harness.window.document.body.append(root);
      return { root, pageContent, table };
    };
    const first = createRoot();
    const second = createRoot();
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    style.baseline.enabled = true;
    style.baseline.mode = 'balanced';
    const metric = { baseline: 14, ascent: 11, descent: 4, lineHeight: 24, measuredAt: 0 };
    const metrics: PageMetricSet = { body: metric, h1: metric, h2: metric, h3: metric, h4: metric, h5: metric, h6: metric, code: metric };
    const leaf = {} as WorkspaceLeaf;
    const paper = new PaperOriginController();
    const rhythm = new VariableBlockRhythmController();
    paper.configure(leaf, first.root, style, metrics);
    rhythm.configure(leaf, first.root, style);
    first.pageContent.setCssProps({ '--templar-paper-baseline-position': '4px' });
    first.table.addClass('templar-grid-snap-block');
    first.table.setCssProps({
      '--templar-grid-snap': '4px',
      '--templar-grid-natural-margin-end': '2px',
    });

    paper.configure(leaf, second.root, style, metrics);
    rhythm.configure(leaf, second.root, style);
    expect(first.pageContent.style.getPropertyValue('--templar-paper-baseline-position')).toBe('');
    expect(first.table.hasClass('templar-grid-snap-block')).toBe(false);
    expect(first.table.style.getPropertyValue('--templar-grid-snap')).toBe('');
    expect(first.table.style.getPropertyValue('--templar-grid-natural-margin-end')).toBe('');
    expect(harness.resizeInstances.slice(0, 2).every((instance) => instance.disconnects > 0)).toBe(true);

    paper.clear(leaf);
    rhythm.clear(leaf);
    expect(second.pageContent.style.getPropertyValue('--templar-paper-baseline-position')).toBe('');
    paper.destroy();
    rhythm.destroy();
  });

  it('cleans each controller using the old document realm before cross-window retargeting', () => {
    const first = createObserverHarness();
    const second = createObserverHarness();
    installObsidianDomExtensions(first.window);
    installObsidianDomExtensions(second.window);
    const rootFor = (owner: Window): HTMLElement => {
      const root = owner.document.createElement('div');
      const page = owner.document.createElement('div');
      page.className = 'templar-page';
      const content = owner.document.createElement('div');
      content.className = 'templar-page-content';
      content.append(owner.document.createElement('img'), owner.document.createElement('table'));
      page.append(content);
      root.append(page);
      owner.document.body.append(root);
      return root;
    };
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    style.baseline.enabled = true;
    style.baseline.mode = 'balanced';
    style.baseline.snapImages = true;
    const metric = { baseline: 14, ascent: 11, descent: 4, lineHeight: 24, measuredAt: 0 };
    const metrics: PageMetricSet = { body: metric, h1: metric, h2: metric, h3: metric, h4: metric, h5: metric, h6: metric, code: metric };
    const leaf = {} as WorkspaceLeaf;
    const image = new ImageSnapController();
    const paper = new PaperOriginController();
    const rhythm = new VariableBlockRhythmController();
    const firstRoot = rootFor(first.window);
    const secondRoot = rootFor(second.window);
    image.configure(leaf, firstRoot, style);
    paper.configure(leaf, firstRoot, style, metrics);
    rhythm.configure(leaf, firstRoot, style);
    image.configure(leaf, secondRoot, style);
    paper.configure(leaf, secondRoot, style, metrics);
    rhythm.configure(leaf, secondRoot, style);
    expect(first.resizeInstances.every((instance) => instance.disconnects > 0)).toBe(true);
    expect(first.mutationInstances.every((instance) => instance.disconnects > 0)).toBe(true);
    image.destroy();
    paper.destroy();
    rhythm.destroy();
  });
});
