import type { WorkspaceLeaf } from 'obsidian';
import type { TemplarNoteStyle } from '../types';
import { measuredGeometryScale } from '../utils/grid';
import { round } from '../utils/value';
import { realmFor, type DomRealm } from './dom-realm';
import type { PerformanceMonitor } from '../performance/performance-monitor';
import { planPagination } from './page-layout-plan';

interface PageLayoutState {
  realm: DomRealm;
  resizeObserver: ResizeObserver;
  mutationObserver: MutationObserver;
  frame: number | null;
  observedResizeTargets: Set<Element>;
  pagePairs: PagePair[];
  scopeEl: HTMLElement;
}

interface PagePair {
  pageRoot: HTMLElement;
  pageContent: HTMLElement;
}

export class PageLayoutService {
  private readonly states = new Map<WorkspaceLeaf, PageLayoutState>();
  private readonly scopes = new Map<WorkspaceLeaf, HTMLElement>();
  private readonly ownedBreaks = new Map<HTMLElement, Set<HTMLElement>>();

  public constructor(private readonly performanceMonitor?: PerformanceMonitor) {}

  public configure(
    leaf: WorkspaceLeaf,
    scopeEl: HTMLElement,
    style: TemplarNoteStyle,
  ): void {
    this.performanceMonitor?.counter('pageLayout.configure.count');
    const configure = (): void => {
    this.clear(leaf);
    this.scopes.set(leaf, scopeEl);
    scopeEl.dataset.templarMode = style.page.mode;
    if (style.page.mode !== 'paged') {
      return;
    }
    const pagePairs = this.pagePairs(scopeEl);
    let realm: DomRealm;
    try {
      realm = realmFor(scopeEl);
    } catch {
      return;
    }
    if (pagePairs.length === 0 || !realm.ResizeObserver || !realm.MutationObserver) {
      return;
    }

    const state: PageLayoutState = {
      realm,
      frame: null,
      observedResizeTargets: new Set(),
      pagePairs,
      scopeEl,
      resizeObserver: new realm.ResizeObserver((entries) => {
        this.performanceMonitor?.counter('pageLayout.resizeObserver.callback');
        this.performanceMonitor?.counter('pageLayout.resizeObserver.entryCount', entries.length);
        this.schedule(leaf, style);
      }),
      mutationObserver: new realm.MutationObserver((records) => {
        this.performanceMonitor?.counter('pageLayout.mutationObserver.callback');
        if (records.some((record) => record.type === 'childList')) {
          state.pagePairs = this.pagePairs(state.scopeEl);
          this.observeResizeTargets(state);
        }
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
    };
    if (this.performanceMonitor) {
      this.performanceMonitor.measureSync('pageLayout.configure', configure);
    } else {
      configure();
    }
  }

  public clear(leaf: WorkspaceLeaf): void {
    const state = this.states.get(leaf);
    const scopeEl = state?.scopeEl ?? this.scopes.get(leaf);
    if (state) {
      state.resizeObserver.disconnect();
      state.mutationObserver.disconnect();
      state.observedResizeTargets.clear();
      if (state.frame !== null) {
        state.realm.window.cancelAnimationFrame(state.frame);
      }
      state.scopeEl.style.removeProperty('--templar-page-scale');
      for (const { pageContent } of this.pagePairs(state.scopeEl)) {
        pageContent.style.removeProperty('--templar-page-scale');
      }
      this.clearBreaks(state.scopeEl);
    }
    if (scopeEl) {
      delete scopeEl.dataset.templarMode;
      scopeEl.style.removeProperty('--templar-page-scale');
      this.clearBreaks(scopeEl);
    }
    this.states.delete(leaf);
    this.scopes.delete(leaf);
    this.performanceMonitor?.gauge('pageLayout.states', this.states.size);
    this.performanceMonitor?.gauge('pageLayout.scopes', this.scopes.size);
    this.performanceMonitor?.gauge('pageLayout.observedTargets', this.observedTargetCount());
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

  public snapshot(): Record<string, number> {
    return {
      states: this.states.size,
      scopes: this.scopes.size,
      observedTargets: this.observedTargetCount(),
      scheduledFrames: [...this.states.values()].filter((state) => state.frame !== null).length,
    };
  }

  private schedule(leaf: WorkspaceLeaf, style: TemplarNoteStyle): void {
    const state = this.states.get(leaf);
    this.performanceMonitor?.counter('pageLayout.schedule.attempt');
    if (!state || state.frame !== null) {
      this.performanceMonitor?.counter('pageLayout.schedule.dedupe');
      return;
    }
    state.frame = state.realm.window.requestAnimationFrame(() => {
      state.frame = null;
      this.performanceMonitor?.counter('pageLayout.raf.execute');
      this.layout(state.scopeEl, style);
    });
  }

  private layout(scopeEl: HTMLElement, style: TemplarNoteStyle): void {
    const operation = (): void => {
    for (const { pageRoot, pageContent } of this.pagePairs(scopeEl)) {
      this.performanceMonitor?.counter('pageLayout.geometry.clientWidthRead');
      if (pageRoot.clientWidth <= 0) {
        continue;
      }
      const view = pageRoot.ownerDocument.defaultView;
      const computed = this.readComputedStyle(view, pageRoot, 'pageLayout.computedStyle.read');
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
      if (pageContent.style.getPropertyValue('--templar-page-scale') !== String(appliedScale)) {
        pageContent.style.setProperty('--templar-page-scale', String(appliedScale));
        this.performanceMonitor?.counter('pageLayout.canvasScale.write');
      }
      const geometryScale = measuredGeometryScale(
        this.readRect(pageContent, 'pageLayout.geometry.read').width,
        style.page.width,
        appliedScale,
      );
      this.paginate(pageContent, style, geometryScale);
    }
    };
    if (this.performanceMonitor) {
      this.performanceMonitor.measureSync('pageLayout.layout', operation);
    } else {
      operation();
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
    for (const { pageRoot, pageContent } of state.pagePairs) {
      nextTargets.add(pageRoot);
      nextTargets.add(pageContent);
      for (const element of pageContent.querySelectorAll<HTMLElement>([
        'img', 'table', '.callout', 'pre', 'code', 'math', '.math-block',
        '.mermaid', '.internal-embed', '.file-embed', 'details', 'figure',
        'iframe', 'object', 'video', 'audio', 'canvas', '.cm-table-widget',
        '.cm-embed-block',
      ].join(','))) {
        nextTargets.add(element);
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
    this.performanceMonitor?.gauge('pageLayout.observedTargets', this.observedTargetCount());
    this.performanceMonitor?.gauge('pageLayout.pagePairCount', state.pagePairs.length);
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
    this.performanceMonitor?.counter('pageLayout.pagination.count');
    const operation = (): void => {
    this.clearBreaks(pageContent);
    const candidates = this.pageBreakCandidates(pageContent);
    this.performanceMonitor?.counter('pageLayout.candidate.count', candidates.length);
    this.performanceMonitor?.gauge('pageLayout.candidateCount', candidates.length);
    const contentRect = this.readRect(pageContent, 'pageLayout.geometry.contentRectRead');
    const measurements = candidates.map((element) => {
      const rect = this.readRect(element, 'pageLayout.geometry.read');
      const computed = this.readComputedStyle(
        pageContent.ownerDocument.defaultView,
        element,
        'pageLayout.computedStyle.read',
      );
      return {
        element,
        naturalTop: rect.top - contentRect.top,
        height: rect.height,
        marginEnd: this.pixelValue(computed?.marginBlockEnd ?? computed?.marginBottom),
        marginTop: computed?.marginTop ?? '0px',
      };
    });
    const plan = planPagination(measurements, style, { geometryScale, pageGapOverride });
    for (const breakPlan of plan.breaks) {
      breakPlan.element.style.setProperty('--templar-original-margin-top', breakPlan.originalMarginTop);
      breakPlan.element.style.setProperty('--templar-page-break', `${String(round(breakPlan.breakOffset))}px`);
      this.performanceMonitor?.counter('pageLayout.break.write');
    }
    this.ownedBreaks.set(pageContent, new Set(plan.breaks.map((breakPlan) => breakPlan.element)));
    const canvasHeight = `${String(round(plan.canvasHeight))}px`;
    if (pageContent.style.getPropertyValue('--templar-canvas-height') !== canvasHeight) {
      pageContent.style.setProperty('--templar-canvas-height', canvasHeight);
      this.performanceMonitor?.counter('pageLayout.canvasHeight.write');
    }
    };
    if (this.performanceMonitor) {
      this.performanceMonitor.measureSync('pageLayout.pagination', operation);
    } else {
      operation();
    }
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
      const owned = this.ownedBreaks.get(pageContent);
      for (const element of owned ?? []) {
        element.style.removeProperty('--templar-page-break');
        element.style.removeProperty('--templar-original-margin-top');
      }
      this.ownedBreaks.delete(pageContent);
      if (!owned) {
        for (const element of pageContent.querySelectorAll<HTMLElement>(
          '[style*="--templar-page-break"], [style*="--templar-original-margin-top"]',
        )) {
          element.style.removeProperty('--templar-page-break');
          element.style.removeProperty('--templar-original-margin-top');
        }
      }
    }
  }

  private readRect(element: Element, metric: string): DOMRect {
    this.performanceMonitor?.counter(metric);
    return element.getBoundingClientRect();
  }

  private readComputedStyle(view: Window | null | undefined, element: Element, metric: string): CSSStyleDeclaration | undefined {
    this.performanceMonitor?.counter(metric);
    return view?.getComputedStyle(element);
  }

  private observedTargetCount(): number {
    let count = 0;
    for (const state of this.states.values()) count += state.observedResizeTargets.size;
    return count;
  }
}
