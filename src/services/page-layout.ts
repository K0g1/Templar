import type { WorkspaceLeaf } from 'obsidian';
import type { TemplarNoteStyle } from '../types';
import { alignedPageGap, measuredGeometryScale } from '../utils/grid';
import { round } from '../utils/value';

interface PageLayoutState {
  resizeObserver: ResizeObserver;
  mutationObserver: MutationObserver;
  frame: number | null;
  observedResizeTargets: Set<Element>;
  scopeEl: HTMLElement;
}

interface PagePair {
  pageRoot: HTMLElement;
  pageContent: HTMLElement;
}

export class PageLayoutService {
  private readonly states = new Map<WorkspaceLeaf, PageLayoutState>();

  public configure(
    leaf: WorkspaceLeaf,
    scopeEl: HTMLElement,
    style: TemplarNoteStyle,
  ): void {
    this.clear(leaf);
    scopeEl.dataset.templarMode = style.page.mode;
    if (style.page.mode !== 'paged') {
      return;
    }
    const pagePairs = this.pagePairs(scopeEl);
    const view = scopeEl.ownerDocument.defaultView;
    if (pagePairs.length === 0 || !view || typeof ResizeObserver === 'undefined') {
      return;
    }

    const state: PageLayoutState = {
      frame: null,
      observedResizeTargets: new Set(),
      scopeEl,
      resizeObserver: new ResizeObserver(() => this.schedule(leaf, style)),
      mutationObserver: new MutationObserver(() => {
        this.observeResizeTargets(state);
        this.schedule(leaf, style);
      }),
    };
    this.states.set(leaf, state);
    for (const { pageContent } of pagePairs) {
      state.mutationObserver.observe(pageContent, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }
    this.observeResizeTargets(state);
    this.schedule(leaf, style);
  }

  public clear(leaf: WorkspaceLeaf): void {
    const state = this.states.get(leaf);
    if (state) {
      state.resizeObserver.disconnect();
      state.mutationObserver.disconnect();
      state.observedResizeTargets.clear();
      const view = state.scopeEl.ownerDocument.defaultView;
      if (state.frame !== null && view) {
        view.cancelAnimationFrame(state.frame);
      }
      state.scopeEl.style.removeProperty('--templar-page-scale');
      for (const { pageContent } of this.pagePairs(state.scopeEl)) {
        pageContent.style.removeProperty('--templar-page-scale');
      }
      delete state.scopeEl.dataset.templarMode;
      this.clearBreaks(state.scopeEl);
    }
    this.states.delete(leaf);
  }

  public destroy(): void {
    for (const leaf of [...this.states.keys()]) {
      this.clear(leaf);
    }
  }

  public preparePrint(leaf: WorkspaceLeaf, style: TemplarNoteStyle): void {
    const state = this.states.get(leaf);
    if (!state || style.page.mode !== 'paged') return;
    for (const { pageContent } of this.pagePairs(state.scopeEl)) {
      pageContent.setCssProps({
        '--templar-page-scale': '1',
        '--templar-page-gap': '0px',
        '--templar-page-span': `${String(style.page.height)}px`,
      });
      this.paginate(pageContent, style, 1, 0);
    }
  }

  public restoreAfterPrint(leaf: WorkspaceLeaf, style: TemplarNoteStyle): void {
    const state = this.states.get(leaf);
    if (!state) return;
    for (const { pageContent } of this.pagePairs(state.scopeEl)) {
      pageContent.style.removeProperty('--templar-page-gap');
      pageContent.style.removeProperty('--templar-page-span');
    }
    this.schedule(leaf, style);
  }

  private schedule(leaf: WorkspaceLeaf, style: TemplarNoteStyle): void {
    const state = this.states.get(leaf);
    const view = state?.scopeEl.ownerDocument.defaultView;
    if (!state || !view || state.frame !== null) {
      return;
    }
    state.frame = view.requestAnimationFrame(() => {
      state.frame = null;
      this.layout(state.scopeEl, style);
    });
  }

  private layout(scopeEl: HTMLElement, style: TemplarNoteStyle): void {
    for (const { pageRoot, pageContent } of this.pagePairs(scopeEl)) {
      if (pageRoot.clientWidth <= 0) {
        continue;
      }
      const view = pageRoot.ownerDocument.defaultView;
      const computed = view?.getComputedStyle(pageRoot);
      const inlinePadding =
        this.pixelValue(computed?.paddingInlineStart) +
        this.pixelValue(computed?.paddingInlineEnd);
      const sheetGutter = 16;
      const availableWidth = Math.max(
        1,
        pageRoot.clientWidth - inlinePadding - sheetGutter,
      );
      const scale = style.page.scaleToFit
        ? Math.min(1, availableWidth / style.page.width)
        : 1;
      const appliedScale = round(scale, 5);
      pageContent.style.setProperty(
        '--templar-page-scale',
        String(appliedScale),
      );
      const geometryScale = measuredGeometryScale(
        pageContent.getBoundingClientRect().width,
        style.page.width,
        appliedScale,
      );
      this.paginate(pageContent, style, geometryScale);
    }
  }

  private pagePairs(scopeEl: HTMLElement): PagePair[] {
    const pairs: PagePair[] = [];
    for (const pageRoot of scopeEl.querySelectorAll<HTMLElement>('.templar-page')) {
      const pageContent = pageRoot.querySelector<HTMLElement>(
        '.templar-page-content',
      );
      if (pageContent) {
        pairs.push({ pageRoot, pageContent });
      }
    }
    return pairs;
  }

  private observeResizeTargets(state: PageLayoutState): void {
    const nextTargets = new Set<Element>();
    for (const { pageRoot, pageContent } of this.pagePairs(state.scopeEl)) {
      nextTargets.add(pageRoot);
      nextTargets.add(pageContent);
      for (const candidate of this.pageBreakCandidates(pageContent)) {
        nextTargets.add(candidate);
      }
      for (const image of pageContent.querySelectorAll('img')) {
        nextTargets.add(image);
      }
    }
    for (const target of state.observedResizeTargets) {
      if (!nextTargets.has(target)) {
        state.resizeObserver.unobserve(target);
      }
    }
    for (const target of nextTargets) {
      if (!state.observedResizeTargets.has(target)) {
        state.resizeObserver.observe(target);
      }
    }
    state.observedResizeTargets = nextTargets;
  }

  private pixelValue(value: string | undefined): number {
    const parsed = Number.parseFloat(value ?? '0');
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private paginate(
    pageContent: HTMLElement,
    style: TemplarNoteStyle,
    geometryScale: number,
    pageGapOverride?: number,
  ): void {
    this.clearBreaks(pageContent);
    const candidates = this.pageBreakCandidates(pageContent);
    const pageGap = pageGapOverride ?? alignedPageGap(
      style.page.height,
      style.page.gap,
      style.baseline.unit,
    );
    const pageSpan = style.page.height + pageGap;
    const usableHeight = Math.max(
      style.baseline.unit,
      style.page.height - style.layout.paddingTop - style.layout.paddingBottom,
    );

    for (const element of candidates) {
      const contentRect = pageContent.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      const top = (rect.top - contentRect.top) / geometryScale;
      const height = rect.height / geometryScale;
      if (height <= 0) {
        continue;
      }
      const positionInPage = ((top % pageSpan) + pageSpan) % pageSpan;
      const crossesBottom = positionInPage + height > style.page.height - style.layout.paddingBottom;
      const startsInGap = positionInPage >= style.page.height;
      const overTallAwayFromTop =
        height > usableHeight &&
        Math.abs(positionInPage - style.layout.paddingTop) > 1;
      const shouldMove =
        startsInGap ||
        (height > usableHeight ? overTallAwayFromTop : crossesBottom);
      if (!shouldMove) {
        continue;
      }
      const nextPage = Math.floor(top / pageSpan) + 1;
      const nextTop = nextPage * pageSpan + style.layout.paddingTop;
      const breakOffset = Math.max(0, nextTop - top);
      const computed = pageContent.ownerDocument.defaultView?.getComputedStyle(element);
      element.style.setProperty(
        '--templar-original-margin-top',
        computed?.marginTop ?? '0px',
      );
      element.style.setProperty('--templar-page-break', `${String(round(breakOffset))}px`);
    }

    const contentRect = pageContent.getBoundingClientRect();
    let contentBottom = style.layout.paddingTop;
    for (const element of candidates) {
      const rect = element.getBoundingClientRect();
      contentBottom = Math.max(
        contentBottom,
        (rect.bottom - contentRect.top) / geometryScale,
      );
    }
    contentBottom += style.layout.paddingBottom;
    const finalPageIndex = Math.floor(
      Math.max(0, contentBottom - 1) / pageSpan,
    );
    const canvasHeight = finalPageIndex * pageSpan + style.page.height;
    pageContent.style.setProperty(
      '--templar-canvas-height',
      `${String(round(canvasHeight))}px`,
    );
  }

  private pageBreakCandidates(pageContent: HTMLElement): HTMLElement[] {
    const selectors = [
      ':scope.markdown-preview-section > *',
      ':scope > .markdown-preview-section > *',
      ':scope > .mod-header',
      ':scope > .cm-content > .cm-line',
      ':scope > .cm-content > .cm-embed-block',
      ':scope > .cm-content > .cm-table-widget',
      ':scope > .cm-contentContainer > .cm-content > .cm-line',
      ':scope > .cm-contentContainer > .cm-content > .cm-embed-block',
      ':scope > .cm-contentContainer > .cm-content > .cm-table-widget',
    ];
    return Array.from(pageContent.querySelectorAll<HTMLElement>(selectors.join(',')));
  }

  private clearBreaks(container: HTMLElement): void {
    for (const pageContent of container.matches('.templar-page-content')
      ? [container]
      : container.querySelectorAll<HTMLElement>('.templar-page-content')) {
      pageContent.style.removeProperty('--templar-canvas-height');
    }
    for (const element of container.querySelectorAll<HTMLElement>(
      '[style*="--templar-page-break"], [style*="--templar-original-margin-top"]',
    )) {
      element.style.removeProperty('--templar-page-break');
      element.style.removeProperty('--templar-original-margin-top');
    }
  }
}
