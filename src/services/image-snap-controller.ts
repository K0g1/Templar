import type { TemplarNoteStyle } from '../types';
import { TEMPLAR_PAGE_CLASS } from '../constants';
import { imageGridCompensation } from '../utils/grid';
import { round } from '../utils/value';

interface ImageObservationState {
  mutationObserver: MutationObserver;
  observedImages: Set<HTMLElement>;
  resizeObserver: ResizeObserver;
}

/**
 * Observes images inside a styled view and compensates their height to the
 * baseline grid via a CSS custom property. Owns its observers and cleans up
 * on detach, so the renderer never leaks image listeners.
 */
export class ImageSnapController {
  private readonly observers = new Map<HTMLElement, ImageObservationState>();

  public configure(contentEl: HTMLElement, style: TemplarNoteStyle): void {
    this.disconnect(contentEl);
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
    this.observers.set(contentEl, state);
    scanImages();
  }

  public disconnect(contentEl: HTMLElement): void {
    const state = this.observers.get(contentEl);
    if (!state) {
      return;
    }
    state.resizeObserver.disconnect();
    state.mutationObserver.disconnect();
    this.observers.delete(contentEl);
  }

  public disconnectAll(): void {
    for (const state of this.observers.values()) {
      state.resizeObserver.disconnect();
      state.mutationObserver.disconnect();
    }
    this.observers.clear();
  }
}
