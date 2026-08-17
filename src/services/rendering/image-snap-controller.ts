import type { WorkspaceLeaf } from 'obsidian';
import { TEMPLAR_PAGE_CLASS } from '../../constants';
import type { TemplarNoteStyle } from '../../types';
import { imageGridCompensation } from '../../utils/grid';
import { round } from '../../utils/value';
import { realmFor } from '../dom-realm';
import type { PerformanceMonitor } from '../../performance/performance-monitor';

interface ImageObservationState {
  mutationObserver: MutationObserver;
  observedImages: Set<HTMLElement>;
  resizeObserver: ResizeObserver;
  contentEl: HTMLElement;
}

/** Owns image baseline observers and their per-leaf cleanup. */
export class ImageSnapController {
  private readonly states = new Map<WorkspaceLeaf, ImageObservationState>();

  public constructor(private readonly performanceMonitor?: PerformanceMonitor) {}

  public configure(
    leaf: WorkspaceLeaf,
    contentEl: HTMLElement,
    style: TemplarNoteStyle,
  ): void {
    this.performanceMonitor?.counter('imageSnap.configure.count');
    this.clear(leaf);
    this.cleanupOwnedDom(contentEl);

    let realm;
    try {
      realm = realmFor(contentEl);
    } catch {
      return;
    }
    const ResizeObserverConstructor = realm.ResizeObserver;
    const MutationObserverConstructor = realm.MutationObserver;
    const OwnerHTMLElement = (realm.window as Window & { HTMLElement: typeof HTMLElement }).HTMLElement;
    const isOwnerElement = (node: Node): node is HTMLElement =>
      node.nodeType === 1 && (node as HTMLElement).ownerDocument === contentEl.ownerDocument;
    const enabled =
      style.baseline.enabled &&
      style.baseline.mode !== 'free' &&
      style.baseline.snapImages &&
      ResizeObserverConstructor !== null &&
      MutationObserverConstructor !== null;
    if (!enabled || !ResizeObserverConstructor || !MutationObserverConstructor) {
      return;
    }

    const updateBatch = (entries: Map<HTMLElement, number | undefined>): void => {
      const images = [...entries.keys()].filter((image) => state.observedImages.has(image) && image.isConnected);
      if (images.length === 0) return;
      this.performanceMonitor?.counter('imageSnap.batch.read', 1);
      const measurements = images.map((image) => {
        // offsetHeight is the untransformed layout border box. A client rect is
        // contaminated by paged-mode zoom and decorative rotation.
        this.performanceMonitor?.counter('imageSnap.offsetHeight.read');
        const height = entries.get(image) ?? image.offsetHeight;
        this.performanceMonitor?.counter('imageSnap.computedStyle.read');
        const computed = contentEl.ownerDocument.defaultView?.getComputedStyle(image);
        const previous = Number.parseFloat(image.style.getPropertyValue('--templar-image-snap')) || 0;
        const footprint = height +
          (Number.parseFloat(computed?.marginBlockStart ?? computed?.marginTop ?? '0') || 0) +
          (Number.parseFloat(computed?.marginBlockEnd ?? computed?.marginBottom ?? '0') || 0) -
          previous;
        return { image, height, previous, compensation: round(imageGridCompensation(footprint, style.baseline.unit)) };
      });
      for (const measurement of measurements) {
        if (measurement.height <= 0) continue;
        const nextValue = `${String(measurement.compensation)}px`;
        if (Math.abs(measurement.compensation - measurement.previous) < 0.01) {
          this.performanceMonitor?.counter('imageSnap.update.sameValueAvoided');
          continue;
        }
        this.performanceMonitor?.counter('imageSnap.css.write.changed');
        measurement.image.style.setProperty('--templar-image-snap', nextValue);
      }
    };

    let scanImages: () => void;
    const resizeObserver = new ResizeObserverConstructor((entries) => {
      this.performanceMonitor?.counter('imageSnap.resizeObserver.callback');
      this.performanceMonitor?.counter('imageSnap.resizeObserver.entryCount', entries.length);
      const pending = new Map<HTMLElement, number | undefined>();
      for (const entry of entries) {
        if (entry.target.instanceOf(OwnerHTMLElement)) {
          const borderBox = entry.borderBoxSize[0];
          pending.set(entry.target, borderBox?.blockSize ?? entry.contentRect.height);
        }
      }
      updateBatch(pending);
    });
    const state: ImageObservationState = {
      contentEl,
      mutationObserver: new MutationObserverConstructor((records) => {
        this.performanceMonitor?.counter('imageSnap.mutationObserver.callback');
        const added = new Set<HTMLElement>();
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (!isOwnerElement(node)) continue;
            if (node.matches('img')) added.add(node);
            for (const image of node.querySelectorAll<HTMLElement>('img')) added.add(image);
          }
          for (const image of state.observedImages) {
            if (!image.isConnected || [...record.removedNodes].some((removed) =>
              isOwnerElement(removed) && (removed === image || removed.contains(image)))) {
              state.resizeObserver.unobserve(image);
              state.observedImages.delete(image);
              image.style.removeProperty('--templar-image-snap');
            }
          }
        }
        const pending = new Map<HTMLElement, number | undefined>();
        for (const image of added) {
          if (state.observedImages.has(image)) continue;
          state.observedImages.add(image);
          state.resizeObserver.observe(image);
          pending.set(image, undefined);
          this.performanceMonitor?.counter('imageSnap.discovery.incremental');
        }
        updateBatch(pending);
        this.performanceMonitor?.gauge('imageSnap.observedImages', state.observedImages.size);
      }),
      observedImages: new Set(),
      resizeObserver,
    };
    scanImages = (): void => {
      const scan = (): void => {
      this.performanceMonitor?.counter('imageSnap.discovery.fullScan');
      const nextImages = new Set(
        contentEl.querySelectorAll<HTMLElement>(`.${TEMPLAR_PAGE_CLASS} img`),
      );
      for (const image of state.observedImages) {
        if (!nextImages.has(image)) resizeObserver.unobserve(image);
      }
      const initial = new Map<HTMLElement, number | undefined>();
      for (const image of nextImages) {
        if (!state.observedImages.has(image)) {
          resizeObserver.observe(image);
          initial.set(image, undefined);
        }
      }
      state.observedImages = nextImages;
      this.performanceMonitor?.gauge('imageSnap.observedImages', nextImages.size);
      };
      if (this.performanceMonitor) this.performanceMonitor.measureSync('imageSnap.scan', scan);
      else scan();
    };
    state.mutationObserver.observe(contentEl, { childList: true, subtree: true });
    this.states.set(leaf, state);
    scanImages();
    const initial = new Map<HTMLElement, number | undefined>();
    for (const image of state.observedImages) initial.set(image, undefined);
    updateBatch(initial);
  }

  public clear(leaf: WorkspaceLeaf): void {
    const state = this.states.get(leaf);
    state?.resizeObserver.disconnect();
    state?.mutationObserver.disconnect();
    if (state) this.cleanupOwnedDom(state.contentEl);
    this.states.delete(leaf);
    this.performanceMonitor?.gauge('imageSnap.states', this.states.size);
    this.performanceMonitor?.gauge(
      'imageSnap.observedImages',
      this.observedImageCount(),
    );
  }

  public destroy(): void {
    for (const leaf of [...this.states.keys()]) this.clear(leaf);
  }

  public snapshot(): Record<string, number> {
    return {
      states: this.states.size,
      observedImages: this.observedImageCount(),
    };
  }

  private cleanupOwnedDom(contentEl: HTMLElement): void {
    contentEl.querySelectorAll<HTMLElement>('img').forEach((image) => {
      image.style.removeProperty('--templar-image-snap');
    });
  }

  private observedImageCount(): number {
    let count = 0;
    for (const state of this.states.values()) count += state.observedImages.size;
    return count;
  }
}

/** Pure image-tail calculation kept available for focused geometry tests. */
export function imageSnapPixels(footprint: number, unit: number): number {
  return round(imageGridCompensation(footprint, unit));
}
