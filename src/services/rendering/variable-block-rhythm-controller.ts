import type { WorkspaceLeaf } from 'obsidian';
import { TEMPLAR_PAGE_CLASS } from '../../constants';
import type { TemplarNoteStyle } from '../../types';
import { gridCompensation, naturalOuterFootprint } from '../../utils/grid';
import { round } from '../../utils/value';
import { realmFor } from '../dom-realm';
import type { PerformanceMonitor } from '../../performance/performance-monitor';

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
  pendingInitialBlocks: Set<HTMLElement>;
  resizeObserver: ResizeObserver;
  view: Window;
}

/** Owns variable-block baseline observers and their per-leaf cleanup. */
export class VariableBlockRhythmController {
  private readonly states = new Map<WorkspaceLeaf, RhythmObservationState>();

  public constructor(private readonly performanceMonitor?: PerformanceMonitor) {}

  public configure(
    leaf: WorkspaceLeaf,
    contentEl: HTMLElement,
    style: TemplarNoteStyle,
  ): void {
    this.performanceMonitor?.counter('rhythm.configure.count');
    this.clear(leaf);
    this.cleanupOwnedDom(contentEl);
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

    const selector = VARIABLE_BLOCK_SELECTORS.join(',');
    const isOwnerElement = (node: Node): node is HTMLElement =>
      node.nodeType === 1 && (node as HTMLElement).ownerDocument === contentEl.ownerDocument;
    const discoverInNode = (node: Node, into: Set<HTMLElement>): void => {
      if (!isOwnerElement(node)) return;
      if (node.matches(selector)) {
        const owner = this.variableBlockOwner(node);
        if (owner) into.add(owner);
      }
      for (const element of node.querySelectorAll<HTMLElement>(selector)) {
        const owner = this.variableBlockOwner(element);
        if (owner) into.add(owner);
      }
    };

    interface Measurement {
      block: HTMLElement;
      marginStart: number;
      marginEnd: number;
      marginTail: boolean;
      naturalMarginEnd: string;
      measuredHeight?: number;
      previous: number;
    }

    const applyBatch = (entries: Map<HTMLElement, number | undefined>): void => {
      const blocks = [...entries.keys()].filter((block) =>
        state.observedBlocks.has(block) && block.isConnected,
      );
      if (blocks.length === 0) return;
      this.performanceMonitor?.counter('rhythm.batch.read', 1);
      const measurements: Measurement[] = blocks.map((block) => {
        const computed = view.getComputedStyle(block);
        const existingNatural = block.style.getPropertyValue('--templar-grid-natural-margin-end');
        const naturalMarginEnd = existingNatural || computed.marginBlockEnd || computed.marginBottom || '0px';
        return {
          block,
          marginStart: Number.parseFloat(computed.marginBlockStart || computed.marginTop) || 0,
          marginEnd: Number.parseFloat(naturalMarginEnd) || 0,
          marginTail: block.matches('table, iframe, object, video, audio, canvas'),
          naturalMarginEnd,
          measuredHeight: entries.get(block),
          previous: Number.parseFloat(block.style.getPropertyValue('--templar-grid-snap')) || 0,
        };
      });
      // Ownership/class writes happen only after all natural-style reads.
      for (const measurement of measurements) {
        if (!measurement.block.style.getPropertyValue('--templar-grid-natural-margin-end')) {
          measurement.block.style.setProperty('--templar-grid-natural-margin-end', measurement.naturalMarginEnd);
        }
        measurement.block.addClass('templar-grid-snap-block');
      }
      const writes: Array<{ block: HTMLElement; compensation: number; previous: number }> = [];
      // All fallback geometry reads happen before any compensation write.
      for (const measurement of measurements) {
        const naturalHeight = naturalOuterFootprint(
          measurement.measuredHeight ?? this.readOffsetHeight(measurement.block),
          measurement.marginStart,
          measurement.marginEnd,
          measurement.previous,
          !measurement.marginTail,
        );
        if (naturalHeight <= 0) continue;
        writes.push({
          block: measurement.block,
          compensation: round(gridCompensation(naturalHeight, style.baseline.unit)),
          previous: measurement.previous,
        });
      }
      this.performanceMonitor?.counter('rhythm.batch.write', 1);
      for (const write of writes) {
        if (Math.abs(write.compensation - write.previous) < 0.01) {
          this.performanceMonitor?.counter('rhythm.css.write.avoided');
          continue;
        }
        this.performanceMonitor?.counter('rhythm.css.write.changed');
        write.block.style.setProperty('--templar-grid-snap', `${String(write.compensation)}px`);
      }
    };

    let state: RhythmObservationState;
    let scanBlocks: () => void;
    const flush = (): void => {
      state.frame = null;
      if (state.needsScan) {
        state.needsScan = false;
        scanBlocks();
      }
      const pending = new Map(state.pendingMeasurements);
      state.pendingMeasurements.clear();
      for (const block of state.pendingInitialBlocks) pending.set(block, pending.get(block));
      state.pendingInitialBlocks.clear();
      if (pending.size > 0) applyBatch(pending);
    };
    const scheduleFrame = (): void => {
      this.performanceMonitor?.counter('rhythm.raf.schedule');
      if (state.frame !== null) {
        this.performanceMonitor?.counter('rhythm.raf.dedupe');
        return;
      }
      state.frame = view.requestAnimationFrame(() => {
        this.performanceMonitor?.counter('rhythm.raf.execute');
        flush();
      });
    };
    const resizeObserver = new ResizeObserverConstructor((entries) => {
      this.performanceMonitor?.counter('rhythm.resizeObserver.callback');
      this.performanceMonitor?.counter('rhythm.resizeObserver.entryCount', entries.length);
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
      mutationObserver: new MutationObserverConstructor((records) => {
        this.performanceMonitor?.counter('rhythm.mutationObserver.callback');
        this.performanceMonitor?.counter('rhythm.discovery.incremental');
        const added = new Set<HTMLElement>();
        for (const record of records) {
          for (const node of record.addedNodes) discoverInNode(node, added);
          for (const block of state.observedBlocks) {
            if (!block.isConnected || [...record.removedNodes].some((removed) =>
              isOwnerElement(removed) && (removed === block || removed.contains(block)))) {
              state.resizeObserver.unobserve(block);
              state.pendingMeasurements.delete(block);
              state.pendingInitialBlocks.delete(block);
              state.observedBlocks.delete(block);
              this.clearBlock(block);
            }
          }
        }
        for (const block of added) {
          if (state.observedBlocks.has(block)) continue;
          state.observedBlocks.add(block);
          state.pendingInitialBlocks.add(block);
          state.resizeObserver.observe(block);
          this.performanceMonitor?.counter('rhythm.newBlocks');
        }
        scheduleFrame();
      }),
      needsScan: false,
      observedBlocks: new Set(),
      pendingMeasurements: new Map(),
      pendingInitialBlocks: new Set(),
      resizeObserver,
      view,
    };
    scanBlocks = (): void => {
      const scan = (): void => {
      this.performanceMonitor?.counter('rhythm.discovery.fullScan');
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
      const initial = new Map<HTMLElement, number | undefined>();
      for (const block of nextBlocks) {
        if (!state.observedBlocks.has(block)) {
          resizeObserver.observe(block);
          state.pendingInitialBlocks.add(block);
          initial.set(block, undefined);
        } else {
          this.performanceMonitor?.counter('rhythm.existingBlocksSkipped');
        }
      }
      state.observedBlocks = nextBlocks;
      for (const block of initial.keys()) state.pendingInitialBlocks.add(block);
      this.performanceMonitor?.gauge('rhythm.observedBlocks', nextBlocks.size);
      this.performanceMonitor?.gauge('rhythm.pendingMeasurements', state.pendingMeasurements.size);
      };
      if (this.performanceMonitor) this.performanceMonitor.measureSync('rhythm.scan', scan);
      else scan();
    };
    state.mutationObserver.observe(contentEl, { childList: true, subtree: true });
    this.states.set(leaf, state);
    scanBlocks();
    const initial = new Map<HTMLElement, number | undefined>();
    for (const block of state.pendingInitialBlocks) initial.set(block, undefined);
    state.pendingInitialBlocks.clear();
    applyBatch(initial);
  }

  public clear(leaf: WorkspaceLeaf): void {
    const state = this.states.get(leaf);
    if (state?.frame !== null && state) state.view.cancelAnimationFrame(state.frame);
    state?.resizeObserver.disconnect();
    state?.mutationObserver.disconnect();
    if (state) this.cleanupOwnedDom(state.contentEl);
    this.states.delete(leaf);
    this.performanceMonitor?.gauge('rhythm.states', this.states.size);
    this.performanceMonitor?.gauge('rhythm.observedBlocks', this.observedBlockCount());
    this.performanceMonitor?.gauge('rhythm.pendingMeasurements', this.pendingMeasurementCount());
  }

  public destroy(): void {
    for (const leaf of [...this.states.keys()]) this.clear(leaf);
  }

  public snapshot(): Record<string, number> {
    return {
      states: this.states.size,
      observedBlocks: this.observedBlockCount(),
      pendingMeasurements: this.pendingMeasurementCount(),
    };
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

  private readOffsetHeight(block: HTMLElement): number {
    this.performanceMonitor?.counter('rhythm.offsetHeight.fallbackRead');
    return block.offsetHeight;
  }

  private cleanupOwnedDom(contentEl: HTMLElement): void {
    contentEl.querySelectorAll<HTMLElement>('.templar-grid-snap-block').forEach((block) => this.clearBlock(block));
  }

  private observedBlockCount(): number {
    let count = 0;
    for (const state of this.states.values()) count += state.observedBlocks.size;
    return count;
  }

  private pendingMeasurementCount(): number {
    let count = 0;
    for (const state of this.states.values()) count += state.pendingMeasurements.size;
    return count;
  }
}

/** Pure variable-block correction; kept available for focused geometry tests. */
export function variableBlockSnapPixels(footprint: number, unit: number): number {
  return round(gridCompensation(footprint, unit));
}
