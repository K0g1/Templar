import {
  MarkdownView,
  TFile,
  type App,
  type MarkdownPostProcessorContext,
  type WorkspaceLeaf,
} from 'obsidian';
import {
  TEMPLAR_CLASS,
  TEMPLAR_CONTENT_CLASS,
  TEMPLAR_PAGE_CLASS,
  TEMPLAR_STYLE_ELEMENT_CLASS,
} from '../constants';
import type { TemplarNoteStyle, TemplarSettings, ValidationIssue } from '../types';
import {
  gridCompensation,
  imageGridCompensation,
  measuredGeometryScale,
  naturalOuterFootprint,
} from '../utils/grid';
import { escapeCssAttribute, round } from '../utils/value';
import { leafScopeValue } from '../utils/scope';
import { clone } from '../utils/value';
import { FontMetricsService } from './font-metrics';
import type { FrontmatterService } from './frontmatter';
import { PageLayoutService } from './page-layout';
import {
  findEditorPaperOriginTarget,
  findReadingPaperOriginTarget,
  measuredPaperOrigin,
  type PaperOriginTarget,
} from './paper-origin';
import {
  blankLinesBeforeFirstSection,
  blankLinesBetweenSections,
  bodyStartLineAfterFrontmatter,
  createBlankLineSpacer,
  hasReadingWhitespaceWork,
  internalBlankLineRuns,
  readingRootNeedsRetarget,
} from './reading-whitespace';
import { compilePageStyle, type PageMetricSet } from './style-compiler';

interface StyledView {
  contentEl: HTMLElement;
  filePath: string;
}

interface ReadingRootState {
  bodyStartLine: number;
  context: MarkdownPostProcessorContext | null;
  filePath: string | null;
  sections: HTMLElement[];
}

interface ReadingSectionInfo {
  lineStart: number;
  lineEnd: number;
  text: string;
}

interface ImageObservationState {
  mutationObserver: MutationObserver;
  observedImages: Set<HTMLElement>;
  resizeObserver: ResizeObserver;
}

interface RhythmObservationState {
  frame: number | null;
  mutationObserver: MutationObserver;
  needsScan: boolean;
  observedBlocks: Set<HTMLElement>;
  pendingMeasurements: Map<HTMLElement, number | undefined>;
  resizeObserver: ResizeObserver;
  view: Window;
}

interface PaperOriginObservationState {
  frame: number | null;
  mutationObserver: MutationObserver;
  observedElements: Set<HTMLElement>;
  pageContents: Set<HTMLElement>;
  resizeObserver: ResizeObserver;
  targets: Map<HTMLElement, PaperOriginTarget>;
  view: Window;
}

interface PreviewState {
  owner: string;
  filePath: string;
  style: TemplarNoteStyle;
}

const VARIABLE_BLOCK_SELECTORS = [
  'table',
  '.mermaid',
  '[class*="block-language-"]',
  '.math-block',
  '.callout',
  '.internal-embed',
  '.file-embed',
  'pre',
  'details',
  'figure',
  'iframe',
  'object',
  'video',
  'audio',
  'canvas',
  '.cm-table-widget',
  '.cm-embed-block',
] as const;

export class PageRenderer {
  private destroyed = false;
  private scheduled = false;
  private readonly leafGenerations = new WeakMap<WorkspaceLeaf, number>();
  private readonly leafScopeIds = new WeakMap<WorkspaceLeaf, number>();
  private nextLeafScopeId = 1;
  private readonly styledViews = new Map<WorkspaceLeaf, StyledView>();
  private readonly imageObservers = new Map<WorkspaceLeaf, ImageObservationState>();
  private readonly rhythmObservers = new Map<WorkspaceLeaf, RhythmObservationState>();
  private readonly paperOriginObservers = new Map<WorkspaceLeaf, PaperOriginObservationState>();
  private readonly issuesByFile = new Map<string, ValidationIssue[]>();
  private readonly fontDocumentCleanups = new Map<Document, () => void>();
  private readonly pageLayout = new PageLayoutService();
  private readonly readingSections = new WeakMap<HTMLElement, ReadingSectionInfo>();
  private readonly readingRoots = new Map<HTMLElement, ReadingRootState>();
  private readonly scheduledReadingRoots = new Map<HTMLElement, number>();
  private readonly previews = new Map<WorkspaceLeaf, PreviewState>();

  public constructor(
    private readonly app: App,
    private readonly settings: TemplarSettings,
    private readonly frontmatter: FrontmatterService,
    private readonly fontMetrics: FontMetricsService,
  ) {}

