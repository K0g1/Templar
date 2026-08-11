import { describe, expect, it } from 'vitest';
import {
  blankLinesBeforeFirstSection,
  blankLinesBetweenSections,
  bodyStartLineAfterFrontmatter,
  hasReadingWhitespaceWork,
  internalBlankLineRuns,
  readingRootNeedsRetarget,
} from '../src/services/reading-whitespace';

describe('Reading View blank-line preservation', () => {
  it('starts the body after the closing frontmatter delimiter', () => {
    expect(bodyStartLineAfterFrontmatter(340)).toBe(341);
    expect(bodyStartLineAfterFrontmatter()).toBe(0);
  });

  it('preserves leading body returns without counting hidden YAML', () => {
    expect(blankLinesBeforeFirstSection(341, 341)).toBe(0);
    expect(blankLinesBeforeFirstSection(341, 342)).toBe(1);
    expect(blankLinesBeforeFirstSection(341, 346)).toBe(5);
    expect(blankLinesBeforeFirstSection(0, 3)).toBe(3);
  });

  it('converts source line gaps into exact visual blank-line counts', () => {
    expect(blankLinesBetweenSections(4, 5)).toBe(0);
    expect(blankLinesBetweenSections(4, 6)).toBe(1);
    expect(blankLinesBetweenSections(4, 10)).toBe(5);
    const source = 'A\n<!-- hidden -->\n\n\nB';
    expect(blankLinesBetweenSections(0, 4, source)).toBe(2);
    expect(blankLinesBeforeFirstSection(0, 3, '<!-- hidden -->\n\n\nText')).toBe(2);
  });

  it('counts internal runs without treating fenced-code blanks as returns', () => {
    expect(internalBlankLineRuns('One\n\n\nTwo\n\nThree')).toEqual([2, 1]);
    expect(
      internalBlankLineRuns('Before\n\n```ts\nconst a = 1;\n\nreturn a;\n```\n\nAfter'),
    ).toEqual([1, 1]);
    expect(
      internalBlankLineRuns('Before\n\n````md\n```\n\ninside\n```\n````\n\nAfter'),
    ).toEqual([1, 1]);
  });

  it('retargets a reused Reading root when a leaf opens another file', () => {
    expect(readingRootNeedsRetarget(null, 'First.md')).toBe(true);
    expect(readingRootNeedsRetarget('First.md', 'First.md')).toBe(false);
    expect(readingRootNeedsRetarget('First.md', 'Second.md')).toBe(true);
  });

  it('reconciles registered cached sections without a new post-processor context', () => {
    expect(hasReadingWhitespaceWork(false, false, 0)).toBe(false);
    expect(hasReadingWhitespaceWork(false, false, 2)).toBe(true);
    expect(hasReadingWhitespaceWork(true, false, 0)).toBe(true);
    expect(hasReadingWhitespaceWork(false, true, 0)).toBe(true);
  });
});
