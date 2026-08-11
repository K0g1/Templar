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
      currentForDocument: (document: Document) => sessions.get(document) ?? null,
      cancel: vi.fn(async (owner: string) => {
        cancelled.push(owner);
      }),
    };
    const cleanups = [
      bindPreviewEscape(first.window.document, preview, () => undefined),
      bindPreviewEscape(second.window.document, preview, () => undefined),
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
});
