/* @vitest-environment happy-dom */

import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  MarkdownView: class MarkdownView {},
  TFile: class TFile {},
}));

import type { WorkspaceLeaf } from 'obsidian';
import { PageRenderer } from '../src/services/page-renderer';
import { DEFAULT_SETTINGS } from '../src/templates/defaults';
import { ImageSnapController } from '../src/services/rendering/image-snap-controller';
import { PaperOriginController } from '../src/services/rendering/paper-origin-controller';
import { VariableBlockRhythmController } from '../src/services/rendering/variable-block-rhythm-controller';
import { OwnedStyleHost } from '../src/services/rendering/style-host';
import { BUILT_IN_TEMPLATES } from '../src/templates/builtins';
import { templateToNoteStyle } from '../src/templates/note-format';
import { createObserverHarness } from './harness/dom-realm';
import { installObsidianDomExtensions } from './harness/obsidian';

describe('renderer lifecycle invariants', () => {
  it('coalesces repeated refresh scheduling', async () => {
    const renderer = new PageRenderer(
      { workspace: { getLeavesOfType: () => [] } } as never,
      DEFAULT_SETTINGS,
      {} as never,
      { clear: vi.fn() } as never,
    );
    const refresh = vi.spyOn(renderer, 'refreshAll').mockResolvedValue();
    renderer.scheduleRefreshAll();
    renderer.scheduleRefreshAll();
    renderer.scheduleRefreshAll();
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(1);
    renderer.destroy();
  });

  it('keeps one active observer state per controller and cleans every owned artifact', () => {
    const harness = createObserverHarness();
    installObsidianDomExtensions(harness.window);
    const content = harness.window.document.createElement('div');
    const page = harness.window.document.createElement('div');
    page.className = 'templar-page';
    const pageContent = harness.window.document.createElement('div');
    pageContent.className = 'templar-page-content';
    pageContent.append(harness.window.document.createElement('img'));
    pageContent.append(harness.window.document.createElement('table'));
    page.append(pageContent);
    content.append(page);
    harness.window.document.body.append(content);
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    style.baseline.enabled = true;
    style.baseline.mode = 'balanced';
    style.baseline.snapImages = true;
    const metric = { baseline: 14, ascent: 11, descent: 4, lineHeight: 24, measuredAt: 0 };
    const metrics = { body: metric, h1: metric, h2: metric, h3: metric, h4: metric, h5: metric, h6: metric, code: metric };
    const leaf = {} as WorkspaceLeaf;
    const image = new ImageSnapController();
    const paper = new PaperOriginController();
    const rhythm = new VariableBlockRhythmController();
    image.configure(leaf, content, style);
    paper.configure(leaf, content, style, metrics);
    rhythm.configure(leaf, content, style);
    image.configure(leaf, content, style);
    paper.configure(leaf, content, style, metrics);
    rhythm.configure(leaf, content, style);
    expect(harness.resizeInstances).toHaveLength(6);
    expect(harness.resizeInstances.slice(0, 3).every((instance) => instance.disconnects > 0)).toBe(true);
    image.destroy();
    paper.destroy();
    rhythm.destroy();
    expect(harness.resizeInstances.every((instance) => instance.disconnects > 0)).toBe(true);
    expect(harness.mutationInstances.every((instance) => instance.disconnects > 0)).toBe(true);

    const host = new OwnedStyleHost();
    host.ensure(content).textContent = 'Owned';
    expect(content.querySelectorAll('style.templar-note-style')).toHaveLength(1);
    host.clear(content);
    expect(content.querySelector('style.templar-note-style')).toBeNull();
    expect(content.querySelector('.templar-blank-line-spacer')).toBeNull();
  });
});
