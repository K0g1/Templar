import type { WorkspaceLeaf } from 'obsidian';
import { TEMPLAR_PAGE_CLASS } from '../../constants';
import type { TemplarNoteStyle } from '../../types';
import { imageGridCompensation } from '../../utils/grid';
import { round } from '../../utils/value';
import { realmFor } from '../dom-realm';

interface ImageObservationState {
  mutationObserver: MutationObserver;
  observedImages: Set<HTMLElement>;
  resizeObserver: ResizeObserver;
  contentEl: HTMLElement;
}

/** Owns image baseline observers and their per-leaf cleanup. */
export class ImageSnapController {
  private readonly states = new Map<WorkspaceLeaf, ImageObservationState>();

  public configure(
    leaf: WorkspaceLeaf,
    contentEl: HTMLElement,
    style: TemplarNoteStyle,
  ): void {
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
    const enabled =
      style.baseline.enabled &&
      style.baseline.mode !== 'free' &&
      style.baseline.snapImages &&
      ResizeObserverConstructor !== null &&
      MutationObserverConstructor !== null;
    if (!enabled || !ResizeObserverConstructor || !MutationObserverConstructor) {
      return;
    }

    const update = (image: HTMLElement): void => {
      // offsetHeight is the untransformed layout border box. A client rect is
      // contaminated by paged-mode zoom and decorative rotation.
      const height = image.offsetHeight;
      if (height <= 0) return;
      const previous = Number.parseFloat(
        image.style.getPropertyValue('--templar-image-snap'),
      ) || 0;
      const computed = contentEl.ownerDocument.defaultView?.getComputedStyle(image);
      const footprint = height +
        (Number.parseFloat(computed?.marginBlockStart ?? computed?.marginTop ?? '0') || 0) +
        (Number.parseFloat(computed?.marginBlockEnd ?? computed?.marginBottom ?? '0') || 0) -
        previous;
      const compensation = imageGridCompensation(footprint, style.baseline.unit);
      image.style.setProperty('--templar-image-snap', `${String(round(compensation))}px`);
    };

    let scanImages: () => void;
    const resizeObserver = new ResizeObserverConstructor((entries) => {
      for (const entry of entries) {
        if (entry.target.instanceOf(OwnerHTMLElement)) update(entry.target);
      }
    });
    const state: ImageObservationState = {
      contentEl,
      mutationObserver: new MutationObserverConstructor(() => scanImages()),
      observedImages: new Set(),
      resizeObserver,
    };
    scanImages = (): void => {
      const nextImages = new Set(
        contentEl.querySelectorAll<HTMLElement>(`.${TEMPLAR_PAGE_CLASS} img`),
      );
      for (const image of state.observedImages) {
        if (!nextImages.has(image)) resizeObserver.unobserve(image);
      }
      for (const image of nextImages) {
        if (!state.observedImages.has(image)) resizeObserver.observe(image);
        update(image);
      }
      state.observedImages = nextImages;
    };
    state.mutationObserver.observe(contentEl, { childList: true, subtree: true });
    this.states.set(leaf, state);
    scanImages();
  }

  public clear(leaf: WorkspaceLeaf): void {
    const state = this.states.get(leaf);
    state?.resizeObserver.disconnect();
    state?.mutationObserver.disconnect();
    if (state) this.cleanupOwnedDom(state.contentEl);
    this.states.delete(leaf);
  }

  public destroy(): void {
    for (const leaf of [...this.states.keys()]) this.clear(leaf);
  }

  private cleanupOwnedDom(contentEl: HTMLElement): void {
    contentEl.querySelectorAll<HTMLElement>('img').forEach((image) => {
      image.style.removeProperty('--templar-image-snap');
    });
  }
}

/** Pure image-tail calculation kept available for focused geometry tests. */
export function imageSnapPixels(footprint: number, unit: number): number {
  return round(imageGridCompensation(footprint, unit));
}
