import {
  TFile,
  type App,
  type MarkdownPostProcessorContext,
} from 'obsidian';
import { TEMPLAR_PAGE_CLASS } from '../../constants';
import {
  blankLinesBeforeFirstSection,
  blankLinesBetweenSections,
  bodyStartLineAfterFrontmatter,
  createBlankLineSpacer,
  hasReadingWhitespaceWork,
  internalBlankLineRuns,
  readingRootNeedsRetarget,
} from '../reading-whitespace';
import { ReadingRootRegistry } from './reading-root-registry';
import type { PerformanceMonitor } from '../../performance/performance-monitor';

interface ReadingSectionInfo {
  lineStart: number;
  lineEnd: number;
  text: string;
}

interface ReadingRootState {
  bodyStartLine: number;
  context: MarkdownPostProcessorContext | null;
  filePath: string | null;
  sections: HTMLElement[];
  orderedSections: HTMLElement[];
  topLevelSections: HTMLElement[];
  active: boolean;
}

/** Owns Reading View section metadata, spacer reconciliation, and root cleanup. */
export class ReadingWhitespaceController {
  private destroyed = false;
  private readonly readingSections = new WeakMap<HTMLElement, ReadingSectionInfo>();
  private readonly readingRoots = new ReadingRootRegistry<ReadingRootState>();
  private readonly scheduledRoots = new Map<HTMLElement, number>();

  public constructor(
    private readonly app: App,
    private readonly isEnabled: () => boolean,
    private readonly performanceMonitor?: PerformanceMonitor,
  ) {}

  public registerSection(
    element: HTMLElement,
    context: MarkdownPostProcessorContext,
  ): void {
    this.performanceMonitor?.counter('reading.registerSection.count');
    const file = this.app.vault.getAbstractFileByPath(context.sourcePath);
    if (this.destroyed || !this.isEnabled() || !(file instanceof TFile)) return;
    this.pruneDisconnectedRoots();
    const info = context.getSectionInfo(element);
    const readingRoot = element.closest<HTMLElement>('.markdown-preview-view');
    if (!info || !readingRoot) return;
    const state = this.rootState(readingRoot);
    this.retargetRoot(readingRoot, state, context.sourcePath, this.bodyStartLine(file));
    state.context = context;
    if (!state.sections.includes(element)) state.sections.push(element);
    this.readingSections.set(element, {
      lineStart: info.lineStart,
      lineEnd: info.lineEnd,
      text: info.text,
    });
    if (state.active) {
      element.addClass('templar-reading-section');
      // Reconcile inside the post-processor so Obsidian measures the spacer
      // before the first paint and before its virtual scroller caches height.
      this.reconcileIncremental(readingRoot, state, element);
    }
  }

  public activateRoot(readingRoot: HTMLElement, file: TFile): void {
    this.performanceMonitor?.counter('reading.activateRoot.count');
    if (this.destroyed || !this.isEnabled()) return;
    const state = this.rootState(readingRoot);
    this.retargetRoot(readingRoot, state, file.path, this.bodyStartLine(file));
    state.active = true;
    const aliveSections: HTMLElement[] = [];
    for (const section of state.sections) {
      const fresh = state.context?.getSectionInfo(section) ?? this.readingSections.get(section);
      if (!fresh || !section.isConnected) continue;
      this.readingSections.set(section, fresh);
      aliveSections.push(section);
      section.addClass('templar-reading-section');
    }
    state.sections = aliveSections;
    this.rebuildOrdering(state);
    for (const section of state.topLevelSections) {
      const range = this.sectionInfo(state, section);
      if (range) this.insertInternalWhitespace(state, section, range);
    }
    const firstSection = state.topLevelSections[0];
    if (firstSection) this.reconcileLeadingSpacer(state, firstSection);
    for (let index = 1; index < state.topLevelSections.length; index += 1) {
      this.reconcileGapSpacer(state, state.topLevelSections[index - 1]!, state.topLevelSections[index]!);
    }
    this.schedule(readingRoot);
  }

  public deactivateRoot(readingRoot: HTMLElement): void {
    this.performanceMonitor?.counter('reading.deactivateRoot.count');
    const state = this.readingRoots.get(readingRoot);
    if (!state) return;
    state.active = false;
    this.cancelScheduled(readingRoot);
    for (const section of state.sections) section.removeClass('templar-reading-section');
    readingRoot.querySelectorAll('.templar-blank-line-spacer').forEach((spacer) => spacer.remove());
  }

