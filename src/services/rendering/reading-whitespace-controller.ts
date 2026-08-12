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
    private readonly hasStyle: (file: TFile) => boolean,
  ) {}

  public registerSection(
    element: HTMLElement,
    context: MarkdownPostProcessorContext,
  ): void {
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
    if (this.hasStyle(file)) {
      element.addClass('templar-reading-section');
      // Reconcile inside the post-processor so Obsidian measures the spacer
      // before the first paint and before its virtual scroller caches height.
      this.reconcile(readingRoot, element);
    }
  }

  public prepareCachedSections(readingRoot: HTMLElement, file: TFile): void {
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
    for (let index = 0; index < renderedBlocks.length; index += 1) {
      const element = renderedBlocks[index];
      const section = cachedSections[index];
      if (!element || !section) continue;
      this.readingSections.set(element, {
        lineStart: section.position.start.line,
        lineEnd: section.position.end.line,
        text: '',
      });
      element.addClass('templar-reading-section');
    }
  }

  public schedule(readingRoot: HTMLElement): void {
    if (!this.isEnabled() || !readingRoot.hasClass(TEMPLAR_PAGE_CLASS)) {
      this.clearRoot(readingRoot);
      return;
    }
    if (this.scheduledRoots.has(readingRoot)) return;
    const view = readingRoot.ownerDocument.defaultView;
    if (!view) return;
    const frame = view.requestAnimationFrame(() => {
      this.scheduledRoots.delete(readingRoot);
      if (
        !this.destroyed &&
        this.isEnabled() &&
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
    const frame = this.scheduledRoots.get(readingRoot);
    if (frame !== undefined) {
      readingRoot.ownerDocument.defaultView?.cancelAnimationFrame(frame);
      this.scheduledRoots.delete(readingRoot);
    }
    const state = this.readingRoots.get(readingRoot);
    for (const section of state?.sections ?? []) {
      section.removeClass('templar-reading-section');
      this.readingSections.delete(section);
    }
    readingRoot.querySelectorAll('.templar-blank-line-spacer').forEach((spacer) => spacer.remove());
    this.readingRoots.delete(readingRoot);
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

  private rootState(readingRoot: HTMLElement): ReadingRootState {
    let state = this.readingRoots.get(readingRoot);
    if (!state) {
      state = { bodyStartLine: 0, context: null, filePath: null, sections: [] };
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
    const fresh = state.context?.getSectionInfo(element);
    return fresh ?? this.readingSections.get(element) ?? null;
  }

  private isAliveSection(state: ReadingRootState, element: HTMLElement): boolean {
    if (state.context) return state.context.getSectionInfo(element) !== null;
    return this.readingSections.has(element);
  }

  private reconcile(readingRoot: HTMLElement, current?: HTMLElement): void {
    const state = this.rootState(readingRoot);
    if (!hasReadingWhitespaceWork(Boolean(state.context), Boolean(current), state.sections.length)) return;
    if (current && !state.sections.includes(current)) state.sections.push(current);
    const aliveSections = state.sections.filter((element) => this.isAliveSection(state, element));
    state.sections = aliveSections;
    const sections = aliveSections.filter(
      (element) => !element.parentElement?.closest('.templar-reading-section'),
    );
    sections.sort((left, right) =>
      (this.sectionInfo(state, left)?.lineStart ?? 0) - (this.sectionInfo(state, right)?.lineStart ?? 0));

    if (current) {
      const range = this.sectionInfo(state, current);
      if (range) this.insertInternalWhitespace(state, current, range);
    }
    const firstSection = sections[0];
    if (firstSection) this.reconcileLeadingSpacer(state, firstSection);
    for (let index = 1; index < sections.length; index += 1) {
      this.reconcileGapSpacer(state, sections[index - 1]!, sections[index]!);
    }
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
}

function isOwnedHTMLElement(element: Element): element is HTMLElement {
  const HTMLElementConstructor = element.ownerDocument.defaultView?.HTMLElement;
  return HTMLElementConstructor !== undefined && element.instanceOf(HTMLElementConstructor);
}
