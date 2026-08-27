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

interface PaperOriginObservationState {
  contentEl: HTMLElement;
  frame: number | null;
  mutationObserver: MutationObserver;
  observedElements: Set<HTMLElement>;
  pageContents: Set<HTMLElement>;
  resizeObserver: ResizeObserver;
  rescan: () => void;
  scrollHandler: EventListener;
  scrollRoots: Set<HTMLElement>;
  targets: Map<HTMLElement, PaperOriginTarget>;
  view: Window;
}

/** Owns paper-origin anchoring observers and their per-leaf cleanup. */
export class PaperOriginController {
  private readonly states = new Map<WorkspaceLeaf, PaperOriginObservationState>();

  public configure(
    leaf: WorkspaceLeaf,
    contentEl: HTMLElement,
    style: TemplarNoteStyle,
    metrics: PageMetricSet,
  ): void {
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
      const nextPageContents = new Set(
        contentEl.querySelectorAll<HTMLElement>(`.${TEMPLAR_CONTENT_CLASS}`),
      );
      const nextScrollRoots = new Set<HTMLElement>();
      const nextObserved = new Set<HTMLElement>();
      for (const previous of state.pageContents) {
        if (!nextPageContents.has(previous)) {
          previous.style.removeProperty('--templar-paper-baseline-position');
          state.targets.delete(previous);
        }
      }
      for (const pageContent of nextPageContents) {
        const pageRoot = pageContent.closest<HTMLElement>(`.${TEMPLAR_PAGE_CLASS}`);
        if (pageRoot) nextScrollRoots.add(pageRoot);
        nextObserved.add(pageContent);
        for (const prefix of pageContent.querySelectorAll<HTMLElement>(
          ':scope > .inline-title, :scope > .metadata-container, :scope > .mod-frontmatter, :scope > .mod-header',
        )) nextObserved.add(prefix);

        const target = (pageContent.hasClass('cm-sizer')
            ? findEditorPaperOriginTarget(pageContent, metrics)
            : findReadingPaperOriginTarget(pageContent, metrics)) ?? undefined;
        if (target) state.targets.set(pageContent, target);
        else state.targets.delete(pageContent);
        if (!target) {
          pageContent.style.removeProperty('--templar-paper-baseline-position');
          continue;
        }
        nextObserved.add(target.element);
        const contentRect = pageContent.getBoundingClientRect();
        const targetRect = target.element.getBoundingClientRect();
        const targetStyle = view.getComputedStyle(target.element);
        const horizontalScale = measuredGeometryScale(contentRect.width, pageContent.offsetWidth, 1);
        const scale = measuredGeometryScale(contentRect.height, pageContent.offsetHeight, horizontalScale);
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
          pageContent.style.setProperty('--templar-paper-baseline-position', `${String(origin)}px`);
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
      for (const previous of state.scrollRoots) {
        if (!nextScrollRoots.has(previous)) previous.removeEventListener('scroll', state.scrollHandler);
      }
      for (const root of nextScrollRoots) {
        if (!state.scrollRoots.has(root)) root.addEventListener('scroll', state.scrollHandler, { passive: true });
      }
      state.scrollRoots = nextScrollRoots;
    };
    const scheduleFrame = (): void => {
      if (state.frame !== null) return;
      state.frame = view.requestAnimationFrame(() => {
        state.frame = null;
        scan();
      });
    };
    const scrollHandler: EventListener = () => scheduleFrame();
    state = {
      contentEl,
      frame: null,
      mutationObserver: new MutationObserverConstructor(scheduleFrame),
      observedElements: new Set(),
      pageContents,
      resizeObserver: new ResizeObserverConstructor(scheduleFrame),
      rescan: () => undefined,
      scrollHandler,
      scrollRoots: new Set(),
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
    state.rescan = scan;
    scan();
  }

  /** Re-anchor immediately before a diagnostic or other synchronous read. */
  public refresh(leaf: WorkspaceLeaf): void {
    this.states.get(leaf)?.rescan();
  }

  public clear(leaf: WorkspaceLeaf): void {
    const state = this.states.get(leaf);
    if (state?.frame !== null && state) state.view.cancelAnimationFrame(state.frame);
    state?.resizeObserver.disconnect();
    state?.mutationObserver.disconnect();
    if (state) {
      for (const root of state.scrollRoots) root.removeEventListener('scroll', state.scrollHandler);
    }
    if (state) this.cleanupOwnedDom(state.contentEl);
    this.states.delete(leaf);
  }

  public destroy(): void {
    for (const leaf of [...this.states.keys()]) this.clear(leaf);
  }

  private cleanupOwnedDom(contentEl: HTMLElement): void {
    contentEl.querySelectorAll<HTMLElement>(`.${TEMPLAR_CONTENT_CLASS}`).forEach((element) => {
      element.style.removeProperty('--templar-paper-baseline-position');
    });
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
