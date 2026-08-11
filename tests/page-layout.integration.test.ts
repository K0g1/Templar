/* @vitest-environment happy-dom */

import { describe, expect, it } from 'vitest';
import { PageLayoutService } from '../src/services/page-layout';
import { realmFor } from '../src/services/dom-realm';
import { templateToNoteStyle } from '../src/templates/note-format';
import { BUILT_IN_TEMPLATES } from '../src/templates/builtins';
import { createObserverHarness } from './harness/dom-realm';
import { fakeLeaf } from './harness/fake-leaf';

function scopeFor(owner: Window): HTMLElement {
  const page = owner.document.createElement('div');
  page.className = 'templar-page';
  const content = owner.document.createElement('div');
  content.className = 'templar-page-content';
  page.append(content);
  owner.document.body.append(page);
  return owner.document.body;
}

describe('PageLayout DOM realm ownership', () => {
  it('derives the document and observer constructors from each leaf realm', () => {
    const first = createObserverHarness();
    const second = createObserverHarness();
    const firstElement = first.window.document.createElement('div');
    const secondElement = second.window.document.createElement('div');
    expect(realmFor(firstElement).document).toBe(first.window.document);
    expect(realmFor(firstElement).ResizeObserver).not.toBe(realmFor(secondElement).ResizeObserver);
    expect(realmFor(secondElement).MutationObserver).not.toBe(realmFor(firstElement).MutationObserver);
  });

  it('configures and disconnects observers from the owning pop-out realm', () => {
    const first = createObserverHarness();
    const second = createObserverHarness();
    const service = new PageLayoutService();
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    style.page.mode = 'paged';
    const leaf = fakeLeaf();
    const scope = scopeFor(second.window);

    service.configure(leaf, scope, style);
    expect(first.resizeInstances).toHaveLength(0);
    expect(first.mutationInstances).toHaveLength(0);
    expect(second.resizeInstances).toHaveLength(1);
    expect(second.mutationInstances).toHaveLength(1);
    expect(second.resizeInstances[0]?.observes.length).toBeGreaterThan(0);
    expect(second.mutationInstances[0]?.observes.length).toBeGreaterThan(0);

    service.clear(leaf);
    expect(second.resizeInstances[0]?.disconnects).toBe(1);
    expect(second.mutationInstances[0]?.disconnects).toBe(1);
  });
});
