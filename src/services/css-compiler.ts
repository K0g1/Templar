import postcss, { type AtRule, type Rule } from 'postcss';
import type { CompiledPageStyle, ValidationIssue } from '../types';
import { validateCustomCss } from './css-validator';

const livePreviewElements: Readonly<Record<string, string>> = {
  h1: ':is(h1, .HyperMD-header-1, .inline-title)',
  h2: ':is(h2, .HyperMD-header-2)',
  h3: ':is(h3, .HyperMD-header-3)',
  h4: ':is(h4, .HyperMD-header-4)',
  p: ':is(p, .HyperMD-paragraph)',
  ul: ':is(ul, .HyperMD-list-line)',
  ol: ':is(ol, .HyperMD-list-line)',
  li: ':is(li, .HyperMD-list-line)',
  blockquote: ':is(blockquote, .HyperMD-quote)',
  img: 'img',
  table: ':is(table, .cm-table-widget)',
  code: ':is(code, .cm-inline-code)',
  pre: ':is(pre, .HyperMD-codeblock)',
  hr: ':is(hr, .HyperMD-hr)',
  a: ':is(a, .cm-hmd-internal-link, .cm-link, .cm-url)',
  mark: ':is(mark, .cm-highlight)',
  input: 'input',
};

function isInsideKeyframes(rule: Rule): boolean {
  return rule.parent?.type === 'atrule' && /keyframes$/i.test((rule.parent as AtRule).name);
}

function expandVirtualElements(selector: string): string {
  return selector.replace(
    /(^|[\s>+~])(?:h1|h2|h3|h4|p|ul|ol|li|blockquote|img|table|code|pre|hr|a|mark|input)(?=$|[\s>+~.#:[])/g,
    (match) => {
      const prefix = /^[\s>+~]/.test(match) ? match.charAt(0) : '';
      const element = match.slice(prefix.length);
      return `${prefix}${livePreviewElements[element] ?? element}`;
    },
  );
}

export function transformVirtualSelector(selector: string, scope: string): string {
  const trimmed = selector.trim();
  let transformed: string;
  if (/^\.page-content(?=$|[\s.:#[])/.test(trimmed)) {
    transformed = trimmed.replace(
      /^\.page-content/,
      `${scope} .templar-page-content`,
    );
  } else if (/^\.page(?=$|[\s.:#[])/.test(trimmed)) {
    transformed = trimmed.replace(/^\.page/, `${scope} .templar-page`);
  } else {
    throw new Error(`Selector “${trimmed}” must start with .page or .page-content.`);
  }
  return expandVirtualElements(transformed);
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

export function compileCustomCss(css: string, scope: string, scopeId: string): CompiledPageStyle {
  const validation = validateCustomCss(css);
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
