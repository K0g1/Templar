/* @vitest-environment happy-dom */

import { describe, expect, it } from 'vitest';
import { writeTextToClipboard } from '../src/utils/clipboard';

describe('clipboard focus restoration', () => {
  it('returns focus to the previously focused control after the fallback copy', async () => {
    const ownerDocument = document;
    const button = ownerDocument.createElement('button');
    ownerDocument.body.append(button);
    button.focus();
    Object.defineProperty(ownerDocument, 'execCommand', { configurable: true, value: () => true });
    await writeTextToClipboard('Templar', ownerDocument);
    expect(ownerDocument.activeElement).toBe(button);
  });
});
