import postcss, { type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';
import { compileCustomCss, transformVirtualSelector } from '../src/services/css-compiler';
import { validateCustomCss } from '../src/services/css-validator';

describe('safe CSS compiler', () => {
  it('maps Templar selectors to both reading and Live Preview elements', () => {
    const scope = '[data-templar-scope="templar-test"]';
    expect(transformVirtualSelector('.page h1', scope)).toContain(
      ':is(h1, .HyperMD-header-1, .inline-title)',
    );
    expect(transformVirtualSelector('.page-content', scope)).toBe(
      `${scope} .templar-page-content`,
    );
    expect(transformVirtualSelector('.page mark', scope)).toContain(
      ':is(mark, .cm-highlight)',
    );
    expect(transformVirtualSelector('.page h4', scope)).toContain(
      ':is(h4, .HyperMD-header-4)',
    );
  });

  it('prefixes every ordinary selector with the note scope', () => {
    const compiled = compileCustomCss(
      `.page h1, .page h2 { color: #345; }
@media (prefers-reduced-motion: reduce) { .page img { transform: none; } }`,
      '[data-templar-scope="templar-test"]',
      'test',
    );
    expect(compiled.issues.some((issue) => issue.severity === 'error')).toBe(false);
    const root = postcss.parse(compiled.css);
    root.walkRules((rule: Rule) => {
      for (const selector of rule.selectors) {
        expect(selector.startsWith('[data-templar-scope="templar-test"]')).toBe(true);
      }
    });
  });

  it('rejects viewport media queries that would reflow fixed pages', () => {
    const result = validateCustomCss(
      '@media (max-width: 600px) { .page p { font-size: 12px; } }',
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.path === 'css.@media')).toBe(true);
  });

  it('rejects viewport/container-dependent lengths and queries', () => {
    const result = validateCustomCss(
      '@container (width > 500px) { .page p { font-size: 2cqw; } } .page h1 { margin-top: 3dvh; }',
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.path === 'css.@container')).toBe(true);
    expect(result.issues.some((issue) => issue.path === 'css.font-size')).toBe(true);
    expect(result.issues.some((issue) => issue.path === 'css.margin-top')).toBe(true);
  });

  it('reserves virtual-root geometry for the fixed canvas engine', () => {
    const result = validateCustomCss(
      '.page-content { width: 50% !important; zoom: 1; } .page { font-size: 18px; }',
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.path === 'css.width')).toBe(true);
    expect(result.issues.some((issue) => issue.path === 'css.zoom')).toBe(true);
    expect(result.issues.some((issue) => issue.path === 'css.font-size')).toBe(true);
  });

  it('rejects private runtime selectors and wildcard canvas overrides', () => {
    const result = validateCustomCss(
      '.page > .templar-page-content { width: 50% !important; max-width: 50% !important; zoom: 1 !important; }',
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.path === 'css.selector')).toBe(true);
    expect(result.issues.filter((issue) => issue.message.includes('!important'))).toHaveLength(3);
  });

  it('namespaces keyframes while leaving from/to selectors alone', () => {
    const compiled = compileCustomCss(
      '@keyframes fade { from { opacity: 0; } to { opacity: 1; } } .page img { animation: fade 1s 1; }',
      '[data-templar-scope="templar-test"]',
      'test',
    );
    expect(compiled.css).toContain('@keyframes templar-test-fade');
    expect(compiled.css).toContain('animation: templar-test-fade 1s 1');
    expect(compiled.css).toContain('from');
  });

  it('rejects global selectors and remote resource loading', () => {
    const result = validateCustomCss(
      'body .page { color: red; } .page { background-image: url(https://example.com/track); }',
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.path === 'css.selector')).toBe(true);
    expect(result.issues.some((issue) => issue.message.includes('URL'))).toBe(true);
  });

  it('rejects fixed overlays and excessive stacking', () => {
    const result = validateCustomCss('.page h1 { position: fixed; z-index: 9999; }');
    expect(result.valid).toBe(false);
    expect(result.issues.filter((issue) => issue.severity === 'error')).toHaveLength(2);
  });
});
