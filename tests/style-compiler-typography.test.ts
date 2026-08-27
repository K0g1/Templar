import { describe, expect, it } from 'vitest';
import { compileHeadings } from '../src/services/style-compiler/headings';
import { compileTypography } from '../src/services/style-compiler/typography';
import { fragmentContext } from './style-compiler-fixture';

describe('typography compiler fragments', () => {
  it('keeps heading metrics and semantic text palettes scoped', () => {
    const context = fragmentContext();
    const typography = compileTypography(context);
    expect(compileHeadings(context)).toContain(':is(h4, .HyperMD-header-4)');
    expect(typography).toContain('.templar-page pre {');
    expect(typography).toContain('.cm-highlight');
    expect(typography).toContain(':is(code, .cm-inline-code, kbd, mark)');
    expect(typography).toContain('padding-block: 0 !important');
    expect(typography).toContain(':is(sup, sub)');
    expect(typography).toContain('inset-block-start:');
  });

  it('does not impose grid-only inline normalization in free mode', () => {
    const context = fragmentContext((style) => {
      style.baseline.enabled = false;
      style.baseline.mode = 'free';
    });
    const typography = compileTypography(context);
    expect(typography).not.toContain(':is(code, .cm-inline-code, kbd, mark)');
  });
});
