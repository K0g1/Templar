import type { App, MarkdownPostProcessorContext } from 'obsidian';
import { TFile } from 'obsidian';
import {
  blankLinesBetweenSections,
  createBlankLineSpacer,
  internalBlankLineRuns,
} from './reading-whitespace';

interface ReadingRootState {
  context: MarkdownPostProcessorContext | null;
  sections: HTMLElement[];
}

interface ReadingSectionInfo {
  lineStart: number;
  lineEnd: number;
  text: string;
}

/**
 * Reconciles blank-line spacing inside Obsidian Reading View sections.
 *
 * Spacers are inserted as the first child of the section below a source gap;
 * Obsidian's virtual scroller only manages the sizer's direct children via
 * setChildrenInPlace, so spacers inside section elements survive renders.
 *
 * All reads of the section cache go through this controller, which also
 * owns the per-root scheduled animation frames.
 */
export class ReadingViewWhitespaceController {
  private readonly readingSections = new WeakMap<HTMLElement, ReadingSectionInfo>();
  private readonly readingRoots = new Map<HTMLElement, ReadingRootState>();
  private readonly scheduledReadingRoots = new Map<HTMLElement, number>();

  public constructor(private readonly app: App) {}

  public registerReadingSection(
    element: HTMLElement,
    context: MarkdownPostProcessorContext,
  ): void {
    const file = this.app.vault.getAbstractFileByPath(context.sourcePath);
    if (!(file instanceof TFile)) {
      return;
    }
    this.pruneDisconnectedRoots();
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
  }

  /** Reconcile a section synchronously inside the post-processor. */
  public reconcileSection(
    readingRoot: HTMLElement,
    element: HTMLElement,
  ): void {
    this.reconcileReadingWhitespace(readingRoot, element);
  }

  public schedule(readingRoot: HTMLElement): void {
    if (this.scheduledReadingRoots.has(readingRoot)) {
      return;
    }
    const view = readingRoot.ownerDocument.defaultView;
    if (!view) {
      return;
    }
    // Style changes and cached-view reuse do not re-run post-processors, so
    // reconcile once in the next frame.
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

  public registerCachedSections(readingRoot: HTMLElement, file: TFile): void {
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

  public pruneDisconnectedRoots(): void {
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

  public clear(): void {
    for (const [root, frame] of this.scheduledReadingRoots) {
      root.ownerDocument.defaultView?.cancelAnimationFrame(frame);
    }
    this.scheduledReadingRoots.clear();
    this.readingRoots.clear();
  }

  private destroyed = false;

  public destroy(): void {
    this.destroyed = true;
    this.clear();
  }

  private rootState(readingRoot: HTMLElement): ReadingRootState {
    let state = this.readingRoots.get(readingRoot);
    if (!state) {
      state = { context: null, sections: [] };
      this.readingRoots.set(readingRoot, state);
    }
    return state;
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
      this.isAliveSection(state, element),
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
