import { describe, expect, it } from 'vitest';
import { BUILT_IN_TEMPLATES } from '../src/templates/builtins';
import { templateToNoteStyle } from '../src/templates/note-format';
import { compilePageStyle, type PageMetricSet } from '../src/services/style-compiler';

const metrics: PageMetricSet = {
  body: { baseline: 21, ascent: 14, descent: 4, lineHeight: 30, measuredAt: 0 },
  h1: { baseline: 48, ascent: 38, descent: 8, lineHeight: 60, measuredAt: 0 },
  h2: { baseline: 37, ascent: 29, descent: 6, lineHeight: 60, measuredAt: 0 },
  h3: { baseline: 24, ascent: 19, descent: 5, lineHeight: 30, measuredAt: 0 },
  h4: { baseline: 21, ascent: 16, descent: 4, lineHeight: 30, measuredAt: 0 },
  h5: { baseline: 18, ascent: 14, descent: 4, lineHeight: 24, measuredAt: 0 },
  h6: { baseline: 16, ascent: 12, descent: 4, lineHeight: 24, measuredAt: 0 },
  code: { baseline: 20, ascent: 14, descent: 4, lineHeight: 30, measuredAt: 0 },
};

function compileWith(style: ReturnType<typeof templateToNoteStyle>): string {
  return compilePageStyle(
    style,
    '[data-templar-scope="templar-struct"]',
    'struct',
    metrics,
  ).css;
}

describe('structured style field injection protection', () => {
  it('plain structured color values compile normally', () => {
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    const css = compileWith(style);
    expect(css).toContain('color:');
    expect(css).not.toContain('url(');
  });

  it('literal url() in a structured color field is neutralized', () => {
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    style.paper.color = 'url(https://evil.com/x.png)';
    const css = compileWith(style);
    // The malicious value must not reach the output as a url().
    expect(css).not.toContain('url(');
    expect(css).not.toContain('evil.com');
  });

  it('escaped url() in a structured color field is neutralized', () => {
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    style.paper.color = 'u\\72l(https://evil.com/x.png)';
    const css = compileWith(style);
    expect(css).not.toContain('url(');
    expect(css).not.toContain('evil.com');
  });

  it('hex-escaped url() in a structured color field is neutralized', () => {
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    style.paper.color = '\\75rl(https://evil.com/x.png)';
    const css = compileWith(style);
    expect(css).not.toContain('url(');
    expect(css).not.toContain('evil.com');
  });

  it('CSS escape in callout accent is neutralized', () => {
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    style.blocks.calloutAccent = 'u\\72l(https://evil.com/a.png)';
    const css = compileWith(style);
    expect(css).not.toContain('url(');
    expect(css).not.toContain('evil.com');
  });

  it('semicolon injection in a structured field is neutralized', () => {
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    style.paper.color = 'red; background: url(https://evil.com/x.png);';
    const css = compileWith(style);
    expect(css).not.toContain('evil.com');
    expect(css).not.toContain('background: url');
  });

  it('font family with url() is neutralized', () => {
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    style.typography.bodyFont = 'Georgia, url(https://evil.com/font.woff2)';
    const css = compileWith(style);
    expect(css).not.toContain('url(');
    expect(css).not.toContain('evil.com');
  });
});
