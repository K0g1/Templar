import postcss, { type AtRule, type Rule } from 'postcss';
import selectorParser, { type Selector } from 'postcss-selector-parser';
import { MAX_CUSTOM_CSS_BYTES } from '../constants';
import type { ValidationIssue, ValidationResult } from '../types';
import { decodeCssEscapes, isKeyframesAtRuleName, normalizeAtRuleName } from '../utils/css';

const allowedAtRules = new Set([
  'keyframes',
  '-webkit-keyframes',
  'media',
  'supports',
]);

const globalTags = new Set(['html', 'body']);
const globalClasses = new Set([
  'app-container',
  'horizontal-main-container',
  'mod-root',
  'workspace',
  'workspace-leaf',
  'workspace-tabs',
  'nav-files-container',
  'modal-container',
  'setting-item',
]);
const allowedPreferenceFeatures = new Set([
  'prefers-reduced-motion',
  'prefers-color-scheme',
  'prefers-contrast',
]);
const reservedRootGeometryProperties = new Set([
  'all',
  'block-size',
  'box-sizing',
  'contain',
  'content-visibility',
  'display',
  'float',
  'font',
  'font-family',
  'font-size',
  'font-weight',
  'height',
  'inline-size',
  'inset',
  'left',
  'line-height',
  'margin',
  'margin-block',
  'margin-block-end',
  'margin-block-start',
  'margin-bottom',
  'margin-inline',
  'margin-inline-end',
  'margin-inline-start',
  'margin-left',
  'margin-right',
  'margin-top',
  'max-block-size',
  'max-height',
  'max-inline-size',
  'max-width',
  'min-block-size',
  'min-height',
  'min-inline-size',
  'min-width',
  'overflow',
  'overflow-x',
  'overflow-y',
  'padding',
  'padding-block',
  'padding-block-end',
  'padding-block-start',
  'padding-bottom',
  'padding-inline',
  'padding-inline-end',
  'padding-inline-start',
  'padding-left',
  'padding-right',
  'padding-top',
  'position',
  'right',
  'rotate',
  'scale',
  'top',
  'transform',
  'transform-origin',
  'translate',
  'width',
  'zoom',
]);
const unstableLengthUnit =
  /[-+]?(?:\d+|\d*\.\d+)\s*(?:cqb|cqh|cqi|cqmax|cqmin|cqw|dvh|dvw|lvh|lvw|svh|svw|vb|vh|vi|vmax|vmin|vw)\b/i;

/** Hard ceilings for a portable, performance-safe template. */
const MAX_RULES = 250;
const MAX_DECLARATIONS_PER_RULE = 40;
const MAX_KEYFRAME_BLOCKS = 16;
const MAX_SELECTOR_DEPTH = 6;
const MAX_ANIMATION_DURATION_SECONDS = 30;

function isInsideKeyframes(rule: Rule): boolean {
  return rule.parent?.type === 'atrule' && isKeyframesAtRuleName((rule.parent as AtRule).name);
}

/**
 * Splits a CSS value on commas at parenthesis depth 0, so commas inside
 * function arguments (cubic-bezier, rgba, var) never split animation parts.
 */
function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of value) {
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth = Math.max(0, depth - 1);
    }
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

