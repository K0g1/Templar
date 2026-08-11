/* @vitest-environment happy-dom */

import { describe, expect, it } from 'vitest';
import { OwnedStyleHost } from '../src/services/rendering/style-host';
import { ReadingRootRegistry } from '../src/services/rendering/reading-root-registry';
import { imageSnapPixels } from '../src/services/rendering/image-snap-controller';
import { variableBlockSnapPixels } from '../src/services/rendering/variable-block-rhythm-controller';

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
});
