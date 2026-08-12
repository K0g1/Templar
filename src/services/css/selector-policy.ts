import selectorParser, {
  type Node,
  type Selector,
} from 'postcss-selector-parser';

const virtualRoots = new Set(['page', 'page-content']);
const rhythmTags = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li', 'blockquote', 'pre', 'hr',
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

export interface SelectorAnalysis {
  text: string;
  startsWithVirtualRoot: boolean;
  targetsVirtualRoot: boolean;
  targetsWholePage: boolean;
  coverage: SelectorCoverage;
  targetsRhythmElement: boolean;
  globalToken: string | null;
  usesPrivateRuntimeClass: boolean;
  usesGlobalEscape: boolean;
}

export type SelectorCoverage =
  | 'virtual-root'
  | 'all-descendants'
  | 'specific-descendant';

export function parseSelector(selector: string): Selector[] {
  const ast = selectorParser().astSync(selector);
  return ast.nodes;
}

export function analyzeSelector(selector: string): SelectorAnalysis[] {
  return parseSelector(selector).map((root) => analyzeRoot(root));
}

export function rootClassName(selector: Selector): 'page' | 'page-content' | null {
  const first = selector.nodes[0];
  if (first?.type !== 'class') return null;
  const value = decodeCssEscapes(first.value);
  return virtualRoots.has(value)
    ? value as 'page' | 'page-content'
    : null;
}

export function transformSelectorAst(
  selector: string,
  scope: string,
  livePreviewElements: Readonly<Record<string, string>>,
): string {
  const processor = selectorParser((root) => {
    root.each((selectorNode) => {
      if (selectorNode.type !== 'selector') return;
      const rootName = rootClassName(selectorNode);
      if (!rootName) {
        throw new Error(`Selector “${selectorNode.toString().trim()}” must start with .page or .page-content.`);
      }
      const prefix = selectorParser().astSync(
        `${scope} ${rootName === 'page-content' ? '.templar-page-content' : '.templar-page'}`,
      ).nodes[0];
      if (!prefix) throw new Error('Templar could not construct the note scope selector.');
      const first = selectorNode.nodes[0];
      if (!first) throw new Error('Templar could not find the virtual root selector.');
      for (const node of prefix.nodes) {
        selectorNode.insertBefore(first, node.clone());
      }
      first.remove();
      selectorNode.walkTags((tag) => {
        const replacement = livePreviewElements[tag.value.toLowerCase()];
        if (!replacement) return;
        const replacementSelector = selectorParser().astSync(replacement).nodes[0];
        if (!replacementSelector) return;
        const replacementNodes = replacementSelector.nodes.map((node) => node.clone());
        if (replacementNodes[0]) {
          replacementNodes[0].spaces.before = tag.spaces.before;
        }
        tag.replaceWith(...replacementNodes);
      });
    });
  });
  return processor.processSync(selector);
}

function analyzeRoot(root: Selector): SelectorAnalysis {
  const text = root.toString().trim();
  const startsWithVirtualRoot = rootClassName(root) !== null;
  let targetsVirtualRoot = startsWithVirtualRoot;
  let coverage: SelectorCoverage = 'specific-descendant';
  if (startsWithVirtualRoot) {
    // A combinator changes the subject from the page root to a descendant.
    const firstCombinator = root.nodes.findIndex((node) => node.type === 'combinator');
    targetsVirtualRoot = firstCombinator < 0;
    if (targetsVirtualRoot) {
      coverage = 'virtual-root';
    } else {
      const lastCombinator = root.nodes.map((node) => node.type).lastIndexOf('combinator');
      const combinator = lastCombinator >= 0 ? root.nodes[lastCombinator] : null;
      const subject = lastCombinator >= 0
        ? root.nodes.slice(lastCombinator + 1).filter((node) => node.type !== 'combinator')
        : [];
      if (
        combinator?.type === 'combinator' &&
        (combinator.value === ' ' || combinator.value === '>') &&
        isUniversalSubjectCompound(subject)
      ) {
        coverage = 'all-descendants';
      }
    }
  }
  const targetsWholePage = coverage === 'virtual-root' || coverage === 'all-descendants';
  let targetsRhythmElement = false;
  let globalToken: string | null = null;
  let usesPrivateRuntimeClass = false;
  let usesGlobalEscape = false;
  root.walkTags((tag) => {
    const value = decodeCssEscapes(tag.value).toLowerCase();
    if (rhythmTags.has(value)) targetsRhythmElement = true;
    if (!globalToken && globalTags.has(value)) globalToken = value;
  });
  root.walkClasses((className) => {
    const value = decodeCssEscapes(className.value).toLowerCase();
    if (!globalToken && globalClasses.has(value)) globalToken = `.${value}`;
    if (value.startsWith('templar-')) usesPrivateRuntimeClass = true;
  });
  root.walkPseudos((pseudo) => {
    const value = decodeCssEscapes(pseudo.value).toLowerCase();
    if (!globalToken && value === ':root') globalToken = ':root';
    if (value === ':global(' || value.startsWith(':global')) usesGlobalEscape = true;
  });
  return {
    text,
    startsWithVirtualRoot,
    targetsVirtualRoot,
    targetsWholePage,
    coverage,
    targetsRhythmElement,
    globalToken,
    usesPrivateRuntimeClass,
    usesGlobalEscape,
  };
}

/** Return true only when a compound can match every descendant element. */
export function isUniversalSubjectCompound(nodes: readonly Node[]): boolean {
  let universal = false;
  for (const node of nodes) {
    if (node.type === 'universal') {
      universal = true;
      continue;
    }
    if (node.type !== 'pseudo') return false;
    const value = decodeCssEscapes(node.value).toLowerCase();
    if (value !== ':is' && value !== ':where') return false;
    const nested = (node as Node & { nodes?: Node[] }).nodes ?? [];
    const branches = nested.filter(isSelectorNode);
    if (!branches.some((branch) => isUniversalSubjectCompound(branch.nodes))) return false;
    universal = true;
  }
  return universal;
}

export function decodeCssEscapes(value: string): string {
  return value.replace(
    /\\(?:([0-9a-f]{1,6})\s?|([^\r\n0-9a-f]))/gi,
    (_match, hex: string | undefined, character: string | undefined) => {
      if (hex) {
        const codePoint = Number.parseInt(hex, 16);
        return codePoint === 0 || codePoint > 0x10ffff
          ? '\uFFFD'
          : String.fromCodePoint(codePoint);
      }
      return character ?? '';
    },
  );
}

export function isSelectorNode(value: Node): value is Selector {
  return value.type === 'selector';
}
