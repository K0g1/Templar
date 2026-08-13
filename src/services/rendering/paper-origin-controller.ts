import type { WorkspaceLeaf } from 'obsidian';
import { TEMPLAR_CONTENT_CLASS, TEMPLAR_PAGE_CLASS } from '../../constants';
import type { TemplarNoteStyle } from '../../types';
import { measuredGeometryScale } from '../../utils/grid';
import { round } from '../../utils/value';
import {
  findEditorPaperOriginTarget,
  findReadingPaperOriginTarget,
  measuredPaperOrigin,
  type PaperOriginTarget,
} from '../paper-origin';
import type { PageMetricSet } from '../style-compiler';
import { realmFor, type DomRealm } from '../dom-realm';
import type { PerformanceMonitor } from '../../performance/performance-monitor';

interface PaperOriginObservationState {
  contentEl: HTMLElement;
  frame: number | null;
  mutationObserver: MutationObserver;
  observedElements: Set<HTMLElement>;
  pageContents: Set<HTMLElement>;
  resizeObserver: ResizeObserver;
  targets: Map<HTMLElement, PaperOriginTarget>;
  view: Window;
}

/** Owns paper-origin anchoring observers and their per-leaf cleanup. */
export class PaperOriginController {
  private readonly states = new Map<WorkspaceLeaf, PaperOriginObservationState>();

  public constructor(private readonly performanceMonitor?: PerformanceMonitor) {}

