import postcss, { type AtRule, type Rule } from 'postcss';
import { MAX_CUSTOM_CSS_BYTES } from '../constants';
import type { ValidationIssue, ValidationResult } from '../types';
import {
  analyzeSelector,
  decodeCssEscapes,
  type SelectorAnalysis,
} from './css/selector-policy';

const allowedAtRules = new Set([
  'keyframes',
  '-webkit-keyframes',
  'layer',
  'media',
  'supports',
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
const reservedRhythmProperties = new Set([
  'block-size',
  'box-sizing',
  'display',
  'font',
  'font-family',
  'font-size',
  'font-weight',
  'height',
  'line-height',
  'margin',
  'margin-block',
  'margin-block-end',
  'margin-block-start',
  'margin-bottom',
  'margin-top',
  'max-block-size',
  'max-height',
  'min-block-size',
  'min-height',
  'padding',
  'padding-block',
  'padding-block-end',
  'padding-block-start',
  'padding-bottom',
  'padding-top',
]);
const reservedRootAvailabilityProperties = new Set([
  'visibility',
  'opacity',
  'pointer-events',
  'filter',
  'backdrop-filter',
  'clip',
  'clip-path',
  'mask',
  'mask-image',
  '-webkit-mask',
  '-webkit-mask-image',
]);
const unstableLengthUnit =
  /[-+]?(?:\d+|\d*\.\d+)\s*(?:cqb|cqh|cqi|cqmax|cqmin|cqw|dvh|dvw|lvh|lvw|svh|svw|vb|vh|vi|vmax|vmin|vw)\b/i;

/**
 * PostCSS deliberately recovers from malformed strings more liberally than a
 * browser CSS tokenizer. Reject physical controls inside strings before
 * parsing so an accepted template cannot become an unscoped browser rule.
 */
function hasUnsafeStringControl(css: string): boolean {
  let quote: '"' | "'" | null = null;
  let comment = false;
  let escaped = false;
  for (let index = 0; index < css.length; index += 1) {
    const character = css[index] ?? '';
    const next = css[index + 1] ?? '';
    if (comment) {
      if (character === '*' && next === '/') {
        comment = false;
        index += 1;
      }
      continue;
    }
    if (!quote && character === '/' && next === '*') {
      comment = true;
      index += 1;
      continue;
    }
    if (quote) {
      if (character === '\n' || character === '\r' || character === '\f' || character === '\0') {
        return true;
      }
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    }
  }
  return quote !== null || comment;
}

function isInsideKeyframes(rule: Rule): boolean {
  return rule.parent?.type === 'atrule' && /keyframes$/i.test((rule.parent as AtRule).name);
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

function validateSelector(selector: string, issues: ValidationIssue[]): SelectorAnalysis[] {
  try {
    const analyses = analyzeSelector(selector);
    for (const analysis of analyses) {
      if (!analysis.startsWithVirtualRoot) {
        issues.push({
          severity: 'error',
          path: 'css.selector',
          message: `“${analysis.text}” is not scoped to .page or .page-content.`,
          fix: `Start the selector with “.page ” so it affects only this note.`,
        });
      }
      if (analysis.globalToken) {
        issues.push({
          severity: 'error',
          path: 'css.selector',
          message: `“${analysis.text}” references the global Obsidian selector “${analysis.globalToken}”.`,
          fix: 'Use the documented Templar selector vocabulary.',
        });
      }
      if (analysis.usesGlobalEscape) {
        issues.push({
          severity: 'error',
          path: 'css.selector',
          message: 'The :global() escape is not supported because it can leak outside the note.',
        });
      }
      if (analysis.usesPrivateRuntimeClass) {
        issues.push({
          severity: 'error',
          path: 'css.selector',
          message: 'Templar runtime class names are private and cannot be used in template CSS.',
          fix: 'Use only the documented .page and .page-content virtual vocabulary.',
        });
      }
    }
    return analyses;
  } catch (error) {
    issues.push({
      severity: 'error',
      path: 'css.selector',
      message: `Templar could not parse selector “${selector}”: ${errorMessage(error)}`,
    });
    return [];
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function validateCustomCss(
  css: string,
  options: { protectRhythm?: boolean } = {},
): ValidationResult {
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
  if (hasUnsafeStringControl(css)) {
    issues.push({
      severity: 'error',
      path: 'css',
      message: 'Custom CSS contains an unterminated string/comment or a physical control character inside a string.',
      fix: 'Keep CSS strings on one line and use ordinary CSS escapes for control characters.',
    });
    return { valid: false, issues };
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
    const name = decodeCssEscapes(atRule.name).toLowerCase();
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

  const ruleAnalyses = new WeakMap<Rule, SelectorAnalysis[]>();
  root.walkRules((rule) => {
    if (!isInsideKeyframes(rule)) {
      const analyses: SelectorAnalysis[] = [];
      for (const selector of rule.selectors) {
        analyses.push(...validateSelector(selector, issues));
      }
      ruleAnalyses.set(rule, analyses);
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
    const analyses = parentRule ? ruleAnalyses.get(parentRule) ?? [] : [];
    const targetsRoot = analyses.some((analysis) => analysis.targetsVirtualRoot);
    const targetsRhythm = analyses.some((analysis) => analysis.targetsRhythmElement);
    const targetsWholePage = analyses.some((analysis) => analysis.targetsWholePage);
    if (
      parentRule &&
      reservedRootGeometryProperties.has(property) &&
      targetsRoot
    ) {
      issues.push({
        severity: 'error',
        path: `css.${property}`,
        message: `“${property}” is managed by Templar on the .page or .page-content root.`,
        fix: 'Use the structured typography/layout fields, or apply this declaration to a Markdown descendant.',
      });
    }
    if (
      parentRule &&
      reservedRootAvailabilityProperties.has(property) &&
      targetsRoot
    ) {
      issues.push({
        severity: 'error',
        path: `css.${property}`,
        message: `“${property}” could make the entire .page or .page-content unavailable.`,
        fix: 'Apply this effect to a specific Markdown descendant instead of the page root.',
      });
    }
    if (
      parentRule &&
      options.protectRhythm === true &&
      reservedRhythmProperties.has(property) &&
      targetsRhythm
    ) {
      issues.push({
        severity: 'error',
        path: `css.${property}`,
        message: `“${property}” on a text rhythm element would desynchronize Reading View and the editor cursor.`,
        fix: 'Use Templar’s structured typography, heading, divider, and baseline fields for vertical geometry.',
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
    if (property === 'position' && value.trim() === 'fixed') {
      issues.push({
        severity: 'error',
        path: 'css.position',
        message: 'Fixed positioning can cover Obsidian controls and is not allowed.',
        fix: 'Use relative, absolute, or sticky positioning inside the page.',
      });
    }
    const zIndexValue = value.trim();
    const literalZIndex = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(zIndexValue)
      ? Number(zIndexValue)
      : null;
    if (
      property === 'z-index' &&
      literalZIndex !== null &&
      (literalZIndex < -1 || literalZIndex > 20)
    ) {
      issues.push({
        severity: 'error',
        path: 'css.z-index',
        message: 'z-index values must stay between -1 and 20.',
        fix: 'Use a z-index between -1 and 20.',
      });
    }
    if (
      property === 'z-index' &&
      !/^(?:auto|inherit|initial|revert|revert-layer|unset|-?(?:\d+(?:\.\d+)?|\.\d+))$/.test(zIndexValue)
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
      targetsWholePage &&
      ((property === 'display' && value.trim() === 'none') ||
        (property === 'visibility' && value.trim() === 'hidden') ||
        (property === 'content-visibility' && value.trim() === 'hidden') ||
        (property === 'opacity' && Number.parseFloat(value) === 0) ||
        (property === 'pointer-events' && value.trim() === 'none') ||
        (property === 'font-size' && /^0(?:[a-z%]+)?$/.test(value.trim())))
    ) {
      issues.push({
        severity: 'error',
        path: `css.${property}`,
        message: `“${property}: ${declaration.value}” would hide or disable the whole note.`,
        fix: 'Target a specific Markdown element without making the page inaccessible.',
      });
    }
    if (property.includes('animation') && /\binfinite\b/.test(value)) {
      issues.push({
        severity: 'warning',
        path: `css.${property}`,
        message: 'Infinite animation can consume battery while the note is open.',
        fix: 'Use a finite animation count or remove the animation.',
      });
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

  let ruleCount = 0;
  root.walkRules(() => {
    ruleCount += 1;
  });
  if (ruleCount > 250) {
    issues.push({
      severity: 'warning',
      path: 'css',
      message: `This template has ${String(ruleCount)} top-level CSS rules and may be slow to edit.`,
      fix: 'Combine repeated selectors and declarations.',
    });
  }

  return {
    valid: !issues.some((issue) => issue.severity === 'error'),
    issues,
  };
}
