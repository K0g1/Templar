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
    expect(transformVirtualSelector('.page h5', scope)).toContain(
      ':is(h5, .HyperMD-header-5)',
    );
    expect(transformVirtualSelector('.page h6', scope)).toContain(
      ':is(h6, .HyperMD-header-6)',
    );
    expect(transformVirtualSelector('.page h1, .page h6', scope)).toContain(
      ':is(h6, .HyperMD-header-6)',
    );
    expect(transformVirtualSelector('.page :is(h1, p)', scope)).toContain(
      ':is(:is(h1, .HyperMD-header-1, .inline-title), :is(p, .HyperMD-paragraph))',
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

  it('rejects browser-differential string and comment escapes', () => {
    for (const css of [
      '.page { --escape: "\n;} body { display: none }/*"; }',
      '.page { --escape: "unterminated; }',
      '.page { color: red; /* unterminated',
    ]) {
      const result = validateCustomCss(css);
      expect(result.valid, css).toBe(false);
      expect(compileCustomCss(css, '[data-templar-scope="safe"]', 'safe').css).toBe('');
    }
  });

  it('protects gridded text geometry while allowing free-layout customization', () => {
    const css = '.page p { line-height: 11px; margin-top: 7px; }';
    expect(validateCustomCss(css).valid).toBe(true);
    const protectedResult = validateCustomCss(css, { protectRhythm: true });
    expect(protectedResult.valid).toBe(false);
    expect(protectedResult.issues.some((issue) => issue.path === 'css.line-height')).toBe(true);
  });

  it('uses decoded selector semantics for escaped rhythm elements and root subjects', () => {
    const escapedRhythm = validateCustomCss(String.raw`.page h\31  { margin-top: 13px; }`, {
      protectRhythm: true,
    });
    expect(escapedRhythm.valid).toBe(false);
    expect(escapedRhythm.issues.some((issue) => issue.path === 'css.margin-top')).toBe(true);
    expect(transformVirtualSelector(String.raw`.page h\31`, '[data-templar-scope="escaped"]'))
      .toContain(':is(h1, .HyperMD-header-1, .inline-title)');

    for (const css of [
      '.page:not(.class-that-never-exists) { opacity: 0; }',
      '.page:is(.page) { pointer-events: none; }',
      '.page[data-x] { filter: opacity(0); }',
    ]) {
      const result = validateCustomCss(css);
      expect(result.valid, css).toBe(false);
      expect(result.issues.some((issue) => issue.path.startsWith('css.'))).toBe(true);
    }
  });

  it('enforces the inclusive literal z-index interval', () => {
    expect(validateCustomCss('.page h1 { z-index: -2; }').valid).toBe(false);
    expect(validateCustomCss('.page h1 { z-index: -999; }').valid).toBe(false);
    expect(validateCustomCss('.page h1 { z-index: -1; }').valid).toBe(true);
    expect(validateCustomCss('.page h1 { z-index: 20; }').valid).toBe(true);
    expect(validateCustomCss('.page h1 { z-index: 21; }').valid).toBe(false);
    expect(validateCustomCss('.page h1 { z-index: calc(1 + 1); }').valid).toBe(false);
    expect(validateCustomCss('.page h1 { z-index: var(--layer); }').valid).toBe(false);
  });

  it('blocks availability-affecting declarations on all descendant coverage', () => {
    for (const css of [
      '.page * { filter: opacity(0); }',
      '.page > * { clip-path: inset(100%); }',
      '.page * { opacity: calc(0); }',
      '.page :is(*) { pointer-events: none; }',
      '.page :where(*) { visibility: hidden; }',
      '.page * { mask-image: linear-gradient(transparent, transparent); }',
      '.page * { transform: scale(0); }',
      '.page * { scale: 0; }',
      '.page * { zoom: 0; }',
      String.raw`.\70 age :is(*) { opacity: 0; }`,
      '.page > :where(*) { filter: blur(100px); }',
    ]) {
      const result = validateCustomCss(css);
      expect(result.valid, css).toBe(false);
      expect(result.issues.some((issue) => issue.path.startsWith('css.')), css).toBe(true);
    }
  });

  it('allows availability properties on positively narrowed descendants', () => {
    for (const css of [
      '.page img { filter: grayscale(1); }',
      '.page .callout { opacity: 0.8; }',
      '.page p:hover { transform: translateX(1px); }',
      '.page blockquote { overflow: hidden; }',
    ]) {
      expect(validateCustomCss(css).valid, css).toBe(true);
    }
  });

  it('treats negative-only and broad functional subjects as potentially all descendants', () => {
    for (const css of [
      '.page *:not(img) { opacity: 0.9; }',
      '.page :not(.callout) { filter: blur(1px); }',
      '.page :is(*, p) { pointer-events: none; }',
      '.page :where(:not(.x), p) { visibility: hidden; }',
      '.page *:hover { opacity: 0.9; }',
    ]) {
      expect(validateCustomCss(css).valid, css).toBe(false);
    }
  });

  it('rejects zero geometry combined with broad clipping', () => {
    for (const css of [
      '.page * { height: 0px; overflow: hidden; }',
      '.page :where(*) { line-height: 0.0; overflow-y: clip; }',
    ]) {
      expect(validateCustomCss(css).valid, css).toBe(false);
    }
  });
});
