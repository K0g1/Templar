import { describe, expect, it } from 'vitest';
import {
  blankLinesBetweenSections,
  internalBlankLineRuns,
} from '../src/services/reading-whitespace';

describe('Reading View blank-line preservation', () => {
  it('converts source line gaps into exact visual blank-line counts', () => {
    expect(blankLinesBetweenSections(4, 5)).toBe(0);
    expect(blankLinesBetweenSections(4, 6)).toBe(1);
    expect(blankLinesBetweenSections(4, 10)).toBe(5);
  });

  it('counts internal runs without treating fenced-code blanks as returns', () => {
    expect(internalBlankLineRuns('One\n\n\nTwo\n\nThree')).toEqual([2, 1]);
    expect(
      internalBlankLineRuns('Before\n\n```ts\nconst a = 1;\n\nreturn a;\n```\n\nAfter'),
    ).toEqual([1, 1]);
  });
});