  public scheduleRefreshAll(): void {
    if (this.destroyed || this.scheduled) {
      return;
    }
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (!this.destroyed) {
        void this.refreshAll();
      }
    });
  }

  public async refreshAll(): Promise<void> {
    if (this.destroyed) {
      return;
    }
    const leaves = this.app.workspace.getLeavesOfType('markdown');
    const activeLeaves = new Set(leaves);
    for (const leaf of leaves) {
      if (this.destroyed) {
        return;
      }
      await this.refreshLeaf(leaf);
    }
    for (const leaf of this.styledViews.keys()) {
      if (!activeLeaves.has(leaf)) {
        this.clearLeaf(leaf);
      }
    }
  }

  public async refreshFile(file: TFile): Promise<void> {
    if (this.destroyed) {
      return;
    }
    const leaves = this.app.workspace
      .getLeavesOfType('markdown')
      .filter((leaf) => leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path);
    for (const leaf of leaves) {
      if (this.destroyed) {
        return;
      }
      await this.refreshLeaf(leaf);
    }
  }

  public async refreshLeafNow(leaf: WorkspaceLeaf): Promise<void> {
    await this.refreshLeaf(leaf);
  }

  public preparePrint(leaf: WorkspaceLeaf, style: TemplarNoteStyle): void {
    this.pageLayout.preparePrint(leaf, style);
  }

  public restoreAfterPrint(leaf: WorkspaceLeaf, style: TemplarNoteStyle): void {
    this.pageLayout.restoreAfterPrint(leaf, style);
  }

  public issuesFor(file: TFile): ValidationIssue[] {
    return [...(this.issuesByFile.get(file.path) ?? [])];
  }

  public async setPreview(
    leaf: WorkspaceLeaf,
    owner: string,
    filePath: string,
    style: TemplarNoteStyle,
  ): Promise<void> {
    this.previews.set(leaf, { owner, filePath, style: clone(style) });
    await this.refreshLeaf(leaf);
  }

  public async cancelPreview(leaf: WorkspaceLeaf, owner?: string): Promise<void> {
    const state = this.previews.get(leaf);
    if (!state || (owner && state.owner !== owner)) return;
    this.previews.delete(leaf);
    await this.refreshLeaf(leaf);
  }

  public cancelPreviewsByOwner(owner: string): void {
    for (const [leaf, state] of this.previews) {
      if (state.owner !== owner) continue;
      this.previews.delete(leaf);
      void this.refreshLeaf(leaf);
    }
  }

  public previewStyle(leaf: WorkspaceLeaf): TemplarNoteStyle | null {
    return this.previews.has(leaf) ? clone(this.previews.get(leaf)!.style) : null;
  }

  public resolvedStyle(leaf: WorkspaceLeaf): TemplarNoteStyle | null {
    if (!(leaf.view instanceof MarkdownView) || !leaf.view.file) {
      return null;
    }
    return clone(
      this.previews.get(leaf)?.style ??
      this.frontmatter.getStyle(leaf.view.file),
    );
  }

  public registerReadingSection(
    element: HTMLElement,
    context: MarkdownPostProcessorContext,
  ): void {
    const file = this.app.vault.getAbstractFileByPath(context.sourcePath);
    if (
      this.destroyed ||
      !this.settings.enableReadingView ||
      !(file instanceof TFile)
    ) {
      return;
    }
    this.pruneDisconnectedReadingRoots();
    const info = context.getSectionInfo(element);
    const readingRoot = element.closest<HTMLElement>('.markdown-preview-view');
    if (!info || !readingRoot) {
      return;
    }
    const state = this.rootState(readingRoot);
    this.retargetReadingRoot(
      readingRoot,
      state,
      context.sourcePath,
      this.bodyStartLine(file),
    );
    state.context = context;
    if (!state.sections.includes(element)) {
      state.sections.push(element);
    }
    this.readingSections.set(element, {
      lineStart: info.lineStart,
      lineEnd: info.lineEnd,
      text: info.text,
    });
    if (this.frontmatter.hasStyle(file)) {
      element.addClass('templar-reading-section');
      // Reconcile synchronously inside the post-processor. Obsidian renders
      // this section and measures its height later in the same task, so the
      // spacers must already be in place: any deferred insertion lands after
      // the first paint (the visible flash) and after the height measurement
      // (which makes the virtual scroller drift from the real layout).
      this.reconcileReadingWhitespace(readingRoot, element);
    }
  }

  public destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    for (const root of [...this.readingRoots.keys()]) {
      this.clearReadingWhitespaceRoot(root);
    }
    this.scheduledReadingRoots.clear();
    this.pageLayout.destroy();
    this.previews.clear();
    for (const leaf of [...this.styledViews.keys()]) {
      this.clearLeaf(leaf);
    }
    for (const cleanup of this.fontDocumentCleanups.values()) cleanup();
    this.fontDocumentCleanups.clear();
    this.fontMetrics.clear();
    this.issuesByFile.clear();
  }

  private async refreshLeaf(leaf: WorkspaceLeaf): Promise<void> {
    if (this.destroyed) {
      return;
    }
    this.pruneDisconnectedReadingRoots();
    if (!(leaf.view instanceof MarkdownView)) {
      this.clearLeaf(leaf);
      return;
    }
    const view = leaf.view;
    const file = view.file;
    const preview = this.previews.get(leaf);
    if (preview && preview.filePath !== file?.path) {
      this.previews.delete(leaf);
    }
    const style = file
      ? this.previews.get(leaf)?.style ?? this.frontmatter.getStyle(file)
      : null;
    if (!file || !style) {
      this.clearLeaf(leaf);
      return;
    }

    const run = (this.leafGenerations.get(leaf) ?? 0) + 1;
    this.leafGenerations.set(leaf, run);
    const document = view.contentEl.ownerDocument;
    this.observeFontDocument(document);
    const metrics = await this.fontMetrics.measurePage(style, document);
    if (
      this.destroyed ||
      this.leafGenerations.get(leaf) !== run ||
      view.file?.path !== file.path
    ) {
      return;
    }

    this.prepareViewRoots(view.contentEl);
    let leafScopeId = this.leafScopeIds.get(leaf);
    if (leafScopeId === undefined) {
      leafScopeId = this.nextLeafScopeId;
      this.nextLeafScopeId += 1;
      this.leafScopeIds.set(leaf, leafScopeId);
    }
    const scopeValue = leafScopeValue(leafScopeId);
    view.contentEl.addClass(TEMPLAR_CLASS);
    view.contentEl.dataset.templarScope = scopeValue;
    view.contentEl.dataset.templarFile = file.path;
    const scope = `[data-templar-scope="${escapeCssAttribute(scopeValue)}"]`;
    const compiled = compilePageStyle(style, scope, scopeValue, metrics);
    this.issuesByFile.set(file.path, compiled.issues);

    const styleEl = this.getOrCreateStyleElement(view.contentEl);
    styleEl.textContent = compiled.css;
    this.styledViews.set(leaf, { contentEl: view.contentEl, filePath: file.path });
    this.configurePaperOrigin(leaf, view.contentEl, style, metrics);
    this.configureImageSnapping(leaf, view.contentEl, style);
    this.configureVariableBlockSnapping(leaf, view.contentEl, style);
    this.pageLayout.configure(leaf, view.contentEl, style);
    const readingRoot = view.contentEl.querySelector<HTMLElement>(
      ':scope > .markdown-reading-view > .markdown-preview-view, :scope > .markdown-preview-view',
    );
    if (this.settings.enableReadingView && readingRoot) {
      this.registerCachedReadingSections(readingRoot, file);
      this.scheduleReadingWhitespace(readingRoot);
    }
  }

  private prepareViewRoots(contentEl: HTMLElement): void {
    for (const element of contentEl.querySelectorAll(`.${TEMPLAR_PAGE_CLASS}`)) {
      element.removeClass(TEMPLAR_PAGE_CLASS);
    }
    for (const element of contentEl.querySelectorAll(`.${TEMPLAR_CONTENT_CLASS}`)) {
      element.removeClass(TEMPLAR_CONTENT_CLASS);
    }

    const readingRoot = contentEl.querySelector<HTMLElement>(
      ':scope > .markdown-reading-view > .markdown-preview-view, :scope > .markdown-preview-view',
    );
    const sourceRoot = contentEl.querySelector<HTMLElement>(
      ':scope > .markdown-source-view.mod-cm6',
    );
    if (this.settings.enableReadingView && readingRoot) {
      readingRoot.addClass(TEMPLAR_PAGE_CLASS);
      readingRoot
        .querySelector(':scope > .markdown-preview-sizer')
        ?.addClass(TEMPLAR_CONTENT_CLASS);
    } else if (readingRoot) {
      this.clearReadingWhitespaceRoot(readingRoot);
    }
    if (this.settings.enableLivePreview && sourceRoot) {
      const scroller = sourceRoot.querySelector<HTMLElement>(
        ':scope > .cm-editor > .cm-scroller',
      );
      scroller?.addClass(TEMPLAR_PAGE_CLASS);
      scroller
        ?.querySelector(':scope > .cm-sizer')
        ?.addClass(TEMPLAR_CONTENT_CLASS);
    }
  }

  private getOrCreateStyleElement(contentEl: HTMLElement): HTMLStyleElement {
    const existing = contentEl.querySelector<HTMLStyleElement>(
      `:scope > style.${TEMPLAR_STYLE_ELEMENT_CLASS}`,
    );
    if (existing) {
      return existing;
    }
    const element = contentEl.ownerDocument.createElement('style');
    element.className = TEMPLAR_STYLE_ELEMENT_CLASS;
    element.dataset.templarOwned = 'true';
    contentEl.prepend(element);
    return element;
  }

  private observeFontDocument(document: Document): void {
    for (const [known, cleanup] of this.fontDocumentCleanups) {
      if (known.defaultView?.closed) {
        cleanup();
        this.fontDocumentCleanups.delete(known);
      }
    }
    if (this.fontDocumentCleanups.has(document) || !document.fonts) {
      return;
    }
    const loaded = (): void => {
      this.fontMetrics.clear();
      this.scheduleRefreshAll();
    };
    document.fonts.addEventListener('loadingdone', loaded);
    this.fontDocumentCleanups.set(document, () =>
      document.fonts.removeEventListener('loadingdone', loaded),
    );
  }

  private configureImageSnapping(
    leaf: WorkspaceLeaf,
    contentEl: HTMLElement,
    style: TemplarNoteStyle,
  ): void {
    this.imageObservers.get(leaf)?.resizeObserver.disconnect();
    this.imageObservers.get(leaf)?.mutationObserver.disconnect();
    this.imageObservers.delete(leaf);
    for (const image of contentEl.querySelectorAll<HTMLElement>('img')) {
      image.style.removeProperty('--templar-image-snap');
    }

    const enabled =
      style.baseline.enabled &&
      style.baseline.mode !== 'free' &&
      style.baseline.snapImages &&
      typeof ResizeObserver !== 'undefined' &&
      typeof MutationObserver !== 'undefined';
    if (!enabled) {
      return;
    }

    const update = (image: HTMLElement): void => {
      // offsetHeight is the untransformed layout border box. A client rect is
      // contaminated by paged-mode zoom and decorative rotation, which would
      // otherwise make the baseline compensation change as the pane resizes.
      const height = image.offsetHeight;
      if (height <= 0) {
        return;
      }
      const previous = Number.parseFloat(
        image.style.getPropertyValue('--templar-image-snap'),
      ) || 0;
      const computed = contentEl.ownerDocument.defaultView?.getComputedStyle(image);
      const footprint = height +
        (Number.parseFloat(computed?.marginBlockStart ?? computed?.marginTop ?? '0') || 0) +
        (Number.parseFloat(computed?.marginBlockEnd ?? computed?.marginBottom ?? '0') || 0) -
        previous;
      const compensation = imageGridCompensation(footprint, style.baseline.unit);
      image.style.setProperty('--templar-image-snap', `${String(round(compensation))}px`);
    };
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target.instanceOf(HTMLElement)) {
          update(entry.target);
        }
      }
    });
    const state: ImageObservationState = {
      mutationObserver: new MutationObserver(() => scanImages()),
      observedImages: new Set(),
      resizeObserver,
    };
    const scanImages = (): void => {
      const nextImages = new Set(
        contentEl.querySelectorAll<HTMLElement>(`.${TEMPLAR_PAGE_CLASS} img`),
      );
      for (const image of state.observedImages) {
        if (!nextImages.has(image)) {
          resizeObserver.unobserve(image);
        }
      }
      for (const image of nextImages) {
        if (!state.observedImages.has(image)) {
          resizeObserver.observe(image);
        }
        update(image);
      }
      state.observedImages = nextImages;
    };
    state.mutationObserver.observe(contentEl, { childList: true, subtree: true });
    this.imageObservers.set(leaf, state);
    scanImages();
  }

  private configurePaperOrigin(
    leaf: WorkspaceLeaf,
    contentEl: HTMLElement,
    style: TemplarNoteStyle,
    metrics: PageMetricSet,
  ): void {
    this.disconnectPaperOrigin(leaf);
    const pageContents = new Set(
      contentEl.querySelectorAll<HTMLElement>(`.${TEMPLAR_CONTENT_CLASS}`),
    );
    for (const pageContent of pageContents) {
      pageContent.style.removeProperty('--templar-paper-baseline-position');
    }

    const view = contentEl.ownerDocument.defaultView;
    const enabled =
      style.baseline.enabled &&
      style.baseline.mode !== 'free' &&
      view !== null &&
      typeof ResizeObserver !== 'undefined' &&
      typeof MutationObserver !== 'undefined';
    if (!enabled || !view) {
      return;
    }

    let state: PaperOriginObservationState;
    const scan = (): void => {
      const nextPageContents = new Set(
        contentEl.querySelectorAll<HTMLElement>(`.${TEMPLAR_CONTENT_CLASS}`),
      );
      const nextObserved = new Set<HTMLElement>();
      for (const previous of state.pageContents) {
        if (!nextPageContents.has(previous)) {
          previous.style.removeProperty('--templar-paper-baseline-position');
          state.targets.delete(previous);
        }
      }
      for (const pageContent of nextPageContents) {
        nextObserved.add(pageContent);
        for (const prefix of pageContent.querySelectorAll<HTMLElement>(
          ':scope > .inline-title, :scope > .metadata-container, :scope > .mod-frontmatter, :scope > .mod-header',
        )) {
          nextObserved.add(prefix);
        }
        let target = state.targets.get(pageContent);
        if (target?.element.isConnected) {
          const refreshed = pageContent.hasClass('cm-sizer')
            ? findEditorPaperOriginTarget(pageContent, metrics)
            : findReadingPaperOriginTarget(pageContent, metrics);
          if (refreshed?.element === target.element) {
            target = refreshed;
            state.targets.set(pageContent, refreshed);
          }
        }
        if (!target?.element.isConnected) {
          const pageRoot = pageContent.closest<HTMLElement>(`.${TEMPLAR_PAGE_CLASS}`);
          const atDocumentStart = !pageRoot || pageRoot.scrollTop <= 1;
          if (target && !atDocumentStart) {
            // Keep the document-origin phase while a virtual scroller swaps
            // its first attached block. Re-anchoring to the viewport would
            // make the paper jump as the user scrolls.
            continue;
          }
          target = (pageContent.hasClass('cm-sizer')
            ? findEditorPaperOriginTarget(pageContent, metrics)
            : findReadingPaperOriginTarget(pageContent, metrics)) ?? undefined;
          if (target) {
            state.targets.set(pageContent, target);
          }
        }
        if (!target) {
          pageContent.style.removeProperty('--templar-paper-baseline-position');
          continue;
        }
        nextObserved.add(target.element);
        const contentRect = pageContent.getBoundingClientRect();
        const targetRect = target.element.getBoundingClientRect();
        const targetStyle = view.getComputedStyle(target.element);
        const scale = measuredGeometryScale(
          contentRect.width,
          pageContent.offsetWidth,
          1,
        );
        const origin = round(
          measuredPaperOrigin(
            contentRect.top,
            targetRect.top,
            scale,
            Number.parseFloat(targetStyle.paddingTop) || 0,
            Number.parseFloat(targetStyle.borderTopWidth) || 0,
            target.metric.baseline,
            style.baseline.unit,
          ),
        );
        const previous = Number.parseFloat(
          pageContent.style.getPropertyValue('--templar-paper-baseline-position'),
        );
        if (!Number.isFinite(previous) || Math.abs(previous - origin) >= 0.01) {
          pageContent.style.setProperty(
            '--templar-paper-baseline-position',
            `${String(origin)}px`,
          );
        }
      }
      for (const previous of state.observedElements) {
        if (!nextObserved.has(previous)) {
          state.resizeObserver.unobserve(previous);
        }
      }
      for (const element of nextObserved) {
        if (!state.observedElements.has(element)) {
          state.resizeObserver.observe(element);
        }
      }
      state.observedElements = nextObserved;
      state.pageContents = nextPageContents;
    };
    const scheduleFrame = (): void => {
      if (state.frame !== null) {
        return;
      }
      state.frame = view.requestAnimationFrame(() => {
        state.frame = null;
        scan();
      });
    };
    state = {
      frame: null,
      mutationObserver: new MutationObserver(scheduleFrame),
      observedElements: new Set(),
      pageContents,
      resizeObserver: new ResizeObserver(scheduleFrame),
      targets: new Map(),
      view,
    };
    state.mutationObserver.observe(contentEl, {
      attributeFilter: ['aria-expanded', 'class', 'data-mode'],
      attributes: true,
      childList: true,
      subtree: true,
    });
    this.paperOriginObservers.set(leaf, state);
    scan();
  }

  private disconnectPaperOrigin(leaf: WorkspaceLeaf): void {
    const state = this.paperOriginObservers.get(leaf);
    if (!state) {
      return;
    }
    if (state.frame !== null) {
      state.view.cancelAnimationFrame(state.frame);
    }
    state.resizeObserver.disconnect();
    state.mutationObserver.disconnect();
    for (const pageContent of state.pageContents) {
      pageContent.style.removeProperty('--templar-paper-baseline-position');
    }
    this.paperOriginObservers.delete(leaf);
  }

  private configureVariableBlockSnapping(
    leaf: WorkspaceLeaf,
    contentEl: HTMLElement,
    style: TemplarNoteStyle,
  ): void {
    this.disconnectVariableBlockSnapping(leaf);
    this.clearVariableBlockSnapping(contentEl);

    const view = contentEl.ownerDocument.defaultView;
    const enabled =
      style.baseline.enabled &&
      style.baseline.mode !== 'free' &&
      view !== null &&
      typeof ResizeObserver !== 'undefined' &&
      typeof MutationObserver !== 'undefined';
    if (!enabled || !view) {
      return;
    }

    const update = (block: HTMLElement, measuredHeight?: number): void => {
      const marginTail = block.matches('table, iframe, object, video, audio, canvas');
      const computed = view.getComputedStyle(block);
      if (!block.style.getPropertyValue('--templar-grid-natural-margin-end')) {
        block.style.setProperty(
          '--templar-grid-natural-margin-end',
          computed.marginBlockEnd || computed.marginBottom || '0px',
        );
      }
      block.addClass('templar-grid-snap-block');
      const previous = Number.parseFloat(
        block.style.getPropertyValue('--templar-grid-snap'),
      ) || 0;
      // ResizeObserver border-box sizes are precise, untransformed CSS pixels.
      // Subtract our owned tail so every pass measures the natural block and
      // cannot feed its previous correction back into the next calculation.
      const naturalHeight = naturalOuterFootprint(
        measuredHeight ?? block.offsetHeight,
        Number.parseFloat(computed.marginBlockStart || computed.marginTop) || 0,
        Number.parseFloat(
          block.style.getPropertyValue('--templar-grid-natural-margin-end'),
        ) || 0,
        previous,
        !marginTail,
      );
      if (naturalHeight <= 0) {
        return;
      }
      const compensation = round(
        gridCompensation(naturalHeight, style.baseline.unit),
      );
      if (Math.abs(compensation - previous) < 0.01) {
        return;
      }
      block.style.setProperty('--templar-grid-snap', `${String(compensation)}px`);
    };
    let state: RhythmObservationState;
    let scanBlocks: () => void;
    const flush = (): void => {
      state.frame = null;
      if (state.needsScan) {
        state.needsScan = false;
        scanBlocks();
      }
      const pending = Array.from(state.pendingMeasurements.entries());
      state.pendingMeasurements.clear();
      for (const [block, measuredHeight] of pending) {
        if (state.observedBlocks.has(block) && block.isConnected) {
          update(block, measuredHeight);
        }
      }
    };
    const scheduleFrame = (): void => {
      if (state.frame === null) {
        state.frame = view.requestAnimationFrame(flush);
      }
    };
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (!entry.target.instanceOf(HTMLElement)) {
          continue;
        }
        const borderBox = entry.borderBoxSize[0];
        state.pendingMeasurements.set(
          entry.target,
          borderBox?.blockSize ?? entry.contentRect.height,
        );
      }
      scheduleFrame();
    });
    state = {
      frame: null,
      mutationObserver: new MutationObserver(() => {
        state.needsScan = true;
        scheduleFrame();
      }),
      needsScan: false,
      observedBlocks: new Set(),
      pendingMeasurements: new Map(),
      resizeObserver,
      view,
    };
    scanBlocks = (): void => {
      const nextBlocks = new Set<HTMLElement>();
      const selector = VARIABLE_BLOCK_SELECTORS
        .map((candidate) => `.${TEMPLAR_PAGE_CLASS} ${candidate}`)
        .join(',');
      for (const element of contentEl.querySelectorAll<HTMLElement>(selector)) {
        const owner = this.variableBlockOwner(element);
        if (owner) {
          nextBlocks.add(owner);
        }
      }
      for (const block of state.observedBlocks) {
        if (nextBlocks.has(block)) {
          continue;
        }
        resizeObserver.unobserve(block);
        state.pendingMeasurements.delete(block);
        block.removeClass('templar-grid-snap-block');
        block.style.removeProperty('--templar-grid-snap');
        block.style.removeProperty('--templar-grid-natural-margin-end');
      }
      for (const block of nextBlocks) {
        if (!state.observedBlocks.has(block)) {
          resizeObserver.observe(block);
        }
        update(block);
      }
      state.observedBlocks = nextBlocks;
    };
    state.mutationObserver.observe(contentEl, { childList: true, subtree: true });
    this.rhythmObservers.set(leaf, state);
    scanBlocks();
  }

  private variableBlockOwner(element: HTMLElement): HTMLElement | null {
    if (element.closest('.mod-frontmatter, .metadata-container')) {
      return null;
    }
    const editorWidget = element.closest<HTMLElement>(
      '.cm-table-widget, .cm-embed-block',
    );
    if (editorWidget) {
      return editorWidget;
    }
    const readingRoot = element.closest<HTMLElement>('.markdown-preview-section');
    if (readingRoot) {
      // A post-processor section is a direct child of the Reading root. The
      // root itself may contain the whole note, so observing it makes every
      // table/callout share one correction and creates an observer feedback
      // loop. Walk only to the candidate's renderer-owned block wrapper.
      let owner = element;
      while (owner.parentElement && owner.parentElement !== readingRoot) {
        owner = owner.parentElement;
      }
      return owner === readingRoot ? element : owner;
    }
    return element.closest(`.${TEMPLAR_PAGE_CLASS}`) ? element : null;
  }

  private disconnectVariableBlockSnapping(leaf: WorkspaceLeaf): void {
    const state = this.rhythmObservers.get(leaf);
    if (!state) {
      return;
    }
    if (state.frame !== null) {
      state.view.cancelAnimationFrame(state.frame);
    }
    state.resizeObserver.disconnect();
    state.mutationObserver.disconnect();
    this.rhythmObservers.delete(leaf);
  }

  private clearVariableBlockSnapping(contentEl: HTMLElement): void {
    for (const block of contentEl.querySelectorAll<HTMLElement>(
      '.templar-grid-snap-block',
    )) {
      block.removeClass('templar-grid-snap-block');
      block.style.removeProperty('--templar-grid-snap');
      block.style.removeProperty('--templar-grid-natural-margin-end');
    }
  }

  private clearLeaf(leaf: WorkspaceLeaf): void {
    this.leafGenerations.set(leaf, (this.leafGenerations.get(leaf) ?? 0) + 1);
    this.pageLayout.clear(leaf);
    if (!(leaf.view instanceof MarkdownView) || !leaf.view.file) {
      this.previews.delete(leaf);
    }
    const styled = this.styledViews.get(leaf);
    const contentEl =
      styled?.contentEl ??
      (leaf.view instanceof MarkdownView ? leaf.view.contentEl : undefined);
    this.disconnectPaperOrigin(leaf);
    if (contentEl) {
      contentEl.removeClass(TEMPLAR_CLASS);
      delete contentEl.dataset.templarScope;
      delete contentEl.dataset.templarFile;
      delete contentEl.dataset.templarMode;
      contentEl
        .querySelector(`:scope > style.${TEMPLAR_STYLE_ELEMENT_CLASS}`)
        ?.remove();
      for (const element of contentEl.querySelectorAll(`.${TEMPLAR_PAGE_CLASS}`)) {
        element.removeClass(TEMPLAR_PAGE_CLASS);
      }
      for (const element of contentEl.querySelectorAll(`.${TEMPLAR_CONTENT_CLASS}`)) {
        element.removeClass(TEMPLAR_CONTENT_CLASS);
      }
      for (const image of contentEl.querySelectorAll<HTMLElement>('img')) {
        image.style.removeProperty('--templar-image-snap');
      }
      this.clearVariableBlockSnapping(contentEl);
      for (const spacer of contentEl.querySelectorAll('.templar-blank-line-spacer')) {
        spacer.remove();
      }
      for (const section of contentEl.querySelectorAll('.templar-reading-section')) {
        section.removeClass('templar-reading-section');
      }
    }
    this.imageObservers.get(leaf)?.resizeObserver.disconnect();
    this.imageObservers.get(leaf)?.mutationObserver.disconnect();
    this.imageObservers.delete(leaf);
    this.disconnectVariableBlockSnapping(leaf);
    this.pruneDisconnectedReadingRoots();
    if (styled) {
      this.issuesByFile.delete(styled.filePath);
    }
    this.styledViews.delete(leaf);
  }

  private scheduleReadingWhitespace(readingRoot: HTMLElement): void {
    if (!this.settings.enableReadingView || !readingRoot.hasClass(TEMPLAR_PAGE_CLASS)) {
      this.clearReadingWhitespaceRoot(readingRoot);
      return;
    }
    if (this.scheduledReadingRoots.has(readingRoot)) {
      return;
    }
    const view = readingRoot.ownerDocument.defaultView;
    if (!view) {
      return;
    }
    // Style changes and cached-view reuse do not re-run post-processors, so
    // reconcile once in the next frame. The spacers live inside section
    // elements, so this pass can no longer be wiped by Obsidian's
    // setChildrenInPlace calls.
    const frame = view.requestAnimationFrame(() => {
      this.scheduledReadingRoots.delete(readingRoot);
      if (
        !this.destroyed &&
        this.settings.enableReadingView &&
        readingRoot.isConnected &&
        readingRoot.hasClass(TEMPLAR_PAGE_CLASS)
      ) {
        this.reconcileReadingWhitespace(readingRoot);
      } else if (!readingRoot.isConnected) {
        this.readingRoots.delete(readingRoot);
      }
    });
    this.scheduledReadingRoots.set(readingRoot, frame);
  }

  private rootState(readingRoot: HTMLElement): ReadingRootState {
    let state = this.readingRoots.get(readingRoot);
    if (!state) {
      state = { bodyStartLine: 0, context: null, filePath: null, sections: [] };
      this.readingRoots.set(readingRoot, state);
    }
    return state;
  }

  private clearReadingWhitespaceRoot(readingRoot: HTMLElement): void {
    const frame = this.scheduledReadingRoots.get(readingRoot);
    if (frame !== undefined) {
      readingRoot.ownerDocument.defaultView?.cancelAnimationFrame(frame);
      this.scheduledReadingRoots.delete(readingRoot);
    }
    const state = this.readingRoots.get(readingRoot);
    for (const section of state?.sections ?? []) {
      section.removeClass('templar-reading-section');
      this.readingSections.delete(section);
    }
    for (const spacer of readingRoot.querySelectorAll('.templar-blank-line-spacer')) {
      spacer.remove();
    }
    this.readingRoots.delete(readingRoot);
  }

  private retargetReadingRoot(
    readingRoot: HTMLElement,
    state: ReadingRootState,
    filePath: string,
    bodyStartLine: number,
  ): void {
    if (!readingRootNeedsRetarget(state.filePath, filePath)) {
      state.bodyStartLine = bodyStartLine;
      return;
    }
    // Obsidian normally reuses the same Reading root as a leaf opens another
    // note. A post-processor context belongs to its source file, so retaining
    // it makes every section in the new note look stale and removes all gaps.
    for (const section of state.sections) {
      section.removeClass('templar-reading-section');
      this.readingSections.delete(section);
    }
    for (const spacer of readingRoot.querySelectorAll('.templar-blank-line-spacer')) {
      spacer.remove();
    }
    state.context = null;
    state.bodyStartLine = bodyStartLine;
    state.filePath = filePath;
    state.sections = [];
  }

  private bodyStartLine(file: TFile): number {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatterPosition;
    return bodyStartLineAfterFrontmatter(frontmatter?.end.line);
  }

  private pruneDisconnectedReadingRoots(): void {
    for (const root of this.readingRoots.keys()) {
      if (root.isConnected) {
        continue;
      }
      const frame = this.scheduledReadingRoots.get(root);
      if (frame !== undefined) {
        root.ownerDocument.defaultView?.cancelAnimationFrame(frame);
        this.scheduledReadingRoots.delete(root);
      }
      this.readingRoots.delete(root);
    }
  }

  private sectionInfo(
    state: ReadingRootState,
    element: HTMLElement,
  ): ReadingSectionInfo | null {
    const fresh = state.context?.getSectionInfo(element);
    if (fresh) {
      return fresh;
    }
    return this.readingSections.get(element) ?? null;
  }

  /**
   * A section element is alive when Obsidian's renderer still knows it.
   * Discarded elements (replaced by a re-parse) must not participate in gap
   * chains, or their stale positions would shift the spacers of live ones.
   */
  private isAliveSection(state: ReadingRootState, element: HTMLElement): boolean {
    if (state.context) {
      return state.context.getSectionInfo(element) !== null;
    }
    return this.readingSections.has(element);
  }

  private registerCachedReadingSections(
    readingRoot: HTMLElement,
    file: TFile,
  ): void {
    const state = this.rootState(readingRoot);
    this.retargetReadingRoot(
      readingRoot,
      state,
      file.path,
      this.bodyStartLine(file),
    );
    // Fresh post-processor ranges include the full Markdown source and are
    // strictly better than the metadata fallback. Do not replace them.
    if (state.context) {
      return;
    }
    const pageContent = readingRoot.querySelector<HTMLElement>(
      ':scope > .markdown-preview-sizer',
    );
    const cachedSections = this.app.metadataCache
      .getFileCache(file)
      ?.sections?.filter((section) => section.type !== 'yaml');
    if (!pageContent || !cachedSections) {
      return;
    }
    const renderedBlocks = Array.from(pageContent.children).filter(
      (element): element is HTMLElement =>
        element.instanceOf(HTMLElement) &&
        !element.matches(
          '.markdown-preview-pusher, .mod-header, .mod-ui, .templar-blank-line-spacer',
        ),
    );
    // SectionCache is the stable source of truth even when Obsidian reuses a
    // cached Reading View and therefore does not invoke postprocessors again.
    // Only install a mapping when the complete top-level sequences agree; a
    // partial mapping would put a later source gap before the wrong DOM block.
    if (renderedBlocks.length !== cachedSections.length) {
      return;
    }
    state.sections = renderedBlocks;
    for (let index = 0; index < renderedBlocks.length; index += 1) {
      const element = renderedBlocks[index];
      const section = cachedSections[index];
      if (!element || !section) {
        continue;
      }
      this.readingSections.set(element, {
        lineStart: section.position.start.line,
        lineEnd: section.position.end.line,
        text: '',
      });
      element.addClass('templar-reading-section');
    }
  }

  /**
   * Reconciles the owned blank-line spacers of a Reading View. Runs inside
   * the post-processor (synchronously, before Obsidian attaches the section,
   * measures heights, and paints) and as a deferred pass for style changes.
   *
   * Inter-section spacers are inserted as the first child of the section
   * below the gap. Obsidian's virtual scroller only manages the sizer's
   * direct children via setChildrenInPlace, so spacers inside section
   * elements survive every render pass, scroll, and detach cycle.
   */
  private reconcileReadingWhitespace(
    readingRoot: HTMLElement,
    current?: HTMLElement,
  ): void {
    const state = this.rootState(readingRoot);
    if (
      !hasReadingWhitespaceWork(
        Boolean(state.context),
        Boolean(current),
        state.sections.length,
      )
    ) {
      return;
    }
    if (current && !state.sections.includes(current)) {
      state.sections.push(current);
    }
    const aliveSections = state.sections.filter((element) =>
      this.isAliveSection(state, element)
    );
    state.sections = aliveSections;
    const sections = aliveSections
      .filter(
        (element) =>
          !element.parentElement?.closest('.templar-reading-section'),
      );
    sections.sort((left, right) => {
      const leftStart = this.sectionInfo(state, left)?.lineStart ?? 0;
      const rightStart = this.sectionInfo(state, right)?.lineStart ?? 0;
      return leftStart - rightStart;
    });

    if (current) {
      const range = this.sectionInfo(state, current);
      if (range) {
        this.insertInternalWhitespace(state, current, range);
      }
    }
    const firstSection = sections[0];
    if (firstSection) {
      this.reconcileLeadingSpacer(state, firstSection);
    }
    for (let index = 1; index < sections.length; index += 1) {
      this.reconcileGapSpacer(state, sections[index - 1]!, sections[index]!);
    }
  }

  private reconcileLeadingSpacer(
    state: ReadingRootState,
    firstSection: HTMLElement,
  ): void {
    const firstInfo = this.sectionInfo(state, firstSection);
    if (!firstInfo || firstSection.firstElementChild === null) {
      return;
    }
    const count = blankLinesBeforeFirstSection(
      state.bodyStartLine,
      firstInfo.lineStart,
      firstInfo.text,
    );
    const firstChild = firstSection.firstElementChild;
    const hasSpacer = firstChild.hasClass('templar-blank-line-spacer');
    if (count <= 0) {
      if (hasSpacer) {
        firstChild.remove();
      }
      return;
    }
    if (hasSpacer) {
      (firstChild as HTMLElement).style.setProperty(
        '--templar-blank-lines',
        String(count),
      );
      return;
    }
    firstSection.prepend(
      createBlankLineSpacer(firstSection.ownerDocument, count),
    );
  }

  private reconcileGapSpacer(
    state: ReadingRootState,
    previous: HTMLElement,
    current: HTMLElement,
  ): void {
    const previousInfo = this.sectionInfo(state, previous);
    const currentInfo = this.sectionInfo(state, current);
    if (!previousInfo || !currentInfo) {
      return;
    }
    const count = blankLinesBetweenSections(
      previousInfo.lineEnd,
      currentInfo.lineStart,
      currentInfo.text || previousInfo.text,
    );
    // Only touch sections Obsidian has already rendered: inserting before the
    // parsed html node would change the first-child that render() inspects.
    if (current.firstElementChild === null) {
      return;
    }
    const firstChild = current.firstElementChild;
    const hasSpacer = firstChild.hasClass('templar-blank-line-spacer');
    if (count <= 0) {
      if (hasSpacer) {
        firstChild.remove();
      }
      return;
    }
    if (hasSpacer) {
      (firstChild as HTMLElement).style.setProperty(
        '--templar-blank-lines',
        String(Math.max(1, count)),
      );
      return;
    }
    current.prepend(createBlankLineSpacer(current.ownerDocument, count));
  }

  private insertInternalWhitespace(
    state: ReadingRootState,
    section: HTMLElement,
    range: ReadingSectionInfo,
  ): void {
    // context.getSectionInfo() exposes the whole note text; the section's own
    // source is the line slice between its boundaries.
    const lines = range.text.split('\n');
    const markdown =
      range.lineStart <= range.lineEnd && range.lineEnd < lines.length
        ? lines.slice(range.lineStart, range.lineEnd + 1).join('\n')
        : range.text;
    const blocks = Array.from(section.children).filter(
      (element): element is HTMLElement =>
        element.instanceOf(HTMLElement) &&
        !element.hasClass('templar-blank-line-spacer') &&
        !element.matches('.metadata-container, .mod-ui'),
    );
    // The first spacer child is the inter-section gap owned by reconcileGapSpacer.
    for (let index = 1; index < section.children.length; index += 1) {
      const child = section.children[index];
      if (child?.hasClass?.('templar-blank-line-spacer')) {
        child.remove();
      }
    }
    if (blocks.length < 2) {
      return;
    }
    const mappedRanges = blocks.map((block) => state.context?.getSectionInfo(block) ?? null);
    const exactMapping = mappedRanges.every(
      (mapped, index) =>
        mapped !== null &&
        (index === 0 || mapped.lineStart > mappedRanges[index - 1]!.lineStart),
    );
    const runs = exactMapping
      ? mappedRanges.slice(1).map((mapped, index) =>
          blankLinesBetweenSections(
            mappedRanges[index]!.lineEnd,
            mapped!.lineStart,
            mapped!.text,
          ),
        )
      : internalBlankLineRuns(markdown);
    if (runs.length !== blocks.length - 1) {
      return;
    }
    for (let index = runs.length - 1; index >= 0; index -= 1) {
      const nextBlock = blocks[index + 1];
      const count = runs[index];
      if (nextBlock && count) {
        section.insertBefore(
          createBlankLineSpacer(section.ownerDocument, count),
          nextBlock,
        );
      }
    }
  }
}