  public prepareCachedSections(readingRoot: HTMLElement, file: TFile): void {
    this.performanceMonitor?.counter('reading.prepareCachedSections.count');
    const state = this.rootState(readingRoot);
    this.retargetRoot(readingRoot, state, file.path, this.bodyStartLine(file));
    if (state.context) return;
    const pageContent = readingRoot.querySelector<HTMLElement>(
      ':scope > .markdown-preview-sizer',
    );
    const cachedSections = this.app.metadataCache
      .getFileCache(file)
      ?.sections?.filter((section) => section.type !== 'yaml');
    if (!pageContent || !cachedSections) return;
    const renderedBlocks = Array.from(pageContent.children).filter(
      (element): element is HTMLElement =>
        isOwnedHTMLElement(element) &&
        !element.matches('.markdown-preview-pusher, .mod-header, .mod-ui, .templar-blank-line-spacer'),
    );
    if (renderedBlocks.length !== cachedSections.length) return;
    state.sections = renderedBlocks;
    state.orderedSections = [];
    state.topLevelSections = [];
    for (let index = 0; index < renderedBlocks.length; index += 1) {
      const element = renderedBlocks[index];
      const section = cachedSections[index];
      if (!element || !section) continue;
      this.readingSections.set(element, {
        lineStart: section.position.start.line,
        lineEnd: section.position.end.line,
        text: '',
      });
      if (state.active) element.addClass('templar-reading-section');
    }
  }

  public schedule(readingRoot: HTMLElement): void {
    this.performanceMonitor?.counter('reading.schedule.attempt');
    const state = this.readingRoots.get(readingRoot);
    if (!this.isEnabled() || !readingRoot.hasClass(TEMPLAR_PAGE_CLASS) || !state?.active) {
      this.deactivateRoot(readingRoot);
      return;
    }
    if (this.scheduledRoots.has(readingRoot)) {
      this.performanceMonitor?.counter('reading.schedule.dedupe');
      return;
    }
    const view = readingRoot.ownerDocument.defaultView;
    if (!view) return;
    const frame = view.requestAnimationFrame(() => {
      this.scheduledRoots.delete(readingRoot);
      this.performanceMonitor?.counter('reading.raf.execute');
      if (
        !this.destroyed &&
        this.isEnabled() &&
        this.readingRoots.get(readingRoot)?.active === true &&
        readingRoot.isConnected &&
        readingRoot.hasClass(TEMPLAR_PAGE_CLASS)
      ) {
        this.reconcile(readingRoot);
      } else if (!readingRoot.isConnected) {
        this.readingRoots.delete(readingRoot);
      }
    });
    this.scheduledRoots.set(readingRoot, frame);
  }

