/* @vitest-environment happy-dom */

import { describe, expect, it } from 'vitest';
import { waitForLayoutQuiet } from '../src/services/print-layout-quiet';
import { createObserverHarness } from './harness/dom-realm';

describe('print layout observer ownership', () => {
  it('waits with the target document observers instead of the caller realm', async () => {
    const caller = createObserverHarness();
    const target = createObserverHarness();
    const element = target.window.document.createElement('div');
    target.window.document.body.append(element);

    await waitForLayoutQuiet(element, caller.window);

    expect(caller.resizeInstances).toHaveLength(0);
    expect(caller.mutationInstances).toHaveLength(0);
    expect(target.resizeInstances).toHaveLength(1);
    expect(target.mutationInstances).toHaveLength(1);
    expect(target.resizeInstances[0]?.disconnects).toBe(1);
    expect(target.mutationInstances[0]?.disconnects).toBe(1);
  });
});
