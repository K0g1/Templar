import type { BaselineView, RhythmKind } from './types';

const READING_PREFIX_SELECTOR = [
  '.metadata-container',
  '.mod-frontmatter',
  '.mod-header',
  '.mod-ui',
  '.markdown-preview-pusher',
].join(',');

const READING_BLOCK_SELECTOR = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'blockquote',
  'pre', 'table', 'hr', '.callout', '.mermaid', '[class*="block-language-"]',
  '.math-block', '.internal-embed', '.file-embed', '.markdown-embed',
  'figure', 'details', 'iframe', 'object', 'video', 'audio', 'canvas', 'img', '.inline-title',
].join(',');

const READING_ATOMIC_SELECTOR = [
  '.internal-embed', '.file-embed', '.markdown-embed', '.mermaid',
  '[class*="block-language-"]', '.math-block', 'figure', 'details',
  'iframe', 'object', 'video', 'audio', 'canvas', 'img',
].join(',');

/**
 * Obsidian 1.13+ commonly wraps a rendered Markdown block in an `el-*`
 * section element.  The wrapper is the layout owner; its first rendered
 * Markdown descendant supplies the semantic kind and baseline target.
 */
function readingSemanticElement(element: HTMLElement): HTMLElement | null {
  if (element.matches(READING_BLOCK_SELECTOR)) return element;
  // An embed can be wrapped by an `el-p`/`el-div` container whose first
  // descendant is a paragraph, title, or rendered property.  The wrapper is
  // still the flow owner, but the embed must own its height and must not be
  // measured as ordinary text.  Prefer the atomic descendant before falling
  // back to the first semantic Markdown block.
  const atomic = element.querySelector<HTMLElement>(READING_ATOMIC_SELECTOR);
  if (atomic) return atomic;
  return element.querySelector<HTMLElement>(READING_BLOCK_SELECTOR);
}

const EDITOR_WIDGET_SELECTOR = [
  '.cm-gap',
  '.cm-table-widget', '.cm-embed-block', '.cm-callout', '.cm-math-block',
  '.cm-image-widget', '.cm-rendered-markdown', '.mermaid', '[class*="block-language-"]',
].join(',');

export function isNonRhythmicUi(element: HTMLElement): boolean {
  return Boolean(element.closest(`${READING_PREFIX_SELECTOR}, .cm-gutters, .cm-tooltip, .mod-ui`));
}

export function isReadingPageContent(element: HTMLElement): boolean {
  return element.hasClass('markdown-preview-sizer') ||
    Boolean(element.closest('.markdown-preview-view')) && !element.hasClass('cm-sizer');
}

export function isLivePreviewPageContent(element: HTMLElement): boolean {
  return element.hasClass('cm-sizer') || Boolean(element.closest('.cm-content'));
}

export function classifyFlowElement(element: HTMLElement, view: BaselineView): RhythmKind | null {
  if (element.hasClass('templar-blank-line-spacer')) return 'blank-space';
  if (element.matches('.inline-title')) return 'heading';
  if (isNonRhythmicUi(element)) return 'non-rhythmic-ui';

  if (view === 'live-preview' || element.hasClass('cm-line')) {
    if (element.hasClass('cm-gap')) return 'editor-widget';
    if (element.hasClass('cm-line')) {
      if (element.hasClass('HyperMD-frontmatter')) return null;
      if (element.hasClass('HyperMD-hr')) return 'divider';
      if (element.hasClass('HyperMD-header-1') || element.hasClass('HyperMD-header-2') ||
        element.hasClass('HyperMD-header-3') || element.hasClass('HyperMD-header-4') ||
        element.hasClass('HyperMD-header-5') || element.hasClass('HyperMD-header-6')) return 'heading';
      if (element.hasClass('HyperMD-codeblock')) return 'code';
      if (element.hasClass('HyperMD-table-row') || element.hasClass('HyperMD-list-line') ||
        element.hasClass('HyperMD-quote')) return 'editor-line';
      return 'editor-line';
    }
    if (element.matches(EDITOR_WIDGET_SELECTOR)) {
      if (element.matches('.cm-table-widget, .cm-embed-block, .cm-callout, .cm-math-block')) return 'editor-widget';
      return element.matches('img, .cm-image-widget') ? 'image' : 'editor-widget';
    }
    return null;
  }

  const semantic = readingSemanticElement(element);
  if (!semantic) return null;
  if (semantic.matches('h1, h2, h3, h4, h5, h6, .inline-title')) return 'heading';
  if (semantic.matches('ul, ol')) return 'list';
  if (semantic.matches('pre')) return 'code';
  if (semantic.matches('blockquote')) return 'composite';
  if (semantic.matches('table, .callout')) return 'composite';
  if (semantic.matches('img')) return 'image';
  if (semantic.matches('hr')) return 'divider';
  if (semantic.matches('.mermaid, [class*="block-language-"], .math-block, .internal-embed, .file-embed, .markdown-embed, figure, details, iframe, object, video, audio, canvas')) {
    return 'atomic';
  }
  return 'text';
}

