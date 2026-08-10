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

describe('css compilation characterization', () => {
  it('every built-in template compiles without errors', () => {
    for (const template of BUILT_IN_TEMPLATES) {
      const style = templateToNoteStyle(template);
      const result = compilePageStyle(
        style,
        '[data-templar-scope="templar-characterization"]',
        'characterization',
        metrics,
      );
      expect(
        result.issues.filter((issue) => issue.severity === 'error'),
        `${template.id} produced errors: ${result.issues
          .map((issue) => issue.message)
          .join('; ')}`,
      ).toEqual([]);
      expect(result.css.length).toBeGreaterThan(0);
    }
  });

  it('compilation is deterministic for identical input', () => {
    for (const template of BUILT_IN_TEMPLATES.slice(0, 10)) {
      const style = templateToNoteStyle(template);
      const first = compilePageStyle(
        style,
        '[data-templar-scope="templar-det"]',
        'det',
        metrics,
      );
      const second = compilePageStyle(
        style,
        '[data-templar-scope="templar-det"]',
        'det',
        metrics,
      );
      expect(second.css, `${template.id} produced non-deterministic CSS`).toBe(first.css);
    }
  });

  it('every built-in template compiles with both page modes', () => {
    for (const template of BUILT_IN_TEMPLATES) {
      const pageless = templateToNoteStyle(template);
      pageless.page.mode = 'pageless';
      const pagelessResult = compilePageStyle(
        pageless,
        '[data-templar-scope="templar-modes"]',
        'modes',
        metrics,
      );
      expect(
        pagelessResult.issues.filter((issue) => issue.severity === 'error'),
      ).toEqual([]);

      const paged = templateToNoteStyle(template);
      paged.page.mode = 'paged';
      const pagedResult = compilePageStyle(
        paged,
        '[data-templar-scope="templar-modes"]',
        'modes',
        metrics,
      );
      expect(
        pagedResult.issues.filter((issue) => issue.severity === 'error'),
        `${template.id} failed in paged mode: ${pagedResult.issues
          .map((issue) => issue.message)
          .join('; ')}`,
      ).toEqual([]);
    }
  });

  it('scope and scopeId affect the compiled CSS deterministically', () => {
    // The scope attribute must always be present and distinct per note path.
    const template = BUILT_IN_TEMPLATES[0]!;
    const style = templateToNoteStyle(template);
    const scopeA = compilePageStyle(
      style,
      '[data-templar-scope="templar-a"]',
      'a',
      metrics,
    );
    const scopeB = compilePageStyle(
      style,
      '[data-templar-scope="templar-b"]',
      'b',
      metrics,
    );
    // Both must reference their own scope and not the other's.
    expect(scopeA.css).toContain('[data-templar-scope="templar-a"]');
    expect(scopeA.css).not.toContain('[data-templar-scope="templar-b"]');
    expect(scopeB.css).toContain('[data-templar-scope="templar-b"]');
    expect(scopeB.css).not.toContain('[data-templar-scope="templar-a"]');
    // Determinism: same inputs yield identical output.
    const scopeA2 = compilePageStyle(
      style,
      '[data-templar-scope="templar-a"]',
      'a',
      metrics,
    );
    expect(scopeA2.css).toBe(scopeA.css);
    // A template with keyframes must get scopeId-prefixed keyframe names.
    const animated = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    animated.css = '@keyframes templarFade { from { opacity: 0; } to { opacity: 1; } }';
    const animatedCss = compilePageStyle(
      animated,
      '[data-templar-scope="templar-a"]',
      'anim',
      metrics,
    ).css;
    expect(animatedCss).toContain('templar-anim-templarFade');
  });
});
