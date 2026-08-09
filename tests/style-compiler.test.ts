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

  it('styles h5 and h6 with their own rules and live preview classes', () => {
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    const css = compilePageStyle(
      style,
      '[data-templar-scope="templar-test"]',
      'test',
      metrics,
    ).css;
    expect(css).toContain(':is(h5, .HyperMD-header-5)');
    expect(css).toContain(':is(h6, .HyperMD-header-6)');
    expect(css).toContain(`font-size: ${String(style.headings.h5.size)}px`);
    expect(css).toContain(`font-size: ${String(style.headings.h6.size)}px`);
    expect(css).toContain('letter-spacing: 0px');
  });

  it('honors an explicit body line height', () => {
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    style.baseline.mode = 'free';
    style.baseline.enabled = false;
    style.typography.bodyLineHeight = 34;
    const css = compilePageStyle(
      style,
      '[data-templar-scope="templar-test"]',
      'test',
      metrics,
    ).css;
    expect(css).toContain('--templar-body-line-height: 34px');
  });

  it('emits watermark, callout, divider, table, and list declarations', () => {
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    style.watermark.text = 'Draft copy';
    style.watermark.size = 120;
    style.watermark.rotation = -30;
    style.blocks.dividerStyle = 'dashed';
    style.blocks.dividerWidth = 3;
    style.blocks.tableStriped = true;
    style.blocks.tableFontSize = 14;
    style.blocks.tablePadding = 6;
    style.lists.markerStyle = 'square';
    style.blocks.calloutVariants = {
      warning: { accent: '#c77b3a' },
    };
    const css = compilePageStyle(
      style,
      '[data-templar-scope="templar-test"]',
      'test',
      metrics,
    ).css;
    expect(css).toContain('--templar-watermark: "Draft copy"');
    expect(css).toContain('font-size: 120px');
    expect(css).toContain('transform: rotate(-30deg)');
    expect(css).toContain('.templar-page-content::after');
    expect(css).toContain('repeating-linear-gradient(to right');
    expect(css).toContain('height: 30px !important');
    expect(css).toContain('tbody tr:nth-child(even)');
    expect(css).toContain('font-size: 14px');
    expect(css).toContain('padding: 6px');
    expect(css).toContain('list-style-type: square');
    expect(css).toContain('[data-callout="warning"]');
    expect(css).toContain('--callout-border-color: #c77b3a');
  });

  it('allocates exactly one baseline row to every gridded divider style', () => {
    for (const unit of [24, 30, 42]) {
      for (const dividerStyle of ['solid', 'dashed', 'dotted', 'double', 'fade'] as const) {
        const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
        style.baseline.enabled = true;
        style.baseline.mode = unit === 24 ? 'balanced' : 'strict';
        style.baseline.unit = unit;
        style.blocks.dividerStyle = dividerStyle;
        style.blocks.dividerWidth = 20;
        const css = compilePageStyle(style, '[data-templar-scope="divider"]', 'divider', metrics).css;
        expect(css, `${String(unit)} ${dividerStyle}`).toContain(`height: ${String(unit)}px !important`);
        expect(css, `${String(unit)} ${dividerStyle}`).toContain('margin-block: 0 !important');
      }
    }
  });

  it('retains ordinary divider spacing when baseline alignment is off', () => {
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    style.baseline.enabled = false;
    style.baseline.mode = 'free';
    const css = compilePageStyle(style, '[data-templar-scope="divider-free"]', 'divider-free', metrics).css;
    expect(css).toContain('border-block-start: 1px solid');
    expect(css).toContain('margin-block: 18.135px !important');
  });

  it('escapes watermark text and rejects pattern injection', () => {
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    style.watermark.text = 'He said "hi"';
    style.paper.patternColor = 'red; } body { display: none';
    const css = compilePageStyle(
      style,
      '[data-templar-scope="templar-test"]',
      'test',
      metrics,
    ).css;
    expect(css).toContain('--templar-watermark: "He said \\"hi\\""');
    expect(css).not.toContain('body { display');
  });

  it('applies duotone and float to images', () => {
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    style.images.duotone = '#a34f2c';
    style.images.float = 'right';
    style.images.objectFit = 'cover';
    const css = compilePageStyle(
      style,
      '[data-templar-scope="templar-test"]',
      'test',
      metrics,
    ).css;
    expect(css).toContain('float: right');
    expect(css).toContain('object-fit: cover');
    expect(css).toContain('grayscale(1) sepia(1)');
    expect(css).toContain('hue-rotate(');
    expect(css).toContain('margin-inline: 0 0 0 1em');
  });

  it('renders every new paper pattern', () => {
    for (const pattern of ['ledger', 'cross-hatch', 'diagonal', 'hex', 'scallop'] as const) {
      const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
      style.paper.pattern = pattern;
      const css = compilePageStyle(
        style,
        '[data-templar-scope="templar-test"]',
        'test',
        metrics,
      ).css;
      expect(css.length, pattern).toBeGreaterThan(0);
      expect(css, pattern).toContain('background-image');
    }
  });

  it('keeps pageless paper and margin layers above the page background', () => {
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    style.page.mode = 'pageless';
    style.paper.pattern = 'ruled';
    style.paper.marginLine = true;
    const css = compilePageStyle(
      style,
      '[data-templar-scope="templar-pattern-layer"]',
      'pattern-layer',
      metrics,
    ).css;
    expect(css).toContain('.templar-page-content {');
    expect(css).toContain('isolation: isolate;');
    expect(css).toContain('.templar-page-content::before {');
    expect(css).toContain('background-image: linear-gradient(to right');
  });
});
