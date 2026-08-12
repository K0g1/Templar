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

    imageController.clear(leaf, content);
    paperController.clear(leaf, content);
    rhythmController.clear(leaf, content);
    expect(harness.resizeInstances.every((instance) => instance.disconnects > 0)).toBe(true);
    expect(harness.mutationInstances.every((instance) => instance.disconnects > 0)).toBe(true);
    expect(image.style.getPropertyValue('--templar-image-snap')).toBe('');
    expect(pageContent.style.getPropertyValue('--templar-paper-baseline-position')).toBe('');
    imageController.destroy();
    paperController.destroy();
    rhythmController.destroy();
  });
});
