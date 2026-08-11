import { describe, expect, it } from 'vitest';
import { isTemplarFrontmatterKey } from '../src/editor/hide-metadata';

describe('Templar frontmatter hiding', () => {
  it('recognizes plain and quoted top-level YAML keys', () => {
    expect(isTemplarFrontmatterKey('templar:')).toBe(true);
    expect(isTemplarFrontmatterKey('"templar" :')).toBe(true);
    expect(isTemplarFrontmatterKey("'templar':")).toBe(true);
    expect(isTemplarFrontmatterKey('  templar:')).toBe(false);
    expect(isTemplarFrontmatterKey('templar-extra:')).toBe(false);
  });
});
