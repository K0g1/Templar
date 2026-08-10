import { describe, expect, it } from 'vitest';
import { compileCustomCss, transformVirtualSelector } from '../../src/services/css-compiler';
import { BUILT_IN_TEMPLATES } from '../../src/templates/builtins';
import { templateToNoteStyle } from '../../src/templates/note-format';
import { compilePageStyle, type PageMetricSet } from '../../src/services/style-compiler';

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

describe('end-to-end CSS security pipeline', () => {
  it('malicious custom CSS is rejected end to end (empty output CSS)', () => {
    const malicious = [
      '.page { display: none; }',
      '.page-content :is(*) { opacity: 0; }',
      '.page p { background: u\\72l(https://evil.com/x.png); }',
      '@keyframes spin { to { transform: rotate(360deg); } } .page p { animation: spin 1s infinite; }',
    ].join('\n');
    const compiled = compileCustomCss(malicious, '[data-templar-scope="templar-sec"]', 'sec');
    expect(compiled.css).toBe('');
    expect(compiled.issues.some((issue) => issue.severity === 'error')).toBe(true);
  });

  it('malicious structured fields are neutralized in full page compilation', () => {
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    style.paper.color = 'u\\72l(https://evil.com/x.png)';
    style.blocks.calloutAccent = '\\75rl(https://evil.com/a.png)';
    style.typography.bodyFont = 'Georgia, url(https://evil.com/font.woff2)';
    const result = compilePageStyle(
      style,
      '[data-templar-scope="templar-sec"]',
      'sec',
      metrics,
    );
    expect(result.css).not.toContain('url(');
    expect(result.css).not.toContain('evil.com');
    // The page must still compile with safe fallbacks, not empty CSS.
    expect(result.css.length).toBeGreaterThan(100);
  });

  it('safe advanced CSS still compiles through the pipeline', () => {
    const safe = `
      .page { background: linear-gradient(180deg, #f8f6f0 0%, #fffdf7 100%); }
      .page h1 { color: #3a5a40; text-shadow: 0 1px 2px rgba(0,0,0,0.1); }
      @media (prefers-reduced-motion: reduce) { .page img { transform: none; } }
      @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
      .page blockquote { animation: fade 0.4s ease-out; }
    `;
    const compiled = compileCustomCss(safe, '[data-templar-scope="templar-safe"]', 'safe');
    expect(compiled.issues.some((issue) => issue.severity === 'error')).toBe(false);
    expect(compiled.css).toContain('[data-templar-scope="templar-safe"]');
    // Keyframes must be namespaced.
    expect(compiled.css).toContain('templar-safe-fade');
  });

  it('every built-in template compiles through the full pipeline', () => {
    for (const template of BUILT_IN_TEMPLATES) {
      const style = templateToNoteStyle(template);
      const result = compilePageStyle(
        style,
        '[data-templar-scope="templar-builtin"]',
        'builtin',
        metrics,
      );
      expect(
        result.issues.filter((issue) => issue.severity === 'error'),
        `${template.id}: ${result.issues
          .filter((issue) => issue.severity === 'error')
          .map((issue) => issue.message)
          .join('; ')}`,
      ).toEqual([]);
      expect(result.css.length).toBeGreaterThan(0);
    }
  });

  it('transformed selectors remain scoped after expansion', () => {
    const scope = '[data-templar-scope="templar-expand"]';
    const selectors = [
      '.page h1',
      '.page-content p',
      '.page ul li',
      '.page blockquote > p',
      '.page img + figcaption',
    ];
    for (const selector of selectors) {
      const transformed = transformVirtualSelector(selector, scope);
      expect(transformed.startsWith(scope)).toBe(true);
    }
  });
});
