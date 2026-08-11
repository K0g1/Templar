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

/**
 * CSS math and unbounded-value functions. Any of these in a safety-
 * sensitive position defeats literal-value bounds.
 */
const MATH_FUNCTIONS_RE =
  /(?:calc|min|max|clamp|round|mod|rem|abs|sign|pow|sqrt|hypot|log|exp|sin|cos|tan|asin|acos|atan|atan2)\s*\(/i;
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
/**
 * Replaces CSS comments with spaces so token-boundary regexes see the same
 * tokens a CSS tokenizer would (`1000000000/**\/spin` becomes
 * `1000000000 spin`). Comments carry no numeric meaning but PostCSS retains
 * them in declaration values when both neighboring tokens are non-space.
 */
function stripCssComments(value: string): string {
  return value.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** Returns the selector branches inside a functional pseudo. */
function pseudoArgumentBranches(
  part: import('postcss-selector-parser').Node,
): Array<import('postcss-selector-parser').Node> {
  if (!('nodes' in part) || !Array.isArray(part.nodes)) {
    return [];
  }
  return part.nodes;
}

/** Returns the single argument node of a functional pseudo, if any. */
function singlePseudoArgument(
  part: import('postcss-selector-parser').Node,
): import('postcss-selector-parser').Node | null {
  const branches = pseudoArgumentBranches(part);
  if (branches.length !== 1) {
    return null;
  }
  const branch = branches[0]!;
  const children = branchChildren(branch);
  if (children.length === 1) {
    return children[0] ?? null;
  }
  return null;
}

/** Returns the leaf nodes of a selector branch (or the branch itself). */
function branchChildren(
  branch: import('postcss-selector-parser').Node,
): Array<import('postcss-selector-parser').Node> {
  if ('nodes' in branch && Array.isArray(branch.nodes)) {
    return branch.nodes;
  }
  return [branch];
}

/** Normalized pseudo-class name: escape-decoded, colon-stripped, lowercased. */
function normalizedPseudoName(node: import('postcss-selector-parser').Node): string {
  return decodeCssEscapes(node.value ?? '').replace(/^:+/, '').toLowerCase();
}

/**
 * Canonicalizes a property name for security checks: lowercases it and
 * maps Blink/WebKit aliases (-webkit-opacity, -webkit-transform,
 * -webkit-filter, -webkit-clip-path, -webkit-backdrop-filter,
 * -webkit-mask, -webkit-mask-image) to their standard properties so
 * alias spellings cannot bypass hiding-property checks.
 */
function canonicalPropertyName(raw: string): string {
  const lower = raw.toLowerCase();
  const aliases: Record<string, string> = {
    '-webkit-opacity': 'opacity',
    '-webkit-transform': 'transform',
    '-webkit-filter': 'filter',
    '-webkit-clip-path': 'clip-path',
    '-webkit-backdrop-filter': 'backdrop-filter',
    '-webkit-mask': 'mask',
    '-webkit-mask-image': 'mask-image',
  };
  return aliases[lower] ?? lower;
}



/**
 * True when a CSS value is numerically zero with any unit, using the full
 * CSS number grammar: 0, 0.0, +0, 0e0, 0px, 0.0px, 0e0px.
 */
function isZeroCssValue(value: string): boolean {
  const match = value.trim().match(
    /^[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?(?:[a-z%]+)?$/i,
  );
  if (!match) {
    return false;
  }
  return Number.parseFloat(value) === 0;
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
 * Detects selectors that would hide or disable the entire note.
 *
 * Uses the selector AST so structural pseudos are recognized on explicit or
 * implicit universal compounds after descendant/child combinators (`.page > *:nth-child(n)`,
 * `.page-content > :nth-child(n)`), not just the literal `.page *:` spelling.
 * The check is intentionally conservative: a false positive rejects a
 * template; a false negative would let a malicious template blank the user's
 * note or overlay fake UI.
 */
function selectorCanHideWholePage(rule: Rule): boolean {
  // Keyframe bodies (from/to/percentage selectors) are not note selectors;
  // the hiding-sensitive keyframe attack is gated through the animation
  // declaration checks (fill mode, paused, timeline), not here.
  if (isInsideKeyframes(rule)) {
    return false;
  }
  // FAIL-CLOSED: a hiding-sensitive declaration (display:none,
  // visibility:hidden, opacity<=0, ...) is only safe when the selector is
  // PROVABLY NARROW - every descendant compound contains a positive
  // narrowing atom (class, id, tag, or attribute) and no construct that
  // can broaden the match to the whole note. If narrowness cannot be
  // proven, the selector is treated as whole-page-capable. This is sound
  // by construction: it closes every tautology/complement bypass without
  // needing a coverage oracle. False positives (rejecting exotic selectors
  // with hiding properties) are acceptable; regular styling is unaffected.
  return !selectorIsProvablyNarrow(rule);
}

/**
 * True when every top-level selector's descendant compounds are provably
 * narrow (cannot match the entire note). A single-compound selector
 * targets the page root itself and is never narrow.
 */
function selectorIsProvablyNarrow(rule: Rule): boolean {
  if (rule.selectors.length === 0) {
    return false;
  }
  return rule.selectors.every((selector) => selectorNodeIsProvablyNarrow(selector));
}

/** True when one top-level selector node is provably narrow. */
function selectorNodeIsProvablyNarrow(selector: string): boolean {
  let ast;
  try {
    ast = selectorParser().astSync(selector);
  } catch {
    return false;
  }
  for (const node of ast.nodes) {
    if (!isPageRooted(node)) {
      // Non-page-rooted selectors are outside the note scope; they cannot
      // hide the whole note, but for the security boundary they are not
      // provably narrow either.
      return false;
    }
    const compounds = compoundSequence(node);
    // Root-only selectors (.page) target the note root itself.
    if (compounds.length <= 1) {
      return false;
    }
    for (let index = 1; index < compounds.length; index += 1) {
      if (!compoundIsProvablyNarrow(compounds[index]!)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Obsidian structural wrapper classes that contain the ENTIRE note content.
 * A compound whose only positive atoms are these still selects the whole
 * content container, so they must never count as narrowing.
 */
const STRUCTURAL_WRAPPER_CLASSES = new Set([
  'markdown-preview-sizer',
  'markdown-preview-view',
  'markdown-preview-pusher',
  'markdown-preview-section',
  'cm-sizer',
  'cm-content',
  'cm-editor',
  'cm-scroller',
  'cm-line',
  'markdown-source-view',
  'view-content',
  'workspace-leaf-content',
]);

/**
 * Properties that can blank the rendered note through geometry alone:
 * collapsing the content box (height/width/min/max 0) or clipping it
 * (overflow hidden) on a whole-page-capable selector.
 */
const GEOMETRY_HIDING_PROPERTIES = new Set([
  'height',
  'width',
  'min-height',
  'min-width',
  'max-height',
  'max-width',
  'overflow',
  'overflow-x',
  'overflow-y',
  'clip',
  'clip-path',
  'contain',
  'content-visibility',
]);

/**
 * True when a compound provably matches only a narrow subset of the note:
 * it contains at least one positive narrowing atom (class, id, tag, or
 * attribute) that is NOT a structural content wrapper, contains no
 * `:not()` (which can broaden to everything except the argument), no
 * `:has()`, no bare universal that would make it everything, and any
 * `:is()`/`:where()` branches are themselves provably narrow (a union of
 * narrow sets is narrow). Structural and state pseudos narrow the match
 * and are allowed alongside a positive atom.
 */
function compoundIsProvablyNarrow(
  compound: Array<import('postcss-selector-parser').Node>,
): boolean {
  let hasPositiveAtom = false;
  for (const part of compound) {
    if (part.type === 'class') {
      const className = decodeCssEscapes(part.toString()).replace(/^\./, '');
      if (!STRUCTURAL_WRAPPER_CLASSES.has(className)) {
        hasPositiveAtom = true;
      }
    } else if (part.type === 'id' || part.type === 'tag' || part.type === 'attribute') {
      hasPositiveAtom = true;
    } else if (part.type === 'universal') {
      // Bare universal matches everything; with a positive atom alongside
      // (.x*) it is redundant but harmless, so only reject when it is the
      // sole widening part.
      continue;
    } else if (part.type === 'pseudo') {
      const pseudoName = normalizedPseudoName(part);
      if (pseudoName === 'not' || pseudoName === 'has') {
        // :not(X) matches everything except X; :has() is complex. Neither
        // is provably narrow.
        return false;
      }
      if (pseudoName === 'is' || pseudoName === 'where') {
        const branches = pseudoArgumentBranches(part);
        if (branches.length === 0) {
          return false;
        }
        for (const branch of branches) {
          if (!branchIsProvablyNarrow(branch)) {
            return false;
          }
        }
      }
      // Structural/state pseudos (:first-child, :nth-child(2), :hover)
      // narrow the match; they are safe alongside a positive atom.
    }
  }
  return hasPositiveAtom;
}

/** True when a :is()/:where() branch (possibly complex) is provably narrow. */
function branchIsProvablyNarrow(
  branch: import('postcss-selector-parser').Node,
): boolean {
  const compounds = compoundSequence(branch);
  if (compounds.length === 0) {
    return false;
  }
  return compounds.every((compound) => compoundIsProvablyNarrow(compound));
}

/** True when a selector list node starts with .page or .page-content. */
function isPageRooted(node: import('postcss-selector-parser').Node): boolean {
  return /^\s*\.page(?:-content)?(?=$|[\s.:#[>+~])/.test(node.toString());
}

/**
 * Splits a selector list node into compounds separated by combinators,
 * discarding the combinators themselves.
 */
function compoundSequence(
  node: import('postcss-selector-parser').Node,
): Array<Array<import('postcss-selector-parser').Node>> {
  const compounds: Array<Array<import('postcss-selector-parser').Node>> = [];
  if (!('nodes' in node) || !Array.isArray(node.nodes)) {
    return compounds;
  }
  let current: Array<import('postcss-selector-parser').Node> = [];
  for (const child of node.nodes) {
    if (child.type === 'combinator' || (child.type === 'comment' && /^\s+$/.test(child.value ?? ''))) {
      if (current.length > 0) {
        compounds.push(current);
        current = [];
      }
    } else {
      current.push(child);
    }
  }
  if (current.length > 0) {
    compounds.push(current);
  }
  return compounds;
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
    // No point validating further: the template is already rejected, and
    // continuing can waste work proportional to attacker-controlled size.
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
    const property = canonicalPropertyName(decodeCssEscapes(declaration.prop));
    const value = stripCssComments(decodeCssEscapes(declaration.value).toLowerCase());
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
      // Geometry-blanking combinations: collapsing the box (height/width 0)
      // with clipping (overflow hidden) can blank the rendered note without
      // using the enumerated hiding properties. Only zero-collapse values
      // are dangerous; height: auto resets remain allowed.
      (GEOMETRY_HIDING_PROPERTIES.has(property) && isZeroCssValue(value) ||
        (property === 'overflow' || property === 'overflow-x' || property === 'overflow-y') &&
          /\b(hidden|clip)\b/.test(value))
    ) {
      issues.push({
        severity: 'error',
        path: `css.${property}`,
        message: `“${property}: ${declaration.value}” can collapse or clip the whole note.`,
        fix: 'Target a specific Markdown element without blanking the page.',
      });
    }
    if (
      declaration.parent?.type === 'rule' &&
      selectorCanHideWholePage(declaration.parent) &&
      ((property === 'display' && (value.trim() === 'none' || /var\s*\(/.test(value))) ||
        (property === 'visibility' && (value.trim() === 'hidden' || value.trim() === 'collapse' || /var\s*\(/.test(value))) ||
        (property === 'content-visibility' && (value.trim() === 'hidden' || /var\s*\(/.test(value))) ||
        (property === 'opacity' &&
          (Number.parseFloat(value) <= 0 || /var\s*\(|attr\s*\(/.test(value) || MATH_FUNCTIONS_RE.test(value))) ||
        (property === 'pointer-events' && (value.trim() === 'none' || /var\s*\(/.test(value))) ||
        (property === 'font-size' && isZeroCssValue(value)) ||
        // The `font` shorthand sets font-size (and line-height) directly,
        // and style/variant/weight/width prefixes can precede the size
        // (`font: italic 0 serif`). Rather than parse the shorthand
        // grammar, reject it outright on whole-page-capable selectors.
        (property === 'font') ||
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
    // Reject unresolved var()/attr()/math functions for hiding-sensitive
    // properties anywhere: a custom property or math function could resolve
    // to a hiding value at runtime.
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
      'font-size',
      'font',
      'animation-timeline',
    ]);
    if (hidingSensitive.has(property) && (/var\s*\(|attr\s*\(/.test(value) || MATH_FUNCTIONS_RE.test(value))) {
      issues.push({
        severity: 'error',
        path: `css.${property}`,
        message: `“${property}” uses a variable, attribute, or math value that cannot be safety-bounded.`,
        fix: 'Use a literal value for this property.',
      });
    }
    if (property.includes('animation')) {
      // Whole-page selectors with forwards/both fill mode can freeze the
      // page in a hidden keyframe end-state, and paused animations can sit
      // indefinitely inside a hiding keyframe. Keyframe bodies are exempt
      // from selector validation, so the animation declaration is the only
      // gate.
      if (
        declaration.parent?.type === 'rule' &&
        selectorCanHideWholePage(declaration.parent) &&
        ((property === 'animation-fill-mode' || property === 'animation') &&
          /\b(forwards|both)\b/.test(value) ||
          (property === 'animation-play-state' || property === 'animation') &&
            /\bpaused\b/.test(value))
      ) {
        issues.push({
          severity: 'error',
          path: `css.${property}`,
          message: 'Animations with forwards/both fill mode or paused state can freeze the whole note in a hidden keyframe state.',
          fix: 'Remove the forwards/both fill mode and paused state, or target a specific element.',
        });
      }
      // Scroll/view timelines do not obey the wall-clock duration model and
      // can run indefinitely; reject them entirely on whole-page selectors.
      // This includes named dashed-ident timelines (--t) which can reference
      // scroll-timeline-name/view-timeline-name declarations; only auto and
      // none are safe non-scroll-driven values.
      if (
        declaration.parent?.type === 'rule' &&
        selectorCanHideWholePage(declaration.parent) &&
        property === 'animation-timeline' &&
        !/^\s*(?:auto|none)\s*$/.test(value)
      ) {
        issues.push({
          severity: 'error',
          path: `css.${property}`,
          message: 'Scroll-driven animation timelines are not allowed on whole-note selectors.',
          fix: 'Use a fixed-duration animation or target a specific element.',
        });
      }
      if (/\binfinite\b/.test(value)) {
        issues.push({
          severity: 'error',
          path: `css.${property}`,
          message: 'Infinite animation is not allowed because it consumes battery and CPU while the note is open.',
          fix: 'Use a finite animation count or remove the animation.',
        });
      }
      // Bound total runtime for every comma-separated animation: duration x
      // iterations. Iteration counts must be literal numbers. Reject all
      // math functions (calc, min, max, clamp, round, mod, rem, abs, sign,
      // pow, sqrt, hypot, log, exp, trig) and var()/attr() because they can
      // represent unbounded values that regex extraction cannot bound.
      if (/var\s*\(|attr\s*\(/.test(value) || MATH_FUNCTIONS_RE.test(value)) {
        issues.push({
          severity: 'error',
          path: `css.${property}`,
          message: 'Animation values using variables or math functions cannot be safety-bounded.',
          fix: 'Use literal animation durations and iteration counts.',
        });
      }
      for (const part of splitTopLevel(value)) {
        // Durations are identified by their unit (ms|s) and may use the full
        // CSS number grammar: optional sign, leading or trailing decimal
        // point, scientific notation (.4e2s = 40s, 4e1s = 40s, +40s).
        const durations = [...part.matchAll(/([-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)(ms|s)\b/gi)];
        // Iteration count: a bare number token (no time unit, not inside a
        // function). Regex matches the full CSS number grammar with proper
        // token boundaries (next char whitespace, comma, or end-of-part).
        const bareNumbers: number[] = [];
        for (const match of part.matchAll(/(^|[\s,])([-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)(?=[\s,]|$)/gi)) {
          const parsed = Number.parseFloat(match[2] ?? '0');
          if (!Number.isNaN(parsed)) {
            bareNumbers.push(parsed);
          }
        }
        let totalSeconds = 0;
        for (const match of durations) {
          const amount = Number.parseFloat(match[1] ?? '0');
          if (Number.isNaN(amount)) {
            continue;
          }
          totalSeconds += match[2] === 'ms' ? Math.abs(amount) / 1000 : Math.abs(amount);
        }
        const iterationCount = bareNumbers.length > 0
          ? Math.max(...bareNumbers.map((value) => Math.abs(value)))
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

  // Combined animation check: after shorthand/longhand cascade, !important
  // precedence, AND cross-rule cascade, effective duration x iteration per
  // animation can exceed the runtime budget even when each declaration
  // passes independently. Conservative approach: track the maximum duration
  // and maximum iteration count anywhere in the stylesheet, then test the
  // product once. Since candidates are nonnegative, this is both O(n) and a
  // safe over-approximation of every possible cascade pairing (same-rule
  // lists, !important overrides, and overlapping selectors in separate
  // rules all reduce to some duration paired with some iteration count).
  let maxDurationSeconds = 0;
  let maxIterationCount = 1;
  root.walkDecls((declaration) => {
    const property = decodeCssEscapes(declaration.prop).toLowerCase();
    const value = stripCssComments(decodeCssEscapes(declaration.value));
    const isAnimationShorthand = property === 'animation';
    const isDuration = property === 'animation' || property === 'animation-duration';
    const isIteration = property === 'animation' || property === 'animation-iteration-count';
    if (!isDuration && !isIteration) {
      return;
    }
    if (/var\s*\(|attr\s*\(/.test(value) || MATH_FUNCTIONS_RE.test(value)) {
      return; // var()/math function case already reported at declaration level.
    }
    for (const part of splitTopLevel(value)) {
      if (isDuration) {
        let partSeconds = 0;
        for (const match of part.matchAll(/([-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)(ms|s)\b/gi)) {
          const amount = Number.parseFloat(match[1] ?? '0');
          partSeconds += Number.isNaN(amount) ? 0 : (match[2] === 'ms' ? Math.abs(amount) / 1000 : Math.abs(amount));
        }
        maxDurationSeconds = Math.max(maxDurationSeconds, partSeconds);
      }
      if (isIteration) {
        if (property === 'animation') {
          // Shorthand: the iteration count is a bare number token anywhere
          // in the part (`spin .1s 100`, `.1s 100 spin`, `100 .1s spin`).
          // Reuse the full CSS number grammar with token boundaries.
          const bareNumbers = [...part.matchAll(/(^|[\s,])([-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)(?=[\s,]|$)/gi)]
            .map((match) => Number.parseFloat(match[2] ?? '0'))
            .filter((value) => !Number.isNaN(value))
            .map((value) => Math.abs(value));
          maxIterationCount = Math.max(
            maxIterationCount,
            bareNumbers.length > 0 ? Math.max(...bareNumbers) : 1,
          );
        } else {
          // Longhand: the whole value is the iteration count.
          const match = part.match(/([-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)\s*$/);
          const parsed = match ? Number.parseFloat(match[1] ?? '1') : NaN;
          maxIterationCount = Math.max(maxIterationCount, Number.isNaN(parsed) ? 1 : Math.abs(parsed));
        }
      }
    }
  });
  if (maxDurationSeconds * maxIterationCount > MAX_ANIMATION_DURATION_SECONDS) {
    issues.push({
      severity: 'error',
      path: 'css.animation',
      message: `Animation total runtime exceeds the limit of ${String(MAX_ANIMATION_DURATION_SECONDS)}s.`,
      fix: 'Shorten the duration or reduce the iteration count.',
    });
  }

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