function selectorStartsWithVirtualRoot(selector: string): boolean {
  return /^\.page(?:-content)?(?=$|[\s.:#[])/.test(selector.trim());
}

function selectorTargetsVirtualRoot(selector: string): boolean {
  return /^\.page(?:-content)?(?=$|[.:#[])/.test(selector.trim());
}

function globalSelectorToken(selector: Selector): string | null {
  let token: string | null = null;
  selector.walkTags((tag) => {
    if (!token && globalTags.has(tag.value.toLowerCase())) {
      token = tag.value.toLowerCase();
    }
  });
  selector.walkClasses((className) => {
    if (!token && globalClasses.has(className.value.toLowerCase())) {
      token = `.${className.value.toLowerCase()}`;
    }
  });
  selector.walkPseudos((pseudo) => {
    if (!token && decodeCssEscapes(pseudo.value).toLowerCase() === ':root') {
      token = ':root';
    }
  });
  return token;
}

function isSafePreferenceMediaQuery(params: string): boolean {
  const decoded = decodeCssEscapes(params).toLowerCase().trim();
  if (!decoded || decoded.includes(',')) {
    return false;
  }
  const features = [...decoded.matchAll(/\(\s*([a-z-]+)\s*(?::[^()]*)?\)/g)];
  if (features.length === 0) {
    return false;
  }
  if (!features.every((match) => allowedPreferenceFeatures.has(match[1] ?? ''))) {
    return false;
  }
  const remainder = decoded
    .replace(/\(\s*[a-z-]+\s*(?::[^()]*)?\)/g, '')
    .replace(/\b(?:and|or|not|only)\b/g, '')
    .replace(/\s+/g, '');
  return remainder.length === 0;
}

/**
 * Detects selectors that would hide or disable the entire note, including
 * universal selectors wrapped in :is()/:where()/:not() and combinator
 * variants (`.page *`, `.page > *`, `.page-content :is(*)`).
 *
 * The check operates on the decoded selector string (escapes resolved) and
 * treats any selector that can match every element inside the page root as
 * whole-page capable. It is intentionally conservative: a false positive
 * rejects a template; a false negative would let a malicious template blank
 * the user's note or overlay fake UI.
 */
function selectorCanHideWholePage(rule: Rule): boolean {
  return rule.selectors.some((selector) => {
    const decoded = decodeCssEscapes(selector).toLowerCase();
    const trimmed = decoded.trim();
    // Direct root or root + universal child with any combinator.
    if (/^\.page(?:-content)?(?:\s*[>+~]?\s*\*)?$/.test(trimmed)) {
      return true;
    }
    // Universal wrapped in a forgiving selector list: :is(*), :where(*),
    // :not(*) — including nested and spaced forms.
    const universalWrapped = /:\s*(?:is|where|not)\s*\(\s*(?:\*|\*\s*\)|.*\*)/.test(trimmed);
    if (universalWrapped && /^\.page(?:-content)?(?:\s|[:.#[>+~])/.test(trimmed)) {
      return true;
    }
    // A bare :is(:where(*)) or :not(*) that can degrade to universal.
    if (/^\.page(?:-content)?\s*:\s*(?:is|where|not)\s*\(\s*:?\s*(?:is|where|not)?\s*\(\s*\*/.test(trimmed)) {
      return true;
    }
    // Universal with a structural pseudo that matches every element:
    // `.page *:nth-child(n)`, `.page *:first-child`, `.page *:last-child`.
    if (/^\.page(?:-content)?\s*\*\s*:(?:nth-child|nth-of-type|first-child|last-child|only-child)\s*\(?\s*(?:n|[12n])?\s*\)?/.test(trimmed)) {
      return true;
    }
    return false;
  });
}

function validateSelector(selector: string, issues: ValidationIssue[]): void {
  try {
    const ast = selectorParser().astSync(selector);
    for (const node of ast.nodes) {
      const text = node.toString().trim();
      if (!selectorStartsWithVirtualRoot(text)) {
        issues.push({
          severity: 'error',
          path: 'css.selector',
          message: `“${text}” is not scoped to .page or .page-content.`,
          fix: `Start the selector with “.page ” so it affects only this note.`,
        });
      }
      const lower = decodeCssEscapes(text).toLowerCase();
      const token = globalSelectorToken(node);
      if (token) {
        issues.push({
          severity: 'error',
          path: 'css.selector',
          message: `“${text}” references the global Obsidian selector “${token}”.`,
          fix: 'Use the documented Templar selector vocabulary.',
        });
      }
      if (lower.includes(':global(')) {
        issues.push({
          severity: 'error',
          path: 'css.selector',
          message: 'The :global() escape is not supported because it can leak outside the note.',
        });
      }
      if (lower.includes(':has(')) {
        issues.push({
          severity: 'error',
          path: 'css.selector',
          message: 'The :has() selector is not allowed because it is expensive and can escape the page.',
          fix: 'Use class or descendant selectors instead.',
        });
      }
      if (lower.includes('.templar-')) {
        issues.push({
          severity: 'error',
          path: 'css.selector',
          message: 'Templar runtime class names are private and cannot be used in template CSS.',
          fix: 'Use only the documented .page and .page-content virtual vocabulary.',
        });
      }
    }
  } catch (error) {
    issues.push({
      severity: 'error',
      path: 'css.selector',
      message: `Templar could not parse selector “${selector}”: ${errorMessage(error)}`,
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function validateCustomCss(css: string): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (!css.trim()) {
    return { valid: true, issues };
  }
  if (new Blob([css]).size > MAX_CUSTOM_CSS_BYTES) {
    issues.push({
      severity: 'error',
      path: 'css',
      message: 'Custom CSS exceeds the 50 KB safety and portability limit.',
      fix: 'Remove generated repetition and embedded assets.',
    });
  }

  let root;
  try {
    root = postcss.parse(css, { from: undefined, map: false });
  } catch (error) {
    issues.push({
      severity: 'error',
      path: 'css',
      message: `The CSS is not valid: ${errorMessage(error)}`,
    });
    return { valid: false, issues };
  }

  root.walkAtRules((atRule) => {
    const name = normalizeAtRuleName(atRule.name);
    if (!allowedAtRules.has(name)) {
      issues.push({
        severity: 'error',
        path: `css.@${name}`,
        message: `@${name || 'unknown'} is not allowed in a portable Templar template.`,
        fix: 'Use scoped rules, keyframes, layers, feature queries, or preference media queries instead.',
      });
    }
    if (name === 'media' && !isSafePreferenceMediaQuery(atRule.params)) {
      issues.push({
        severity: 'error',
        path: 'css.@media',
        message: 'Viewport media queries can reflow a fixed page when the window is resized.',
        fix: 'Design from the fixed page width. Only prefers-reduced-motion, prefers-color-scheme, and prefers-contrast media queries are portable.',
      });
    }
  });

  root.walkRules((rule) => {
    if (!isInsideKeyframes(rule)) {
      for (const selector of rule.selectors) {
        validateSelector(selector, issues);
      }
    }
  });

  root.walkDecls((declaration) => {
    const property = decodeCssEscapes(declaration.prop).toLowerCase();
    const value = decodeCssEscapes(declaration.value).toLowerCase();
    if (declaration.important) {
      issues.push({
        severity: 'error',
        path: `css.${property}`,
        message: '!important is reserved for Templar’s fixed-canvas safety rules.',
        fix: 'Remove !important; scoped template selectors already outrank ordinary theme rules.',
      });
    }
    if (unstableLengthUnit.test(value) || /\benv\s*\(/i.test(value)) {
      issues.push({
        severity: 'error',
        path: `css.${property}`,
        message: `“${property}” uses a viewport, container, or environment-dependent length.`,
        fix: 'Use fixed page-relative units such as px, em, rem, or percent so resizing cannot reflow a paged note.',
      });
    }
    const parentRule = declaration.parent?.type === 'rule'
      ? declaration.parent
      : null;
    if (
      parentRule &&
      reservedRootGeometryProperties.has(property) &&
      parentRule.selectors.some((selector) => selectorTargetsVirtualRoot(selector))
    ) {
      issues.push({
        severity: 'error',
        path: `css.${property}`,
        message: `“${property}” is managed by Templar on the .page or .page-content root.`,
        fix: 'Use the structured typography/layout fields, or apply this declaration to a Markdown descendant.',
      });
    }
    if (
      /(?:^|[^a-z-])(?:url|src|image|image-set|-webkit-image-set)\s*\(/i.test(value) ||
      /(?:https?|data|blob|file|app):|\/\//i.test(value)
    ) {
      issues.push({
        severity: 'error',
        path: `css.${property}`,
        message: `“${property}” tries to load an external or embedded URL.`,
        fix: 'Templar CSS must be self-contained; use CSS colors and gradients.',
      });
    }
    if (property === 'position') {
      // var()/attr()/calc() can resolve to `fixed` at runtime; only literal
      // safe position keywords are acceptable.
      if (/var\s*\(|attr\s*\(|calc\s*\(/.test(value)) {
        issues.push({
          severity: 'error',
          path: 'css.position',
          message: 'Calculated or variable position values cannot be safety-bounded.',
          fix: 'Use a literal position keyword (relative, absolute, or sticky).',
        });
      } else if (value.trim() === 'fixed') {
        issues.push({
          severity: 'error',
          path: 'css.position',
          message: 'Fixed positioning can cover Obsidian controls and is not allowed.',
          fix: 'Use relative, absolute, or sticky positioning inside the page.',
        });
      }
    }
    if (property === 'z-index' && Number.parseFloat(value) > 20) {
      issues.push({
        severity: 'error',
        path: 'css.z-index',
        message: 'z-index values above 20 can escape the page’s visual layer.',
        fix: 'Use a z-index between -1 and 20.',
      });
    }
    if (
      property === 'z-index' &&
      !/^(?:auto|inherit|initial|revert|revert-layer|unset|-?\d+(?:\.\d+)?)$/.test(value.trim())
    ) {
      issues.push({
        severity: 'error',
        path: 'css.z-index',
        message: 'Calculated or variable z-index values cannot be safety-bounded.',
        fix: 'Use auto or a literal z-index between -1 and 20.',
      });
    }
    if (
      declaration.parent?.type === 'rule' &&
      selectorCanHideWholePage(declaration.parent) &&
      ((property === 'display' && (value.trim() === 'none' || /var\s*\(/.test(value))) ||
        (property === 'visibility' && (value.trim() === 'hidden' || /var\s*\(/.test(value))) ||
        (property === 'content-visibility' && (value.trim() === 'hidden' || /var\s*\(/.test(value))) ||
        (property === 'opacity' &&
          (Number.parseFloat(value) === 0 || /var\s*\(|calc\s*\(/.test(value))) ||
        (property === 'pointer-events' && (value.trim() === 'none' || /var\s*\(/.test(value))) ||
        (property === 'font-size' && /^0(?:[a-z%]+)?$/.test(value.trim())) ||
        // Transform/filter/clip/mask can visually erase the note through
        // many spellings (scale(0), scaleX(0), opacity(0%), circle(0),
        // inset(50%), translate offscreen...). On a whole-page-capable
        // selector, reject the property outright rather than enumerating
        // every hiding form.
        (property === 'transform' ||
          property === 'translate' ||
          property === 'scale' ||
          property === 'rotate' ||
          property === 'filter' ||
          property === 'clip-path' ||
          property === 'mask' ||
          property === 'mask-image' ||
          property === '-webkit-mask' ||
          property === '-webkit-mask-image' ||
          property === 'backdrop-filter'))
    ) {
      issues.push({
        severity: 'error',
        path: `css.${property}`,
        message: `“${property}: ${declaration.value}” would hide or disable the whole note.`,
        fix: 'Target a specific Markdown element without making the page inaccessible.',
      });
    }
    // Reject unresolved var()/attr()/calc() for hiding-sensitive properties
    // anywhere: a custom property could resolve to a hiding value at runtime.
    const hidingSensitive = new Set([
      'display',
      'visibility',
      'opacity',
      'pointer-events',
      'content-visibility',
      'transform',
      'filter',
      'clip-path',
      'mask',
      'position',
      'z-index',
    ]);
    if (hidingSensitive.has(property) && /var\s*\(|attr\s*\(/.test(value)) {
      issues.push({
        severity: 'error',
        path: `css.${property}`,
        message: `“${property}” uses a variable or attribute value that cannot be safety-bounded.`,
        fix: 'Use a literal value for this property.',
      });
    }
    if (property.includes('animation')) {
      if (/\binfinite\b/.test(value)) {
        issues.push({
          severity: 'error',
          path: `css.${property}`,
          message: 'Infinite animation is not allowed because it consumes battery and CPU while the note is open.',
          fix: 'Use a finite animation count or remove the animation.',
        });
      }
      // Bound total runtime for every comma-separated animation: duration x
      // iterations. Iteration counts must be literal numbers (var() rejected).
      if (/var\s*\(|attr\s*\(/.test(value)) {
        issues.push({
          severity: 'error',
          path: `css.${property}`,
          message: 'Animation values using variables cannot be safety-bounded.',
          fix: 'Use literal animation durations and iteration counts.',
        });
      }
      for (const part of splitTopLevel(value)) {
        // Durations are identified by their unit (ms|s), NOT by numeric
        // comparison, so `spin 6s 6 linear` keeps 6 as the iteration count.
        const durations = [...part.matchAll(/(\d+(?:\.\d+)?)(ms|s)\b/g)];
        // Iteration count: a bare number token (not carrying a time unit and
        // not part of a function's parameters). The regex only matches
        // numbers whose next char is whitespace, a comma, or end-of-part,
        // so unit-carrying durations never appear here.
        const bareNumbers: number[] = [];
        for (const match of part.matchAll(/(^|[\s,])(\d+(?:\.\d+)?)(?=[\s,]|$)/g)) {
          bareNumbers.push(Number.parseFloat(match[2] ?? '0'));
        }
        let totalSeconds = 0;
        for (const match of durations) {
          const amount = Number.parseFloat(match[1] ?? '0');
          totalSeconds += match[2] === 'ms' ? amount / 1000 : amount;
        }
        const iterationCount = bareNumbers.length > 0
          ? Math.max(...bareNumbers)
          : 1;
        if (iterationCount > 1000) {
          issues.push({
            severity: 'error',
            path: `css.${property}`,
            message: `Animation iteration count ${String(iterationCount)} exceeds the limit of 1000.`,
            fix: 'Reduce the iteration count or use a small finite count.',
          });
        }
        if (totalSeconds * iterationCount > MAX_ANIMATION_DURATION_SECONDS) {
          issues.push({
            severity: 'error',
            path: `css.${property}`,
            message: `Animation total runtime (${String(Math.round(totalSeconds * iterationCount))}s) exceeds the limit of ${String(MAX_ANIMATION_DURATION_SECONDS)}s.`,
            fix: 'Shorten the duration or reduce the iteration count.',
          });
        }
      }
    }
    if (property === 'backdrop-filter') {
      issues.push({
        severity: 'warning',
        path: 'css.backdrop-filter',
        message: 'Backdrop filters can make scrolling expensive on mobile devices.',
      });
    }
    if (property === 'behavior' || property === '-moz-binding') {
      issues.push({
        severity: 'error',
        path: `css.${property}`,
        message: `The legacy “${property}” property is not allowed.`,
      });
    }
  });

  // Combined animation longhand check: animation-duration x
  // animation-iteration-count in the same rule can exceed the runtime budget
  // even when each declaration passes independently. Lists pair by CSS list
  // repetition semantics (1st with 1st, 2nd with 2nd, short list repeats).
  root.walkRules((rule) => {
    let durations: number[] = [];
    let iterations: number[] = [];
    let unsafeVar = false;
    rule.walkDecls((declaration) => {
      const property = decodeCssEscapes(declaration.prop).toLowerCase();
      const value = decodeCssEscapes(declaration.value);
      if (property === 'animation-duration' || property === 'animation') {
        for (const part of splitTopLevel(value)) {
          let partSeconds = 0;
          for (const match of part.matchAll(/(\d+(?:\.\d+)?)(ms|s)\b/g)) {
            const amount = Number.parseFloat(match[1] ?? '0');
            partSeconds += match[2] === 'ms' ? amount / 1000 : amount;
          }
          durations.push(partSeconds);
        }
      }
      if (property === 'animation-iteration-count') {
        for (const part of splitTopLevel(value)) {
          const match = part.match(/(\d+(?:\.\d+)?)\s*$/);
          iterations.push(match ? Number.parseFloat(match[1] ?? '1') : 1);
        }
      }
      if (/var\s*\(|attr\s*\(/.test(value)) {
        unsafeVar = true;
      }
    });
    if (unsafeVar) {
      return; // var() case already reported by the declaration-level check.
    }
    if (durations.length > 0 && iterations.length > 0) {
      const count = Math.max(durations.length, iterations.length);
      for (let index = 0; index < count; index += 1) {
        const duration = durations[index % durations.length] ?? 0;
        const iteration = iterations[index % iterations.length] ?? 1;
        if (duration * iteration > MAX_ANIMATION_DURATION_SECONDS) {
          issues.push({
            severity: 'error',
            path: 'css.animation',
            message: `Animation total runtime (${String(Math.round(duration * iteration))}s) exceeds the limit of ${String(MAX_ANIMATION_DURATION_SECONDS)}s.`,
            fix: 'Shorten the duration or reduce the iteration count.',
          });
          break;
        }
      }
    }
  });

  let ruleCount = 0;
  root.walkRules((rule) => {
    ruleCount += 1;
    if (!isInsideKeyframes(rule)) {
      const depth = selectorDepth(rule.selectors);
      if (depth > MAX_SELECTOR_DEPTH) {
        issues.push({
          severity: 'error',
          path: 'css.selector',
          message: `Selector nesting depth ${String(depth)} exceeds the limit of ${String(MAX_SELECTOR_DEPTH)}.`,
          fix: 'Flatten descendant selectors to reduce matching cost.',
        });
      }
    }
  });
  if (ruleCount > MAX_RULES) {
    issues.push({
      severity: 'error',
      path: 'css',
      message: `This template has ${String(ruleCount)} CSS rules, exceeding the limit of ${String(MAX_RULES)}.`,
      fix: 'Combine repeated selectors and declarations.',
    });
  } else if (ruleCount > MAX_RULES * 0.8) {
    issues.push({
      severity: 'warning',
      path: 'css',
      message: `This template has ${String(ruleCount)} CSS rules and is approaching the ${String(MAX_RULES)} rule limit.`,
      fix: 'Combine repeated selectors and declarations.',
    });
  }

  let keyframeBlockCount = 0;
  root.walkAtRules((atRule) => {
    if (isKeyframesAtRuleName(atRule.name)) {
      keyframeBlockCount += 1;
    }
  });
  if (keyframeBlockCount > MAX_KEYFRAME_BLOCKS) {
    issues.push({
      severity: 'error',
      path: 'css',
      message: `This template defines ${String(keyframeBlockCount)} keyframe blocks, exceeding the limit of ${String(MAX_KEYFRAME_BLOCKS)}.`,
      fix: 'Reuse one keyframe block instead of many near-identical ones.',
    });
  }

  root.walkRules((rule) => {
    let declarations = 0;
    rule.walkDecls(() => {
      declarations += 1;
    });
    if (declarations > MAX_DECLARATIONS_PER_RULE) {
      issues.push({
        severity: 'error',
        path: 'css',
        message: `A rule with ${String(declarations)} declarations exceeds the limit of ${String(MAX_DECLARATIONS_PER_RULE)}.`,
        fix: 'Split or simplify the rule.',
      });
    }
  });

  return {
    valid: !issues.some((issue) => issue.severity === 'error'),
    issues,
  };
}

/**
 * Computes the maximum compound selector depth across a rule's selectors.
 * Uses the selector AST so nested functional pseudos (:is/:where/:not) are
 * counted recursively instead of being skipped by a string scan.
 */
function selectorDepth(selectors: string[]): number {
  let maxDepth = 0;
  for (const selector of selectors) {
    let ast;
    try {
      ast = selectorParser().astSync(selector);
    } catch {
      // Unparseable selectors are already reported as errors elsewhere;
      // fall back to a conservative string count.
      maxDepth = Math.max(maxDepth, 8);
      continue;
    }
    for (const node of ast.nodes) {
      maxDepth = Math.max(maxDepth, selectorNodeDepth(node));
    }
  }
  return maxDepth;
}

function selectorNodeDepth(node: import('postcss-selector-parser').Node): number {
  let depth = 0;
  if (node.type === 'selector' && 'nodes' in node && Array.isArray(node.nodes)) {
    // Count compounds separated by combinators inside this selector list.
    let compounds = 1;
    for (const child of node.nodes) {
      depth = Math.max(depth, selectorNodeDepth(child));
      if (child.type === 'combinator' || (child.type === 'comment' && /^\s+$/.test(child.value ?? ''))) {
        compounds += 1;
      }
    }
    return depth + compounds;
  }
  if ('nodes' in node && Array.isArray(node.nodes)) {
    for (const child of node.nodes) {
      depth = Math.max(depth, selectorNodeDepth(child));
    }
  }
  // A functional pseudo (:is(...)) introduces a new compound context.
  if (node.type === 'pseudo' && 'nodes' in node && Array.isArray(node.nodes)) {
    return depth + 1;
  }
  return depth;
}
