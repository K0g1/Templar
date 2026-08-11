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
  targetsRhythmElement: boolean;
  globalToken: string | null;
  usesPrivateRuntimeClass: boolean;
  usesGlobalEscape: boolean;
}

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
  if (startsWithVirtualRoot) {
    // A combinator changes the subject from the page root to a descendant.
    const firstCombinator = root.nodes.findIndex((node) => node.type === 'combinator');
    targetsVirtualRoot = firstCombinator < 0;
  }
  const trailingNodes = root.nodes.slice(1).filter((node) => node.type !== 'combinator');
  const targetsWholePage = startsWithVirtualRoot && (targetsVirtualRoot || (
    trailingNodes.length === 1 && trailingNodes[0]?.type === 'universal'
  ));
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
    targetsRhythmElement,
    globalToken,
    usesPrivateRuntimeClass,
    usesGlobalEscape,
  };
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
