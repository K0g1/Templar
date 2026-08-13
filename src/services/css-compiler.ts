import postcss, { type AtRule, type Rule } from 'postcss';
import type { CompiledPageStyle, ValidationIssue } from '../types';
import { validateCustomCss } from './css-validator';
import { transformVirtualSelectorWithAst } from './css/selector-transform';

function isInsideKeyframes(rule: Rule): boolean {
  return rule.parent?.type === 'atrule' && /keyframes$/i.test((rule.parent as AtRule).name);
}

export function transformVirtualSelector(selector: string, scope: string): string {
  return transformVirtualSelectorWithAst(selector, scope);
}

function scopeKeyframes(root: ReturnType<typeof postcss.parse>, scopeId: string): void {
  const names = new Map<string, string>();
  root.walkAtRules((atRule) => {
    if (/keyframes$/i.test(atRule.name)) {
      const original = atRule.params.trim();
      const scoped = `templar-${scopeId}-${original}`;
      names.set(original, scoped);
      atRule.params = scoped;
    }
  });
  if (names.size === 0) {
    return;
  }
  root.walkDecls((declaration) => {
    if (!declaration.prop.toLowerCase().startsWith('animation')) {
      return;
    }
    for (const [original, scoped] of names) {
      declaration.value = declaration.value.replace(
        new RegExp(`(^|[\\s,])${escapeRegExp(original)}(?=$|[\\s,])`, 'g'),
        `$1${scoped}`,
      );
    }
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function compileCustomCss(
  css: string,
  scope: string,
  scopeId: string,
  protectRhythm = false,
): CompiledPageStyle {
  const validation = validateCustomCss(css, { protectRhythm });
  if (!validation.valid || !css.trim()) {
    return { css: '', issues: validation.issues };
  }

  const issues: ValidationIssue[] = [...validation.issues];
  try {
    const root = postcss.parse(css, { from: undefined, map: false });
    scopeKeyframes(root, scopeId);
    root.walkRules((rule) => {
      if (!isInsideKeyframes(rule)) {
        rule.selectors = rule.selectors.map((selector) =>
          transformVirtualSelector(selector, scope),
        );
      }
    });
    return { css: root.toString(), issues };
  } catch (error) {
    issues.push({
      severity: 'error',
      path: 'css',
      message: error instanceof Error ? error.message : String(error),
    });
    return { css: '', issues };
  }
}
