import type { WorkspaceLeaf } from 'obsidian';
import { TEMPLAR_PAGE_CLASS } from '../../constants';
import type { TemplarNoteStyle } from '../../types';
import { gridCompensation, naturalOuterFootprint } from '../../utils/grid';
import { round } from '../../utils/value';
import { realmFor } from '../dom-realm';

const VARIABLE_BLOCK_SELECTORS = [
  'table', '.mermaid', '[class*="block-language-"]', '.math-block', '.callout',
  '.internal-embed', '.file-embed', 'pre', 'details', 'figure', 'iframe',
  'object', 'video', 'audio', 'canvas', '.cm-table-widget', '.cm-embed-block',
] as const;

interface RhythmObservationState {
  contentEl: HTMLElement;
  frame: number | null;
  mutationObserver: MutationObserver;
  needsScan: boolean;
  observedBlocks: Set<HTMLElement>;
  pendingMeasurements: Map<HTMLElement, number | undefined>;
  resizeObserver: ResizeObserver;
  view: Window;
}

/** Owns variable-block baseline observers and their per-leaf cleanup. */
export class VariableBlockRhythmController {
  private readonly states = new Map<WorkspaceLeaf, RhythmObservationState>();

  public configure(
    leaf: WorkspaceLeaf,
    contentEl: HTMLElement,
    style: TemplarNoteStyle,
  ): void {
    this.clear(leaf, contentEl);
    let realm;
    try {
      realm = realmFor(contentEl);
    } catch {
      return;
    }
    const view = realm.window;
    const ResizeObserverConstructor = realm.ResizeObserver;
    const MutationObserverConstructor = realm.MutationObserver;
    const OwnerHTMLElement = (realm.window as Window & { HTMLElement: typeof HTMLElement }).HTMLElement;
    const enabled =
      style.baseline.enabled &&
      style.baseline.mode !== 'free' &&
      ResizeObserverConstructor !== null &&
      MutationObserverConstructor !== null;
    if (!enabled || !ResizeObserverConstructor || !MutationObserverConstructor) return;

    const update = (block: HTMLElement, measuredHeight?: number): void => {
      const marginTail = block.matches('table, iframe, object, video, audio, canvas');
      const computed = view.getComputedStyle(block);
      if (!block.style.getPropertyValue('--templar-grid-natural-margin-end')) {
        block.style.setProperty(
          '--templar-grid-natural-margin-end',
          computed.marginBlockEnd || computed.marginBottom || '0px',
        );
      }
      block.addClass('templar-grid-snap-block');
      const previous = Number.parseFloat(
        block.style.getPropertyValue('--templar-grid-snap'),
      ) || 0;
      const naturalHeight = naturalOuterFootprint(
        measuredHeight ?? block.offsetHeight,
        Number.parseFloat(computed.marginBlockStart || computed.marginTop) || 0,
        Number.parseFloat(block.style.getPropertyValue('--templar-grid-natural-margin-end')) || 0,
        previous,
        !marginTail,
      );
      if (naturalHeight <= 0) return;
      const compensation = round(gridCompensation(naturalHeight, style.baseline.unit));
      if (Math.abs(compensation - previous) < 0.01) return;
      block.style.setProperty('--templar-grid-snap', `${String(compensation)}px`);
    };

    let state: RhythmObservationState;
    let scanBlocks: () => void;
    const flush = (): void => {
      state.frame = null;
      if (state.needsScan) {
        state.needsScan = false;
        scanBlocks();
      }
      const pending = Array.from(state.pendingMeasurements.entries());
      state.pendingMeasurements.clear();
      for (const [block, measuredHeight] of pending) {
        if (state.observedBlocks.has(block) && block.isConnected) update(block, measuredHeight);
      }
    };
    const scheduleFrame = (): void => {
      if (state.frame === null) state.frame = view.requestAnimationFrame(flush);
    };
    const resizeObserver = new ResizeObserverConstructor((entries) => {
      for (const entry of entries) {
        if (!entry.target.instanceOf(OwnerHTMLElement)) continue;
        const borderBox = entry.borderBoxSize[0];
        state.pendingMeasurements.set(
          entry.target,
          borderBox?.blockSize ?? entry.contentRect.height,
        );
      }
      scheduleFrame();
    });
    state = {
      contentEl,
      frame: null,
      mutationObserver: new MutationObserverConstructor(() => {
        state.needsScan = true;
        scheduleFrame();
      }),
      needsScan: false,
      observedBlocks: new Set(),
      pendingMeasurements: new Map(),
      resizeObserver,
      view,
    };
    scanBlocks = (): void => {
      const nextBlocks = new Set<HTMLElement>();
      const selector = VARIABLE_BLOCK_SELECTORS
        .map((candidate) => `.${TEMPLAR_PAGE_CLASS} ${candidate}`)
        .join(',');
      for (const element of contentEl.querySelectorAll<HTMLElement>(selector)) {
        const owner = this.variableBlockOwner(element);
        if (owner) nextBlocks.add(owner);
      }
      for (const block of state.observedBlocks) {
        if (nextBlocks.has(block)) continue;
        resizeObserver.unobserve(block);
        state.pendingMeasurements.delete(block);
        this.clearBlock(block);
      }
      for (const block of nextBlocks) {
        if (!state.observedBlocks.has(block)) resizeObserver.observe(block);
        update(block);
      }
      state.observedBlocks = nextBlocks;
    };
    state.mutationObserver.observe(contentEl, { childList: true, subtree: true });
    this.states.set(leaf, state);
    scanBlocks();
  }

  public clear(leaf: WorkspaceLeaf, contentEl?: HTMLElement): void {
    const state = this.states.get(leaf);
    if (state?.frame !== null && state) state.view.cancelAnimationFrame(state.frame);
    state?.resizeObserver.disconnect();
    state?.mutationObserver.disconnect();
    const root = contentEl ?? state?.contentEl;
    root?.querySelectorAll<HTMLElement>('.templar-grid-snap-block').forEach((block) => this.clearBlock(block));
    this.states.delete(leaf);
  }

  public destroy(): void {
    for (const [leaf, state] of this.states) this.clear(leaf, state.contentEl);
  }

  private variableBlockOwner(element: HTMLElement): HTMLElement | null {
    if (element.closest('.mod-frontmatter, .metadata-container')) return null;
    const editorWidget = element.closest<HTMLElement>('.cm-table-widget, .cm-embed-block');
    if (editorWidget) return editorWidget;
    const readingRoot = element.closest<HTMLElement>('.markdown-preview-section');
    if (readingRoot) {
      let owner = element;
      while (owner.parentElement && owner.parentElement !== readingRoot) owner = owner.parentElement;
      return owner === readingRoot ? element : owner;
    }
    return element.closest(`.${TEMPLAR_PAGE_CLASS}`) ? element : null;
  }

  private clearBlock(block: HTMLElement): void {
    block.removeClass('templar-grid-snap-block');
    block.style.removeProperty('--templar-grid-snap');
    block.style.removeProperty('--templar-grid-natural-margin-end');
  }
}

/** Pure variable-block correction; kept available for focused geometry tests. */
export function variableBlockSnapPixels(footprint: number, unit: number): number {
  return round(gridCompensation(footprint, unit));
}
