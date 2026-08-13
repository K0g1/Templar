/* @vitest-environment happy-dom */

import { describe, expect, it, vi } from 'vitest';
import { bindPreviewEscape } from '../src/services/preview-keyboard';
import type { PreviewSession } from '../src/services/preview-session';
import { createObserverHarness } from './harness/dom-realm';

describe('pop-out preview ownership', () => {
  it('cancels only the preview owned by the event document', async () => {
    const first = createObserverHarness();
    const second = createObserverHarness();
    const cancelled: string[] = [];
    const sessions = new Map<Document, PreviewSession>([
      [first.window.document, { owner: 'first-preview' } as PreviewSession],
      [second.window.document, { owner: 'second-preview' } as PreviewSession],
    ]);
    const preview = {
      currentForLeaf: vi.fn(() => null),
      sessionsForDocument: (document: Document) => {
        const session = sessions.get(document);
        return session ? [session] : [];
      },
      cancel: vi.fn(async (owner: string) => {
        cancelled.push(owner);
      }),
    };
    const cleanups = [
      bindPreviewEscape(first.window.document, preview, () => null, () => undefined),
      bindPreviewEscape(second.window.document, preview, () => null, () => undefined),
    ];

    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    second.window.document.dispatchEvent(event);
    await Promise.resolve();

    expect(event.defaultPrevented).toBe(true);
    expect(cancelled).toEqual(['second-preview']);
    expect(preview.cancel).toHaveBeenCalledTimes(1);

    cleanups.forEach((cleanup) => cleanup());
    const afterCleanup = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    first.window.document.dispatchEvent(afterCleanup);
    await Promise.resolve();
    expect(preview.cancel).toHaveBeenCalledTimes(1);
  });

  it('uses the active leaf when multiple previews share one document', async () => {
    const harness = createObserverHarness();
    const firstLeaf = { view: { containerEl: harness.window.document.createElement('div') } };
    const secondLeaf = { view: { containerEl: harness.window.document.createElement('div') } };
    const active = secondLeaf as never;
    const sessions = new Map<object, PreviewSession>([
      [firstLeaf, { owner: 'first-preview', leaf: firstLeaf } as unknown as PreviewSession],
      [secondLeaf, { owner: 'second-preview', leaf: secondLeaf } as unknown as PreviewSession],
    ]);
    const cancelled: string[] = [];
    const preview = {
      currentForLeaf: (leaf: object) => sessions.get(leaf) ?? null,
      sessionsForDocument: () => [...sessions.values()],
      cancel: vi.fn(async (owner: string) => { cancelled.push(owner); }),
    };
    const cleanup = bindPreviewEscape(
      harness.window.document,
      preview,
      () => active,
      () => undefined,
    );

    harness.window.document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await Promise.resolve();
    expect(cancelled).toEqual(['second-preview']);
    cleanup();
  });

  it('does nothing when the active leaf is unresolved and the document has multiple previews', async () => {
    const harness = createObserverHarness();
    const sessions = [
      { owner: 'first-preview' } as PreviewSession,
      { owner: 'second-preview' } as PreviewSession,
    ];
    const preview = {
      currentForLeaf: vi.fn(() => null),
      sessionsForDocument: () => sessions,
      cancel: vi.fn(async () => undefined),
    };
    const cleanup = bindPreviewEscape(harness.window.document, preview, () => null, () => undefined);
    harness.window.document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await Promise.resolve();
    expect(preview.cancel).not.toHaveBeenCalled();
    cleanup();
  });

  it('falls back to the sole preview in a document and never crosses popout documents', async () => {
    const main = createObserverHarness();
    const popout = createObserverHarness();
    const cancelled: string[] = [];
    const sessions = new Map<Document, PreviewSession>([
      [main.window.document, { owner: 'main-preview' } as PreviewSession],
      [popout.window.document, { owner: 'popout-preview' } as PreviewSession],
    ]);
    const preview = {
      currentForLeaf: vi.fn(() => null),
      sessionsForDocument: (document: Document) => {
        const session = sessions.get(document);
        return session ? [session] : [];
      },
      cancel: vi.fn(async (owner: string) => { cancelled.push(owner); }),
    };
    const cleanup = bindPreviewEscape(popout.window.document, preview, () => null, () => undefined);
    popout.window.document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await Promise.resolve();
    expect(cancelled).toEqual(['popout-preview']);
    expect(cancelled).not.toContain('main-preview');
    cleanup();
  });
});
