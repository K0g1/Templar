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
import { FontMetricsService } from './font-metrics';
import type { FrontmatterService } from './frontmatter';
import { PageLayoutService } from './page-layout';
import {
  blankLinesBetweenSections,
  createBlankLineSpacer,
  internalBlankLineRuns,
  type ReadingSectionRange,
} from './reading-whitespace';
import { compilePageStyle } from './style-compiler';

interface StyledView {
  contentEl: HTMLElement;
  filePath: string;
}

interface ImageObservationState {
  mutationObserver: MutationObserver;
  observedImages: Set<HTMLElement>;
  resizeObserver: ResizeObserver;
}

export class PageRenderer {
  private destroyed = false;
  private scheduled = false;
  private readonly leafGenerations = new Map<WorkspaceLeaf, number>();
  private readonly styledViews = new Map<WorkspaceLeaf, StyledView>();
  private readonly imageObservers = new Map<WorkspaceLeaf, ImageObservationState>();
  private readonly issuesByFile = new Map<string, ValidationIssue[]>();
  private readonly pageLayout = new PageLayoutService();
  private readonly readingSections = new WeakMap<HTMLElement, ReadingSectionRange>();
  private readonly scheduledReadingRoots = new Map<HTMLElement, number>();

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

  public issuesFor(file: TFile): ValidationIssue[] {
    return [...(this.issuesByFile.get(file.path) ?? [])];
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
    const info = context.getSectionInfo(element);
    const readingRoot = element.closest<HTMLElement>('.markdown-preview-view');
    if (!info || !readingRoot) {
      return;
    }
    this.readingSections.set(element, {
      lineStart: info.lineStart,
      lineEnd: info.lineEnd,
      text: info.text,
    });
    element.addClass('templar-reading-section');
    if (this.frontmatter.hasStyle(file)) {
      this.scheduleReadingWhitespace(readingRoot);
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
    this.pageLayout.destroy();
    for (const leaf of [...this.styledViews.keys()]) {
      this.clearLeaf(leaf);
    }
    this.fontMetrics.clear();
    this.leafGenerations.clear();
    this.issuesByFile.clear();
  }

  private async refreshLeaf(leaf: WorkspaceLeaf): Promise<void> {
    if (this.destroyed) {
      return;
    }
    if (!(leaf.view instanceof MarkdownView)) {
      this.clearLeaf(leaf);
      return;
    }
    const view = leaf.view;
    const file = view.file;
    const style = file ? this.frontmatter.getStyle(file) : null;
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
    // Markdown postprocessors run before Obsidian finishes committing a Reading
    // View section. A microtask is still inside that commit and any spacer added
    // there is discarded. Reconcile in the next rendering frame, after every
    // section wrapper and source range is stable in the live DOM.
    const frame = view.requestAnimationFrame(() => {
      this.scheduledReadingRoots.delete(readingRoot);
      if (!this.destroyed && readingRoot.isConnected) {
        this.reconcileReadingWhitespace(readingRoot);
      }
    });
    this.scheduledReadingRoots.set(readingRoot, frame);
  }

  private registerCachedReadingSections(
    readingRoot: HTMLElement,
    file: TFile,
  ): void {
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

  private reconcileReadingWhitespace(readingRoot: HTMLElement): void {
    for (const spacer of readingRoot.querySelectorAll('.templar-blank-line-spacer')) {
      spacer.remove();
    }
    const sections = Array.from(
      readingRoot.querySelectorAll<HTMLElement>('.templar-reading-section'),
    )
      .filter((element) => this.readingSections.has(element))
      .filter(
        (element) =>
          !element.parentElement?.closest('.templar-reading-section'),
      )
      .sort(
        (left, right) =>
          (this.readingSections.get(left)?.lineStart ?? 0) -
          (this.readingSections.get(right)?.lineStart ?? 0),
      );

    for (const section of sections) {
      const range = this.readingSections.get(section);
      if (range) {
        this.insertInternalWhitespace(section, range.text);
      }
    }
    for (let index = 1; index < sections.length; index += 1) {
      const previous = this.readingSections.get(sections[index - 1]!);
      const currentElement = sections[index]!;
      const current = this.readingSections.get(currentElement);
      if (!previous || !current) {
        continue;
      }
      const count = blankLinesBetweenSections(previous.lineEnd, current.lineStart);
      if (count > 0 && currentElement.parentElement) {
        currentElement.parentElement.insertBefore(
          createBlankLineSpacer(currentElement.ownerDocument, count),
          currentElement,
        );
      }
    }
  }

  private insertInternalWhitespace(section: HTMLElement, markdown: string): void {
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