  public clearRoot(readingRoot: HTMLElement): void {
    this.cancelScheduled(readingRoot);
    const state = this.readingRoots.get(readingRoot);
    for (const section of state?.sections ?? []) {
      section.removeClass('templar-reading-section');
      this.readingSections.delete(section);
    }
    readingRoot.querySelectorAll('.templar-blank-line-spacer').forEach((spacer) => spacer.remove());
    this.readingRoots.delete(readingRoot);
    this.updateGauges();
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const root of [...this.readingRoots.keys()]) this.clearRoot(root);
    this.scheduledRoots.clear();
  }

  public pruneDisconnected(): void {
    this.pruneDisconnectedRoots();
  }

  public snapshot(): Record<string, number> {
    return {
      roots: this.rootCount(),
      scheduledRoots: this.scheduledRoots.size,
    };
  }

  private rootState(readingRoot: HTMLElement): ReadingRootState {
    let state = this.readingRoots.get(readingRoot);
    if (!state) {
      state = {
        bodyStartLine: 0,
        context: null,
        filePath: null,
        sections: [],
        orderedSections: [],
        topLevelSections: [],
        active: false,
      };
      this.readingRoots.set(readingRoot, state);
    }
    return state;
  }

  private retargetRoot(
    readingRoot: HTMLElement,
    state: ReadingRootState,
    filePath: string,
    bodyStartLine: number,
  ): void {
    if (!readingRootNeedsRetarget(state.filePath, filePath)) {
      state.bodyStartLine = bodyStartLine;
      return;
    }
    for (const section of state.sections) {
      section.removeClass('templar-reading-section');
      this.readingSections.delete(section);
    }
    readingRoot.querySelectorAll('.templar-blank-line-spacer').forEach((spacer) => spacer.remove());
    state.context = null;
    state.bodyStartLine = bodyStartLine;
    state.filePath = filePath;
    state.sections = [];
    state.orderedSections = [];
    state.topLevelSections = [];
  }

  private bodyStartLine(file: TFile): number {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatterPosition;
    return bodyStartLineAfterFrontmatter(frontmatter?.end.line);
  }

  private pruneDisconnectedRoots(): void {
    for (const root of this.readingRoots.keys()) {
      if (root.isConnected) continue;
      const frame = this.scheduledRoots.get(root);
      if (frame !== undefined) {
        root.ownerDocument.defaultView?.cancelAnimationFrame(frame);
        this.scheduledRoots.delete(root);
      }
      this.readingRoots.delete(root);
    }
  }

  private sectionInfo(state: ReadingRootState, element: HTMLElement): ReadingSectionInfo | null {
    this.performanceMonitor?.counter('reading.sectionInfo.lookup');
    return this.readingSections.get(element) ?? state.context?.getSectionInfo(element) ?? null;
  }

  private isAliveSection(state: ReadingRootState, element: HTMLElement): boolean {
    return element.isConnected && (this.readingSections.has(element) || state.context?.getSectionInfo(element) !== null);
  }

  private reconcile(readingRoot: HTMLElement, current?: HTMLElement): void {
    this.performanceMonitor?.counter('reading.reconcile.count');
    const operation = (): void => {
    const state = this.rootState(readingRoot);
    if (!state.active) return;
    if (!hasReadingWhitespaceWork(Boolean(state.context), Boolean(current), state.sections.length)) return;
    this.performanceMonitor?.counter('reading.reconcile.sectionsInput', state.sections.length);
    if (current) {
      if (!state.sections.includes(current)) state.sections.push(current);
      this.reconcileIncremental(readingRoot, state, current);
      return;
    }
    state.sections = state.sections.filter((element) => this.isAliveSection(state, element));
    this.rebuildOrdering(state);
    this.performanceMonitor?.counter('reading.reconcile.sectionsAlive', state.sections.length);
    this.performanceMonitor?.counter('reading.reconcile.topLevelSections', state.topLevelSections.length);
    for (const section of state.topLevelSections) {
      const range = this.sectionInfo(state, section);
      if (range) this.insertInternalWhitespace(state, section, range);
    }
    const firstSection = state.topLevelSections[0];
    if (firstSection) this.reconcileLeadingSpacer(state, firstSection);
    for (let index = 1; index < state.topLevelSections.length; index += 1) {
      this.reconcileGapSpacer(state, state.topLevelSections[index - 1]!, state.topLevelSections[index]!);
    }
    };
    if (this.performanceMonitor) {
      this.performanceMonitor.measureSync('reading.reconcile', operation);
    } else {
      operation();
    }
  }

  private rebuildOrdering(state: ReadingRootState): void {
    state.orderedSections = [...state.sections].sort((left, right) =>
      (this.sectionInfo(state, left)?.lineStart ?? 0) - (this.sectionInfo(state, right)?.lineStart ?? 0));
    state.topLevelSections = state.orderedSections.filter((element) =>
      !element.parentElement?.closest('.templar-reading-section'),
    );
  }

  private reconcileIncremental(
    readingRoot: HTMLElement,
    state: ReadingRootState,
    current: HTMLElement,
  ): void {
    const range = this.sectionInfo(state, current);
    if (!range) return;
    this.insertInternalWhitespace(state, current, range);
    const existingIndex = state.orderedSections.indexOf(current);
    if (existingIndex >= 0) state.orderedSections.splice(existingIndex, 1);
    const last = state.orderedSections[state.orderedSections.length - 1];
    const append = !last || (this.sectionInfo(state, last)?.lineStart ?? 0) <= range.lineStart;
    let insertIndex = state.orderedSections.length;
    if (append) {
      this.performanceMonitor?.counter('reading.order.fastAppend');
    } else {
      this.performanceMonitor?.counter('reading.order.binaryInsert');
      let low = 0;
      let high = state.orderedSections.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        const middleInfo = this.sectionInfo(state, state.orderedSections[middle]!);
        if ((middleInfo?.lineStart ?? 0) <= range.lineStart) low = middle + 1;
        else high = middle;
      }
      insertIndex = low;
    }
    state.orderedSections.splice(insertIndex, 0, current);
    const nested = current.parentElement?.closest('.templar-reading-section') !== null;
    const topIndex = state.topLevelSections.indexOf(current);
    if (nested) {
      if (topIndex >= 0) state.topLevelSections.splice(topIndex, 1);
      return;
    }
    if (topIndex >= 0) state.topLevelSections.splice(topIndex, 1);
    const topInsert = state.topLevelSections.findIndex((section) =>
      (this.sectionInfo(state, section)?.lineStart ?? 0) > range.lineStart,
    );
    state.topLevelSections.splice(topInsert < 0 ? state.topLevelSections.length : topInsert, 0, current);
    const index = state.topLevelSections.indexOf(current);
    if (index === 0) this.reconcileLeadingSpacer(state, current);
    else this.reconcileGapSpacer(state, state.topLevelSections[index - 1]!, current);
    if (index + 1 < state.topLevelSections.length) {
      this.reconcileGapSpacer(state, current, state.topLevelSections[index + 1]!);
    }
    this.performanceMonitor?.counter('reading.localReconcile.count');
    void readingRoot;
  }

  private cancelScheduled(readingRoot: HTMLElement): void {
    const frame = this.scheduledRoots.get(readingRoot);
    if (frame === undefined) return;
    readingRoot.ownerDocument.defaultView?.cancelAnimationFrame(frame);
    this.scheduledRoots.delete(readingRoot);
  }

  private reconcileLeadingSpacer(state: ReadingRootState, firstSection: HTMLElement): void {
    const firstInfo = this.sectionInfo(state, firstSection);
    if (!firstInfo || firstSection.firstElementChild === null) return;
    const count = blankLinesBeforeFirstSection(
      state.bodyStartLine,
      firstInfo.lineStart,
      firstInfo.text,
    );
    const firstChild = firstSection.firstElementChild;
    const hasSpacer = firstChild.hasClass('templar-blank-line-spacer');
    if (count <= 0) {
      if (hasSpacer) firstChild.remove();
      return;
    }
    this.performanceMonitor?.counter('reading.leadingSpacer.operations');
    if (hasSpacer) {
      (firstChild as HTMLElement).style.setProperty('--templar-blank-lines', String(count));
      return;
    }
    firstSection.prepend(createBlankLineSpacer(firstSection.ownerDocument, count));
  }

  private reconcileGapSpacer(state: ReadingRootState, previous: HTMLElement, current: HTMLElement): void {
    const previousInfo = this.sectionInfo(state, previous);
    const currentInfo = this.sectionInfo(state, current);
    if (!previousInfo || !currentInfo || current.firstElementChild === null) return;
    const count = blankLinesBetweenSections(
      previousInfo.lineEnd,
      currentInfo.lineStart,
      currentInfo.text || previousInfo.text,
    );
    const firstChild = current.firstElementChild;
    const hasSpacer = firstChild.hasClass('templar-blank-line-spacer');
    if (count <= 0) {
      if (hasSpacer) firstChild.remove();
      return;
    }
    this.performanceMonitor?.counter('reading.gapSpacer.operations');
    if (hasSpacer) {
      (firstChild as HTMLElement).style.setProperty('--templar-blank-lines', String(Math.max(1, count)));
      return;
    }
    current.prepend(createBlankLineSpacer(current.ownerDocument, count));
  }

  private insertInternalWhitespace(
    state: ReadingRootState,
    section: HTMLElement,
    range: ReadingSectionInfo,
  ): void {
    this.performanceMonitor?.counter('reading.internalWhitespace.operations');
    const lines = range.text.split('\n');
    const markdown = range.lineStart <= range.lineEnd && range.lineEnd < lines.length
      ? lines.slice(range.lineStart, range.lineEnd + 1).join('\n')
      : range.text;
    const blocks = Array.from(section.children).filter(
      (element): element is HTMLElement =>
        isOwnedHTMLElement(element) &&
        !element.hasClass('templar-blank-line-spacer') &&
        !element.matches('.metadata-container, .mod-ui'),
    );
    for (let index = 1; index < section.children.length; index += 1) {
      const child = section.children[index];
      if (child?.hasClass?.('templar-blank-line-spacer')) child.remove();
    }
    if (blocks.length < 2) return;
    const mappedRanges = blocks.map((block) => state.context?.getSectionInfo(block) ?? null);
    const exactMapping = mappedRanges.every(
      (mapped, index) =>
        mapped !== null &&
        (index === 0 || mapped.lineStart > mappedRanges[index - 1]!.lineStart),
    );
    const runs = exactMapping
      ? mappedRanges.slice(1).map((mapped, index) => blankLinesBetweenSections(
        mappedRanges[index]!.lineEnd,
        mapped!.lineStart,
        mapped!.text,
      ))
      : internalBlankLineRuns(markdown);
    if (runs.length !== blocks.length - 1) return;
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

  private rootCount(): number {
    let count = 0;
    for (const root of this.readingRoots.keys()) {
      if (root) count += 1;
    }
    return count;
  }

  private updateGauges(): void {
    this.performanceMonitor?.gauge('reading.roots', this.rootCount());
    this.performanceMonitor?.gauge('reading.scheduledRoots', this.scheduledRoots.size);
  }
}

function isOwnedHTMLElement(element: Element): element is HTMLElement {
  const HTMLElementConstructor = element.ownerDocument.defaultView?.HTMLElement;
  return HTMLElementConstructor !== undefined && element.instanceOf(HTMLElementConstructor);
}