/** Returns the rendered Markdown element represented by a flow owner. */
export function flowTarget(element: HTMLElement, view: BaselineView): HTMLElement {
  if (view !== 'reading') return element;
  return readingSemanticElement(element) ?? element;
}

function readingSection(pageContent: HTMLElement): HTMLElement | null {
  return pageContent.querySelector<HTMLElement>(':scope > .markdown-preview-section') ??
    (pageContent.hasClass('markdown-preview-section') ? pageContent : null);
}

function editorContent(pageContent: HTMLElement): HTMLElement | null {
  return pageContent.querySelector<HTMLElement>(':scope > .cm-content') ??
    pageContent.querySelector<HTMLElement>(':scope > .cm-contentContainer > .cm-content');
}

/**
 * Returns one owner per flow item. Descendants of a composite stay owned by
 * that composite so an embedded renderer cannot correct its own descendants
 * a second time.
 */
export function collectFlowItems(pageContent: HTMLElement, view: BaselineView): HTMLElement[] {
  const parent = view === 'reading' ? readingSection(pageContent) : editorContent(pageContent);
  if (!parent) return [];
  const items: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  const add = (element: HTMLElement): void => {
    if (seen.has(element)) return;
    const kind = classifyFlowElement(element, view);
    if (!kind || kind === 'non-rhythmic-ui') return;
    seen.add(element);
    items.push(element);
  };

  if (view === 'reading') {
    const inlineTitle = pageContent.querySelector<HTMLElement>(':scope > .inline-title, :scope > .mod-header .inline-title');
    if (inlineTitle) add(inlineTitle);
  }

  for (const child of Array.from(parent.children)) {
    const constructor = child.ownerDocument.defaultView?.HTMLElement;
    if (!constructor || !child.instanceOf(constructor)) continue;
    if (child.matches(READING_PREFIX_SELECTOR)) continue;
    if (view === 'live-preview') {
      if (child.matches('.cm-line')) add(child);
      else if (child.matches(EDITOR_WIDGET_SELECTOR)) add(child);
      continue;
    }
    add(child);
  }
  return items;
}

export function flowOwner(element: HTMLElement, view: BaselineView): HTMLElement | null {
  if (view === 'reading') {
    const section = element.closest<HTMLElement>('.markdown-preview-section');
    if (!section) return null;
    let owner: HTMLElement = element;
    while (owner.parentElement && owner.parentElement !== section) {
      owner = owner.parentElement;
    }
    return owner === section ? null : owner;
  }
  const content = element.closest<HTMLElement>('.cm-content');
  if (!content) return null;
  const line = element.closest<HTMLElement>('.cm-line');
  if (line && line.parentElement === content) return line;
  const widget = element.closest<HTMLElement>(EDITOR_WIDGET_SELECTOR);
  return widget?.parentElement === content ? widget : null;
}

export function isAtomicKind(kind: RhythmKind): boolean {
  return kind === 'atomic' || kind === 'image' || kind === 'divider' || kind === 'editor-widget' || kind === 'composite';
}

export function isTextKind(kind: RhythmKind): boolean {
  return kind === 'text' || kind === 'heading' || kind === 'list' || kind === 'code' || kind === 'editor-line';
}

export const BASELINE_GRID_ITEM_CLASS = 'templar-baseline-grid-item';
export const BASELINE_GRID_ATOMIC_CLASS = 'templar-baseline-grid-atomic';
export const BASELINE_GRID_INTENTIONAL_CLASS = 'templar-baseline-grid-intentional';
export const BASELINE_GRID_LIST_ITEM_CLASS = 'templar-baseline-grid-list-item';
