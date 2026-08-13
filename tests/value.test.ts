import { describe, expect, it } from 'vitest';
import { numberValue } from '../src/utils/value';

describe('value normalization', () => {
  it('treats blank numeric input as missing', () => {
    expect(numberValue('', 42, 0, 100)).toBe(42);
    expect(numberValue('   ', 42, 0, 100)).toBe(42);
    expect(numberValue('\t\n', 42, 0, 100)).toBe(42);
    expect(numberValue(' 43 ', 42, 0, 100)).toBe(43);
  });
});