  public configure(
    leaf: WorkspaceLeaf,
    contentEl: HTMLElement,
    style: TemplarNoteStyle,
    metrics: PageMetricSet,
  ): void {
    this.performanceMonitor?.counter('paperOrigin.configure.count');
    this.clear(leaf);
    this.cleanupOwnedDom(contentEl);
    const pageContents = new Set(
      contentEl.querySelectorAll<HTMLElement>(`.${TEMPLAR_CONTENT_CLASS}`),
    );
    for (const pageContent of pageContents) {
      pageContent.style.removeProperty('--templar-paper-baseline-position');
    }

    let realm: DomRealm;
    try {
      realm = realmFor(contentEl);
    } catch {
      return;
    }
    const view = realm.window;
    const ResizeObserverConstructor = realm.ResizeObserver;
    const MutationObserverConstructor = realm.MutationObserver;
    const enabled =
      style.baseline.enabled &&
      style.baseline.mode !== 'free' &&
      ResizeObserverConstructor !== null &&
      MutationObserverConstructor !== null;
    if (!enabled || !ResizeObserverConstructor || !MutationObserverConstructor) {
      return;
    }

    let state: PaperOriginObservationState;
    const scan = (): void => {
      const operation = (): void => {
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
        )) nextObserved.add(prefix);

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
          if (target && !atDocumentStart) continue;
          target = (pageContent.hasClass('cm-sizer')
            ? findEditorPaperOriginTarget(pageContent, metrics)
            : findReadingPaperOriginTarget(pageContent, metrics)) ?? undefined;
          if (target) state.targets.set(pageContent, target);
        }
        if (!target) {
          pageContent.style.removeProperty('--templar-paper-baseline-position');
          continue;
        }
        nextObserved.add(target.element);
        this.performanceMonitor?.counter('paperOrigin.contentRect.read');
        const contentRect = pageContent.getBoundingClientRect();
        this.performanceMonitor?.counter('paperOrigin.targetRect.read');
        const targetRect = target.element.getBoundingClientRect();
        this.performanceMonitor?.counter('paperOrigin.computedStyle.read');
        const targetStyle = view.getComputedStyle(target.element);
        const scale = measuredGeometryScale(contentRect.width, pageContent.offsetWidth, 1);
        const origin = round(measuredPaperOrigin(
          contentRect.top,
          targetRect.top,
          scale,
          Number.parseFloat(targetStyle.paddingTop) || 0,
          Number.parseFloat(targetStyle.borderTopWidth) || 0,
          target.metric.baseline,
          style.baseline.unit,
        ));
        const previous = Number.parseFloat(
          pageContent.style.getPropertyValue('--templar-paper-baseline-position'),
        );
        if (!Number.isFinite(previous) || Math.abs(previous - origin) >= 0.01) {
          this.performanceMonitor?.counter('paperOrigin.css.write.changed');
          pageContent.style.setProperty('--templar-paper-baseline-position', `${String(origin)}px`);
        } else {
          this.performanceMonitor?.counter('paperOrigin.css.write.sameValue');
        }
      }
      for (const previous of state.observedElements) {
        if (!nextObserved.has(previous)) state.resizeObserver.unobserve(previous);
      }
      for (const element of nextObserved) {
        if (!state.observedElements.has(element)) state.resizeObserver.observe(element);
      }
      state.observedElements = nextObserved;
      state.pageContents = nextPageContents;
      this.performanceMonitor?.gauge('paperOrigin.pageContents', nextPageContents.size);
      this.performanceMonitor?.gauge('paperOrigin.observedElements', nextObserved.size);
      };
      if (this.performanceMonitor) this.performanceMonitor.measureSync('paperOrigin.scan', operation);
      else operation();
    };
    const scheduleFrame = (): void => {
      this.performanceMonitor?.counter('paperOrigin.raf.schedule');
      if (state.frame !== null) {
        this.performanceMonitor?.counter('paperOrigin.raf.dedupe');
        return;
      }
      state.frame = view.requestAnimationFrame(() => {
        state.frame = null;
        this.performanceMonitor?.counter('paperOrigin.raf.execute');
        scan();
      });
    };
    state = {
      contentEl,
      frame: null,
      mutationObserver: new MutationObserverConstructor(() => {
        this.performanceMonitor?.counter('paperOrigin.mutationObserver.callback');
        scheduleFrame();
      }),
      observedElements: new Set(),
      pageContents,
      resizeObserver: new ResizeObserverConstructor(() => {
        this.performanceMonitor?.counter('paperOrigin.resizeObserver.callback');
        scheduleFrame();
      }),
      targets: new Map(),
      view,
    };
    state.mutationObserver.observe(contentEl, {
      attributeFilter: ['aria-expanded', 'class', 'data-mode'],
      attributes: true,
      childList: true,
      subtree: true,
    });
    this.states.set(leaf, state);
    scan();
  }

  public clear(leaf: WorkspaceLeaf): void {
    const state = this.states.get(leaf);
    if (state?.frame !== null && state) state.view.cancelAnimationFrame(state.frame);
    state?.resizeObserver.disconnect();
    state?.mutationObserver.disconnect();
    if (state) this.cleanupOwnedDom(state.contentEl);
    this.states.delete(leaf);
    this.performanceMonitor?.gauge('paperOrigin.states', this.states.size);
    this.performanceMonitor?.gauge('paperOrigin.pageContents', this.pageContentCount());
    this.performanceMonitor?.gauge('paperOrigin.observedElements', this.observedElementCount());
  }

  public destroy(): void {
    for (const leaf of [...this.states.keys()]) this.clear(leaf);
  }

  public snapshot(): Record<string, number> {
    return {
      states: this.states.size,
      observedElements: this.observedElementCount(),
      pageContents: this.pageContentCount(),
    };
  }

  private cleanupOwnedDom(contentEl: HTMLElement): void {
    contentEl.querySelectorAll<HTMLElement>(`.${TEMPLAR_CONTENT_CLASS}`).forEach((element) => {
      element.style.removeProperty('--templar-paper-baseline-position');
    });
  }

  private observedElementCount(): number {
    let count = 0;
    for (const state of this.states.values()) count += state.observedElements.size;
    return count;
  }

  private pageContentCount(): number {
    let count = 0;
    for (const state of this.states.values()) count += state.pageContents.size;
    return count;
  }
}

/** Compatibility helper for focused ownership tests. */
export interface PaperOriginState {
  targets: Map<HTMLElement, PaperOriginTarget>;
  pageContents: Set<HTMLElement>;
}

export function clearPaperOriginState(state: PaperOriginState): void {
  for (const element of state.pageContents) {
    element.style.removeProperty('--templar-paper-baseline-position');
  }
  state.targets.clear();
  state.pageContents.clear();
}
