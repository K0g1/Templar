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
  return rule.selectors.some((selector) => {
    let ast;
    try {
      ast = selectorParser().astSync(selector);
    } catch {
      return false;
    }
    const structuralPseudos = new Set([
      'nth-child',
      'nth-of-type',
      'first-child',
      'last-child',
      'only-child',
      'nth-last-child',
      'nth-last-of-type',
    ]);
    const forgivingPseudos = new Set(['is', 'where']);
    for (const node of ast.nodes) {
      if (!isPageRooted(node)) {
        continue;
      }
      const compounds = compoundSequence(node);
      // A single-compound selector directly targets the page root itself:
      // `.page`, `.page:is(*)`, `.page:nth-child(n)`,
      // `.page-content:where(*)`. Hiding declarations on the root hide the
      // whole note, so classify these as root-capable regardless of pseudo
      // suffixes. Multi-compound selectors (.page p) apply to descendants,
      // not the root, and are handled by the universal-compound loop below.
      if (compounds.length === 1) {
        return true;
      }
      for (let index = 1; index < compounds.length; index += 1) {
        const compound = compounds[index]!;
        if (compoundMatchesEverything(compound, structuralPseudos, forgivingPseudos)) {
          return true;
        }
      }
    }
    return false;
  });
}

/**
 * A compound matches every element when it contains only universal
 * selectors, comments, structural pseudos (`*:nth-child(n)`,
 * `*:first-child`), or a forgiving list pseudo that CAN match a universal
 * (`.page :is(*)`, `.page :is(*, p)`, `.page :where(*):where(*)`).
 *
 * `:is()` and `:where()` are alternatives: a single universal branch makes
 * the whole pseudo match everything, so capability is `some(branch)`.
 * `:not()` is handled separately and is never universal-capable on its own
 * (`:not(*)` matches nothing).
 */
function compoundMatchesEverything(
  compound: Array<import('postcss-selector-parser').Node>,
  structuralPseudos: Set<string>,
  forgivingPseudos: Set<string>,
): boolean {
  if (compound.length === 0) {
    return false;
  }
  let sawMeaningful = false;
  for (const part of compound) {
    if (part.type === 'comment') {
      continue;
    }
    if (part.type === 'universal') {
      sawMeaningful = true;
      continue;
    }
    if (part.type === 'pseudo') {
      // postcss-selector-parser includes the leading colon in pseudo.value
      // (e.g. ":nth-child"), so strip it before comparing against the sets.
      const pseudoName = part.value.replace(/^:/, '').toLowerCase();
      if (structuralPseudos.has(pseudoName)) {
        sawMeaningful = true;
        continue;
      }
      // `:is(...)` / `:where(...)`: any single branch that matches
      // everything makes the pseudo match everything, and complementary
      // branches (`:is(.x, :not(.x))`) jointly cover every element.
      if (forgivingPseudos.has(pseudoName)) {
        if (pseudoMatchesEverything(part, structuralPseudos, forgivingPseudos) ||
            forgivingListCoversEverything(part)) {
          sawMeaningful = true;
          continue;
        }
        return false;
      }
      // `:not(...)`: logical negation over a selector list. `:not(L)`
      // matches everything when EVERY selector in L matches nothing
      // (e.g. `:not(:not(*), :not(*))` - each branch matches nothing, so
      // the negation matches everything). Handled recursively, not as a
      // syntactic double-negation special case.
      if (pseudoName === 'not') {
        if (notPseudoMatchesEverything(part, structuralPseudos, forgivingPseudos)) {
          sawMeaningful = true;
          continue;
        }
        return false;
      }
    }
    // Any other selector part (class, attribute, element, non-universal
    // pseudo) narrows the match: not whole-page capable.
    return false;
  }
  return sawMeaningful;
}

/**
 * True when a functional `:is()`/`:where()` pseudo can match every element:
 * at least one of its selector branches is universal-capable, evaluated
 * recursively so nested `:is(:where(*))` is recognized.
 */
