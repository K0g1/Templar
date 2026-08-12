import postcss, { type AtRule, type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';
import { compilePageStyle, type PageMetricSet } from '../src/services/style-compiler';
import { BUILT_IN_TEMPLATES } from '../src/templates/builtins';
import { templateToNoteStyle } from '../src/templates/note-format';

function metrics(unit: number): PageMetricSet {
  const metric = (baseline: number, lineHeight: number) => ({
    ascent: baseline * 0.72,
    baseline,
    descent: baseline * 0.2,
    lineHeight,
    measuredAt: 0,
  });
  return {
    body: metric(unit * 0.72, unit),
    h1: metric(unit * 1.56, unit * 2),
    h2: metric(unit * 1.24, unit * 2),
    h3: metric(unit * 0.82, unit),
    h4: metric(unit * 0.72, unit),
    h5: metric(unit * 0.66, unit),
    h6: metric(unit * 0.6, unit),
    code: metric(unit * 0.7, unit),
  };
}

function insideKeyframes(rule: Rule): boolean {
  return rule.parent?.type === 'atrule' &&
    /keyframes$/i.test((rule.parent as AtRule).name);
}

describe('all-template render matrix', () => {
  it('compiles every built-in across all page flows without invalid or unscoped output', () => {
    const variants = [
      { mode: 'pageless', size: 'a4', width: 794, height: 1123 },
      { mode: 'paged', size: 'a4', width: 794, height: 1123 },
      { mode: 'paged', size: 'letter', width: 816, height: 1056 },
      { mode: 'paged', size: 'custom', width: 480, height: 640 },
      { mode: 'paged', size: 'custom', width: 1800, height: 2400 },
    ] as const;
    for (const template of BUILT_IN_TEMPLATES) {
      for (const [index, page] of variants.entries()) {
        const style = templateToNoteStyle(template);
        Object.assign(style.page, page);
        const scope = `[data-templar-scope="matrix-${template.id}-${String(index)}"]`;
        const result = compilePageStyle(style, scope, `matrix-${template.id}-${String(index)}`, metrics(style.baseline.unit));
        expect(result.css, `${template.name}/${page.mode}/${page.size}`).not.toMatch(
          /(?:NaN|Infinity|undefined|\[object Object\])/
        );
        const root = postcss.parse(result.css);
        root.walkRules((rule: Rule) => {
          if (insideKeyframes(rule)) return;
          for (const selector of rule.selectors) {
            expect(selector.startsWith(scope), `${template.name}: ${selector}`).toBe(true);
          }
        });
      }
    }
  }, 15_000);

  it('compiles disabled baselines independently of their stored mode', () => {
    for (const template of BUILT_IN_TEMPLATES) {
      for (const mode of ['strict', 'balanced', 'free'] as const) {
        const style = templateToNoteStyle(template);
        style.baseline.enabled = false;
        style.baseline.mode = mode;
        const result = compilePageStyle(
          style,
          `[data-templar-scope="disabled-${template.id}-${mode}"]`,
          `disabled-${template.id}-${mode}`,
          metrics(style.baseline.unit),
        );
        expect(result.css).not.toContain('.templar-grid-snap-block');
        expect(() => postcss.parse(result.css), template.name).not.toThrow();
      }
    }
  });
});
