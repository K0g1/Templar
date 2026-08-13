import { describe, expect, it } from 'vitest';
import { compileHeadings } from '../src/services/style-compiler/headings';
import { compileTypography } from '../src/services/style-compiler/typography';
import { fragmentContext } from './style-compiler-fixture';

describe('typography compiler fragments', () => {
  it('keeps heading metrics and semantic text palettes scoped', () => {
    const context = fragmentContext();
    expect(compileHeadings(context)).toContain(':is(h4, .HyperMD-header-4)');
    expect(compileTypography(context)).toContain('.templar-page pre {');
    expect(compileTypography(context)).toContain('.cm-highlight');
  });
});