function pseudoMatchesEverything(
  part: import('postcss-selector-parser').Node,
  structuralPseudos: Set<string>,
  forgivingPseudos: Set<string>,
): boolean {
  if (!('nodes' in part) || !Array.isArray(part.nodes) || part.nodes.length === 0) {
    return false;
  }
  return part.nodes.some((inner) => {
    if (inner.type === 'selector') {
      if (!('nodes' in inner) || !Array.isArray(inner.nodes)) {
        return false;
      }
      // A branch matches everything when EVERY compound is universal-
      // capable. Combinators are allowed because `* > *` (every element
      // has a parent) matches the full descendant set; a class/attribute/
      // element anywhere in the branch narrows it.
      const branchCompounds = compoundSequence(inner);
      return (
        branchCompounds.length > 0 &&
        branchCompounds.every((compound) =>
          compoundMatchesEverything(compound, structuralPseudos, forgivingPseudos),
        )
      );
    }
    if (inner.type === 'pseudo') {
      // Handle nested functional pseudos like :where(*) inside :is().
      const pseudoName = inner.value.replace(/^:/, '').toLowerCase();
      if (forgivingPseudos.has(pseudoName)) {
        return pseudoMatchesEverything(inner, structuralPseudos, forgivingPseudos);
      }
      if (pseudoName === 'not') {
        return notPseudoMatchesEverything(inner, structuralPseudos, forgivingPseudos);
      }
      if (structuralPseudos.has(pseudoName)) {
        return true;
      }
      return false;
    }
    return inner.type === 'universal' || inner.type === 'comment';
  });
}

/**
 * True when a `:not(...)` pseudo matches every element: every selector in
 * its argument list must match nothing (`:not(:not(*))` because the branch
 * `:not(*)` matches nothing, and lists like `:not(:not(*), :not(*))`).
 * Modeled recursively so complex and list arguments work.
 */
function notPseudoMatchesEverything(
  part: import('postcss-selector-parser').Node,
  structuralPseudos: Set<string>,
  forgivingPseudos: Set<string>,
): boolean {
  const branches = pseudoArgumentBranches(part);
  return branches.length > 0 && branches.every((branch) =>
    branchMatchesNothing(branch, structuralPseudos, forgivingPseudos),
  );
}

/**
 * True when a single pseudo matches nothing.
 * - `:not(L)` matches nothing when SOME branch of L matches everything
 *   (`:not(*)`, `:not(*, .foo)` because the universal branch covers all).
 * - `:is(L)`/`:where(L)` matches nothing when EVERY branch matches
 *   nothing.
 */
