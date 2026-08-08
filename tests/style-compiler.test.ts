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
  code: { baseline: 20, ascent: 14, descent: 4, lineHeight: 30, measuredAt: 0 },
};

describe('structured style compiler', () => {
  it('aligns ruled paper to the measured body baseline', () => {
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    const result = compilePageStyle(
      style,
      '[data-templar-scope="templar-test"]',
      'test',
      metrics,
    );
    expect(result.css).toContain('--templar-baseline-position: 81px');
    expect(result.css).toContain('background-position: 0 0, 0 81px');
    expect(result.css).toContain('line-height: 30px');
  });

  it('uses the measured text baseline as the shared dot and graph origin', () => {
    const dotStyle = templateToNoteStyle(BUILT_IN_TEMPLATES[3]!);
    const graphStyle = templateToNoteStyle(BUILT_IN_TEMPLATES[4]!);
    const dotCss = compilePageStyle(
      dotStyle,
      '[data-templar-scope="templar-dot"]',
      'dot',
      metrics,
    ).css;
    const graphCss = compilePageStyle(
      graphStyle,
      '[data-templar-scope="templar-graph"]',
      'graph',
      metrics,
    ).css;

    expect(dotCss).toContain(
      'background-position: calc(min(96px, 18%) - 14px) calc(81px - 14px)',
    );
    expect(graphCss).toContain('background-position: min(96px, 18%) 81px');
    expect(graphCss).toContain(
      '.templar-page :is(p, li, .HyperMD-paragraph, .HyperMD-list-line, .HyperMD-quote)',
    );
    expect(graphCss).toContain('padding-block: 0 !important');
    expect(graphCss).toContain('margin-block: 0 0px !important');
    expect(graphCss).toContain('.cm-line.HyperMD-list-line');
    expect(graphCss).toContain('line-height: 24px !important');
  });

  it('baseline-corrects Reading code blocks and styles H4', () => {
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    const css = compilePageStyle(
      style,
      '[data-templar-scope="templar-code"]',
      'code',
      metrics,
    ).css;
    expect(css).toContain('.templar-page pre {');
    expect(css).toContain('padding: 1px 15px 29px !important');
    expect(css).toContain('.HyperMD-codeblock');
    expect(css).toContain(':is(h4, .HyperMD-header-4)');
  });

  it('emits explicit, palette-specific highlight colors for every built-in', () => {
    for (const template of BUILT_IN_TEMPLATES) {
      const style = templateToNoteStyle(template);
      const css = compilePageStyle(
        style,
        `[data-templar-scope="templar-${template.id}"]`,
        template.id,
        metrics,
      ).css;
      expect(css, template.name).toContain(
        `background-color: ${template.blocks.highlightBackground}`,
      );
      expect(css, template.name).toContain(
        `color: ${template.blocks.highlightTextColor}`,
      );
      expect(css, template.name).toContain('.cm-highlight');
    }
  });

  it('contains structured string injection inside a declaration value', () => {
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    style.paper.color = 'red; } body { display: none';
    const result = compilePageStyle(
      style,
      '[data-templar-scope="templar-test"]',
      'test',
      metrics,
    );
    expect(result.css).not.toContain('body { display');
    expect(result.css).toContain('background-color: #fffdf7');
  });

  it('emits a fixed, scalable sheet canvas in paged mode', () => {
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    style.page.mode = 'paged';
    style.page.size = 'letter';
    style.page.width = 816;
    style.page.height = 1056;
    const result = compilePageStyle(
      style,
      '[data-templar-scope="templar-test"]',
      'test',
      metrics,
    );
    expect(result.css).toContain('--templar-page-width: 816px');
    expect(result.css).toContain('--templar-page-height: 1056px');
    expect(result.css).toContain(
      'min-height: var(--templar-canvas-height, 1056px)',
    );
    expect(result.css).toContain('zoom: var(--templar-page-scale)');
    expect(result.css).toContain('max-width: none');
    expect(result.css).toContain('width: 816px !important');
    expect(result.css).toContain('zoom: var(--templar-page-scale) !important');
    expect(result.css).toContain('mask-image: repeating-linear-gradient');
  });
});
