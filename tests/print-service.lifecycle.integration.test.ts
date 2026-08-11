/* @vitest-environment happy-dom */

import { describe, expect, it, vi } from 'vitest';
import { MarkdownView, Notice, TFile } from 'obsidian';
import { PrintService } from '../src/services/print-service';
import { BUILT_IN_TEMPLATES } from '../src/templates/builtins';
import { templateToNoteStyle } from '../src/templates/note-format';
import { createObserverHarness } from './harness/dom-realm';
import { installObsidianDomExtensions } from './harness/obsidian';

function file(path: string): TFile {
  return Object.assign(Object.create(TFile.prototype) as TFile, {
    path,
    basename: path.split('/').pop()?.replace(/\.md$/, '') ?? path,
    extension: 'md',
  });
}

function createPrintFixture() {
  const harness = createObserverHarness();
  installObsidianDomExtensions(harness.window);
  const note = file('Notes/print.md');
  const content = harness.window.document.createElement('div');
  const styleElement = harness.window.document.createElement('style');
  styleElement.className = 'templar-note-style';
  styleElement.textContent = 'Screen CSS';
  content.append(styleElement);
  harness.window.document.body.append(content);
  Object.defineProperty(harness.window, 'print', { configurable: true, value: vi.fn() });
  const view = Object.create(MarkdownView.prototype) as MarkdownView & {
    contentEl: HTMLElement;
    containerEl: HTMLElement;
    file: TFile;
    getState: () => Record<string, unknown>;
    getMode: () => string;
    setState: (state: Record<string, unknown>, options: { history: boolean }) => Promise<void>;
  };
  view.contentEl = content;
  view.containerEl = content;
  view.file = note;
  view.getState = () => ({ mode: 'source' });
  view.getMode = () => 'source';
  view.setState = async () => undefined;
  return { harness, note, view, leaf: { view }, style: templateToNoteStyle(BUILT_IN_TEMPLATES[0]!) };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function flushUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20 && !predicate(); attempt += 1) {
    await Promise.resolve();
  }
}

describe('PrintService lifecycle', () => {
  it('keeps printing busy until the original view is restored', async () => {
    const fixture = createPrintFixture();
    const restoration = deferred();
    let refreshes = 0;
    const renderer = {
      resolvedStyle: () => fixture.style,
      refreshLeafNow: vi.fn(async () => {
        refreshes += 1;
        if (refreshes === 2) await restoration.promise;
      }),
      preparePrint: vi.fn(),
      restoreAfterPrint: vi.fn(),
    };
    const service = new PrintService(
      { getStyle: () => fixture.style } as never,
      renderer as never,
    );

    await service.print(fixture.leaf as never, fixture.note);
    expect(renderer.restoreAfterPrint).toHaveBeenCalledTimes(1);
    await expect(service.print(fixture.leaf as never, fixture.note)).rejects.toThrow('already preparing');

    await flushUntil(() => refreshes === 2);
    restoration.resolve();
    for (let attempt = 0; attempt < 6; attempt += 1) await Promise.resolve();
    await expect(service.print(fixture.leaf as never, fixture.note)).resolves.toBeUndefined();
    service.destroy();
  });

  it('cleans print state and reports a restoration failure', async () => {
    const fixture = createPrintFixture();
    const noticeLog = Notice as unknown as { messages: string[] };
    noticeLog.messages.length = 0;
    let refreshes = 0;
    const renderer = {
      resolvedStyle: () => fixture.style,
      refreshLeafNow: vi.fn(async () => {
        refreshes += 1;
        if (refreshes === 2) throw new Error('restore failed');
      }),
      preparePrint: vi.fn(),
      restoreAfterPrint: vi.fn(),
    };
    const service = new PrintService(
      { getStyle: () => fixture.style } as never,
      renderer as never,
    );

    await service.print(fixture.leaf as never, fixture.note);
    await flushUntil(() => noticeLog.messages.length > 0);
    expect(fixture.harness.window.document.body.hasClass('templar-printing')).toBe(false);
    expect(fixture.view.contentEl.dataset.templarPrintTarget).toBeUndefined();
    expect(noticeLog.messages.some((message) => message.includes('restore failed'))).toBe(true);
    service.destroy();
  });
});