function pseudoMatchesNothing(
  part: import('postcss-selector-parser').Node,
  structuralPseudos: Set<string>,
  forgivingPseudos: Set<string>,
): boolean {
  if (part.type !== 'pseudo') {
    return false;
  }
  const pseudoName = part.value.replace(/^:/, '').toLowerCase();
  const branches = pseudoArgumentBranches(part);
  if (pseudoName === 'not') {
    return branches.some((branch) =>
      branchMatchesEverything(branch, structuralPseudos, forgivingPseudos),
    );
  }
  if (forgivingPseudos.has(pseudoName)) {
    return branches.length > 0 && branches.every((branch) =>
      branchMatchesNothing(branch, structuralPseudos, forgivingPseudos),
    );
  }
  return false;
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

/**
 * True when a selector branch matches nothing: it must be exactly one
 * pseudo that itself matches nothing, or at least one compound in the
 * branch is definitely empty (`:not(*) > *` has an empty first compound,
 * so the whole branch matches nothing).
 */
function branchMatchesNothing(
  branch: import('postcss-selector-parser').Node,
  structuralPseudos: Set<string>,
  forgivingPseudos: Set<string>,
): boolean {
  const children = branchChildren(branch);
  if (children.length === 1 && children[0]?.type === 'pseudo') {
    return pseudoMatchesNothing(children[0], structuralPseudos, forgivingPseudos);
  }
  const compounds = compoundSequence(branch);
  return compounds.length > 0 && compounds.some((compound) =>
    compoundMatchesNothing(compound, structuralPseudos, forgivingPseudos),
  );
}

/**
 * True when a compound definitely cannot match any element:
 * - any contained pseudo matches nothing (`.x:not(*)` - the `:not(*)`
 *   pseudo matches nothing, so the compound is empty); or
 * - a `:not(...)` argument excludes every simple selector the compound
 *   selects (`.x:not(.x)`, `*:not(*)`); or
 * - two sibling pseudos are exact negations of each other
 *   (`:not(.x):not(:not(.x))` requires both `not .x` and `.x`).
 */
function compoundMatchesNothing(
  compound: Array<import('postcss-selector-parser').Node>,
  structuralPseudos: Set<string>,
  forgivingPseudos: Set<string>,
): boolean {
  const pseudos = compound.filter((part) => part.type === 'pseudo');
  for (const part of pseudos) {
    const pseudoName = part.value.replace(/^:/, '').toLowerCase();
    if (pseudoName === 'not' || forgivingPseudos.has(pseudoName)) {
      if (pseudoMatchesNothing(part, structuralPseudos, forgivingPseudos)) {
        return true;
      }
    }
  }
  // Sibling negation contradiction: `:not(X)` and `:not(:not(X))` (which
  // equals X) in the same compound exclude each other's sets.
  for (let left = 0; left < pseudos.length; left += 1) {
    for (let right = left + 1; right < pseudos.length; right += 1) {
      const a = pseudos[left]!;
      const b = pseudos[right]!;
      if (pseudoIsExactNegationOf(a, b) || pseudoIsExactNegationOf(b, a)) {
        return true;
      }
    }
  }
  return compoundIsContradiction(compound);
}

/** True when pseudo `a` is exactly `:not(b)` (single argument). */
function pseudoIsExactNegationOf(
  a: import('postcss-selector-parser').Node,
  b: import('postcss-selector-parser').Node,
): boolean {
  if (a.type !== 'pseudo') {
    return false;
  }
  if (a.value.replace(/^:/, '').toLowerCase() !== 'not') {
    return false;
  }
  const branches = pseudoArgumentBranches(a);
  if (branches.length !== 1) {
    return false;
  }
  return branchCoversBranch(b, branches[0]!);
}

/**
 * True when a `:is(...)`/`:where(...)` list covers every element:
 * - a branch whose match set is covered by another branch plus its exact
 *   negation (`:is(.x, :not(.x))`, `:is(:where(.x), :not(.x))`); or
 * - a `:not(a, b, ...)` branch exists whose negated selectors are all
 *   covered by sibling branches (`:is(.x, .y, :not(.x, .y))` - the union
 *   of the positive branches and the complement of their union is
 *   everything).
 *
 * Coverage is token-set semantics (escape-decoded, tag case-insensitive,
 * forgiving wrappers flattened), not raw text comparison.
 */
function forgivingListCoversEverything(
  part: import('postcss-selector-parser').Node,
): boolean {
  const branches = pseudoArgumentBranches(part);
  for (let left = 0; left < branches.length; left += 1) {
    for (let right = left + 1; right < branches.length; right += 1) {
      const a = branches[left]!;
      const b = branches[right]!;
      if (branchIsExactNegationOf(a, b) || branchIsExactNegationOf(b, a)) {
        return true;
      }
    }
  }
  // Multi-branch tautology: `:is(.x, .y, :not(.x, .y))`. Find a :not(...)
  // branch whose negated argument branches are all covered by siblings.
  for (const branch of branches) {
    const negated = negatedSelectorList(branch);
    if (negated.length === 0) {
      continue;
    }
    if (negated.every((selector) =>
      branches.some((other) => other !== branch && branchCoversBranch(other, selector)),
    )) {
      return true;
    }
  }
  return false;
}

/**
 * Returns the argument branches a `:not(...)` branch negates, or an empty
 * array when the branch is not a plain `:not(list)`.
 */
function negatedSelectorList(
  branch: import('postcss-selector-parser').Node,
): Array<import('postcss-selector-parser').Node> {
  const children = branchChildren(branch);
  if (children.length !== 1 || children[0]?.type !== 'pseudo') {
    return [];
  }
  const pseudo = children[0];
  if (pseudo.value.replace(/^:/, '').toLowerCase() !== 'not') {
    return [];
  }
  return pseudoArgumentBranches(pseudo);
}

/**
 * True when the `covered` branch matches everything the `target` branch
 * matches: every selector token of `target` appears in `covered`'s token
 * set (escape-decoded; tag names ASCII case-insensitive; :is()/:where()
 * wrappers flattened recursively).
 */
function branchCoversBranch(
  covered: import('postcss-selector-parser').Node,
  target: import('postcss-selector-parser').Node,
): boolean {
  const targetTokens = new Set<string>();
  collectSelectorTokens(target, targetTokens);
  if (targetTokens.size === 0) {
    return false;
  }
  const coveredTokens = new Set<string>();
  collectSelectorTokens(covered, coveredTokens);
  for (const token of targetTokens) {
    if (!coveredTokens.has(token) && !coveredTokens.has('*')) {
      return false;
    }
  }
  return true;
}

/**
 * Collects the semantic selector tokens of a branch into `out`:
 * - class/id/attribute names (escape-decoded, case-sensitive);
 * - tag names (escape-decoded, ASCII case-insensitive);
 * - the universal `*`;
 * - nested :is()/:where() arguments are flattened recursively.
 */
function collectSelectorTokens(
  branch: import('postcss-selector-parser').Node,
  out: Set<string>,
): void {
  for (const node of branchChildren(branch)) {
    if (node.type === 'universal') {
      out.add('*');
    } else if (node.type === 'class' || node.type === 'id') {
      out.add(`${node.type}:${decodeCssEscapes(node.toString())}`);
    } else if (node.type === 'tag') {
      out.add(`tag:${decodeCssEscapes(node.toString()).toLowerCase()}`);
    } else if (node.type === 'attribute') {
      out.add(`attribute:${decodeCssEscapes(node.toString())}`);
    } else if (node.type === 'pseudo') {
      const pseudoName = node.value.replace(/^:/, '').toLowerCase();
      if ((pseudoName === 'is' || pseudoName === 'where') && 'nodes' in node && Array.isArray(node.nodes)) {
        for (const inner of node.nodes) {
          collectSelectorTokens(inner, out);
        }
      } else if (pseudoName === 'not' && 'nodes' in node && Array.isArray(node.nodes)) {
        // Double negation is semantically transparent: `:not(:not(.x))`
        // matches exactly `.x`. Collect the innermost tokens when the
        // single argument is itself a single `:not(...)`.
        const inner = singlePseudoArgument(node);
        if (inner && inner.type === 'pseudo' && inner.value.replace(/^:/, '').toLowerCase() === 'not') {
          const innermost = singlePseudoArgument(inner);
          if (innermost) {
            collectSelectorTokens(innermost, out);
          }
        }
      }
      // Other pseudos (structural, state, single :not) do not add coverage
      // tokens.
    } else if ('nodes' in node && Array.isArray(node.nodes)) {
      // Plain selector wrapper nodes: recurse into their children.
      for (const inner of node.nodes) {
        collectSelectorTokens(inner, out);
      }
    }
  }
}

/** True when selector branch `a` is exactly `:not(b)` (single argument). */
function branchIsExactNegationOf(
  a: import('postcss-selector-parser').Node,
  b: import('postcss-selector-parser').Node,
): boolean {
  const aChildren = branchChildren(a);
  if (aChildren.length !== 1 || aChildren[0]?.type !== 'pseudo') {
    return false;
  }
  return pseudoIsExactNegationOf(aChildren[0], b);
}

/**
 * True when a compound cannot match any element because a `:not(...)`
 * argument excludes every simple selector the compound selects:
 * `.x:not(.x)` (class excluded by its own negation), `*:not(*)`
 * (universal excluded), `.x:not(.x, .y)` (one branch suffices).
 */
function compoundIsContradiction(
  compound: Array<import('postcss-selector-parser').Node>,
): boolean {
  // Collect the compound's own selector tokens (escape-decoded, with
  // :is()/:where() wrappers flattened recursively).
  const ownTokens = new Set<string>();
  for (const part of compound) {
    collectSelectorTokens(part, ownTokens);
  }
  if (ownTokens.size === 0) {
    return false;
  }
  for (const part of compound) {
    if (part.type !== 'pseudo') {
      continue;
    }
    const pseudoName = part.value.replace(/^:/, '').toLowerCase();
    if (pseudoName !== 'not') {
      continue;
    }
    const branches = pseudoArgumentBranches(part);
    for (const branch of branches) {
      // The :not branch excludes everything matching `branch`. If any
      // selector token of this compound is exactly covered by the branch,
      // the compound selects nothing. Token-set semantics avoid both
      // substring false positives (.foo vs .foobar) and escape/case
      // mismatches (.\\78 vs .x, P vs p).
      for (const token of ownTokens) {
        if (branchCoversToken(branch, token)) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * True when a :not() branch matches every element carrying `token`
 * (a token produced by {@link collectSelectorTokens}). The universal `*`
 * is covered only when the branch itself contains a universal; `:not(*)`
 * matches nothing and must not count as covering `*`.
 */
function branchCoversToken(
  branch: import('postcss-selector-parser').Node,
  token: string,
): boolean {
  const branchTokens = new Set<string>();
  collectSelectorTokens(branch, branchTokens);
  if (token === '*') {
    return branchTokens.has('*');
  }
  return branchTokens.has(token) || branchTokens.has('*');
}

/**
 * True when a selector branch matches every element: every compound in the
 * branch is universal-capable (`*`, `* > *`, `*:nth-child(n)`, `:is(*)`).
 */
function branchMatchesEverything(
  branch: import('postcss-selector-parser').Node,
  structuralPseudos: Set<string>,
  forgivingPseudos: Set<string>,
): boolean {
  const compounds = compoundSequence(branch);
  return (
    compounds.length > 0 &&
    compounds.every((compound) =>
      compoundMatchesEverything(compound, structuralPseudos, forgivingPseudos),
    )
  );
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
    const property = decodeCssEscapes(declaration.prop).toLowerCase();
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
