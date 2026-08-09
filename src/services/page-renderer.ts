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
import { imageGridCompensation } from '../utils/grid';
import { escapeCssAttribute, round } from '../utils/value';
import { clone } from '../utils/value';
import { FontMetricsService } from './font-metrics';
import type { FrontmatterService } from './frontmatter';
import { PageLayoutService } from './page-layout';
import {
  blankLinesBetweenSections,
  createBlankLineSpacer,
  internalBlankLineRuns,
} from './reading-whitespace';
import { compilePageStyle } from './style-compiler';

interface StyledView {
  contentEl: HTMLElement;
  filePath: string;
}

interface ReadingRootState {
  context: MarkdownPostProcessorContext | null;
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

interface PreviewState {
  owner: string;
  filePath: string;
  style: TemplarNoteStyle;
}

export class PageRenderer {
  private destroyed = false;
  private scheduled = false;
  private readonly leafGenerations = new WeakMap<WorkspaceLeaf, number>();
  private readonly styledViews = new Map<WorkspaceLeaf, StyledView>();
  private readonly imageObservers = new Map<WorkspaceLeaf, ImageObservationState>();
  private readonly issuesByFile = new Map<string, ValidationIssue[]>();
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
    state.context = context;
    if (!state.sections.includes(element)) {
      state.sections.push(element);
    }
    this.readingSections.set(element, {
      lineStart: info.lineStart,
      lineEnd: info.lineEnd,
      text: info.text,
    });
    element.addClass('templar-reading-section');
    if (this.frontmatter.hasStyle(file)) {
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
    for (const [root, frame] of this.scheduledReadingRoots) {
      root.ownerDocument.defaultView?.cancelAnimationFrame(frame);
    }
    this.scheduledReadingRoots.clear();
    this.readingRoots.clear();
    this.pageLayout.destroy();
    this.previews.clear();
    for (const leaf of [...this.styledViews.keys()]) {
      this.clearLeaf(leaf);
    }
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
    const metrics = await this.fontMetrics.measurePage(style, document);
    if (
      this.destroyed ||
      this.leafGenerations.get(leaf) !== run ||
      view.file?.path !== file.path
    ) {
      return;
    }

    this.prepareViewRoots(view.contentEl);
    const scopeId = hashPath(file.path);
    const scopeValue = `templar-${scopeId}`;
    view.contentEl.addClass(TEMPLAR_CLASS);
    view.contentEl.dataset.templarScope = scopeValue;
    view.contentEl.dataset.templarFile = file.path;
    const scope = `[data-templar-scope="${escapeCssAttribute(scopeValue)}"]`;
    const compiled = compilePageStyle(style, scope, scopeId, metrics);
    this.issuesByFile.set(file.path, compiled.issues);

    const styleEl = this.getOrCreateStyleElement(view.contentEl);
    styleEl.textContent = compiled.css;
    this.styledViews.set(leaf, { contentEl: view.contentEl, filePath: file.path });
    this.configureImageSnapping(leaf, view.contentEl, style);
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
      const compensation = imageGridCompensation(height, style.baseline.unit);
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
    if (contentEl) {
      contentEl.removeClass(TEMPLAR_CLASS);
      delete contentEl.dataset.templarScope;
      delete contentEl.dataset.templarFile;
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
      for (const spacer of contentEl.querySelectorAll('.templar-blank-line-spacer')) {
        spacer.remove();
      }
    }
    this.imageObservers.get(leaf)?.resizeObserver.disconnect();
    this.imageObservers.get(leaf)?.mutationObserver.disconnect();
    this.imageObservers.delete(leaf);
    this.pruneDisconnectedReadingRoots();
    if (styled) {
      this.issuesByFile.delete(styled.filePath);
    }
    this.styledViews.delete(leaf);
  }

  private scheduleReadingWhitespace(readingRoot: HTMLElement): void {
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
      if (!this.destroyed && readingRoot.isConnected) {
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
      state = { context: null, sections: [] };
      this.readingRoots.set(readingRoot, state);
    }
    return state;
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
    if (!state.context && !current) {
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
    for (let index = 1; index < sections.length; index += 1) {
      this.reconcileGapSpacer(state, sections[index - 1]!, sections[index]!);
    }
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
    const runs = internalBlankLineRuns(markdown);
    if (blocks.length < 2 || runs.length !== blocks.length - 1) {
      return;
    }
    // The first spacer child is the inter-section gap owned by reconcileGapSpacer.
    for (let index = 1; index < section.children.length; index += 1) {
      const child = section.children[index];
      if (child?.hasClass?.('templar-blank-line-spacer')) {
        child.remove();
      }
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

function hashPath(path: string): string {
  let hash = 2166136261;
  for (let index = 0; index < path.length; index += 1) {
    hash ^= path.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
