import type { WorkspaceLeaf } from 'obsidian';
import type { FontMetrics, TemplarNoteStyle } from '../../../types';
import { TEMPLAR_CONTENT_CLASS } from '../../../constants';
import { alignedPageGap, measuredGeometryScale } from '../../../utils/grid';
import { round } from '../../../utils/value';
import type { PageMetricSet } from '../../style-compiler';
import { realmFor, type DomRealm } from '../../dom-realm';
import {
  BASELINE_GRID_ATOMIC_CLASS,
  BASELINE_GRID_INTENTIONAL_CLASS,
  BASELINE_GRID_ITEM_CLASS,
  BASELINE_GRID_LIST_ITEM_CLASS,
  collectFlowItems,
  flowTarget,
  isAtomicKind,
  isTextKind,
  classifyFlowElement,
} from './classifier';
import {
  distanceToGrid,
  exitTailToGrid,
  nearestGridDelta,
  nearestLegalGridDelta,
  nextGridDelta,
  type GridLattice,
} from './math';
import type {
  BaselineGridDebugSnapshot,
  BaselineGridRootState,
  BaselineGridStats,
  BaselineView,
  RhythmCorrection,
  RhythmKind,
  RhythmMeasurement,
} from './types';

const BASELINE_BEFORE_PROPERTY = '--templar-grid-before';
const BASELINE_AFTER_PROPERTY = '--templar-grid-after';
const NATURAL_MARGIN_BEFORE_PROPERTY = '--templar-grid-natural-margin-before';
const NATURAL_MARGIN_AFTER_PROPERTY = '--templar-grid-natural-margin-after';
const LIST_SHIFT_PROPERTY = '--templar-grid-list-shift';
const PREFIX_SHIFT_PROPERTY = '--templar-grid-prefix-shift';
const PREFIX_NATURAL_MARGIN_PROPERTY = '--templar-grid-prefix-natural-margin-end';
const PREFIX_CLASS = 'templar-baseline-grid-prefix';
const COMPOSITE_TEXT_SHIFT_PROPERTY = '--templar-grid-composite-text-shift';
const COMPOSITE_TEXT_CLASS = 'templar-baseline-grid-composite-text';
const OWNER_PROPERTY = 'data-templar-baseline-owner';
const DEFAULT_TOLERANCE = 0.4;
const CORRECTION_STABILITY_EPSILON = 0.02;
const MAX_SETTLE_PASSES = 8;

const COMPOSITE_TEXT_SELECTOR = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'pre > code', '.callout-title', 'th', 'td',
].join(',');

const RENDERER_ATOMIC_SELECTOR = [
  '.internal-embed', '.file-embed', '.markdown-embed', '.mermaid',
  '[class*="block-language-"]', '.math-block', 'figure', 'details',
  'iframe', 'object', 'video', 'audio', 'canvas', 'img',
].join(',');

interface RootRuntime extends BaselineGridRootState {
  geometryScale: number;
  parent: HTMLElement;
  prefixElement: HTMLElement | null;
}

interface ObservationState {
  contentEl: HTMLElement;
  realm: DomRealm;
  style: TemplarNoteStyle;
  metrics: PageMetricSet;
  roots: RootRuntime[];
  frame: number | null;
  dirty: Set<HTMLElement>;
  needsFullScan: boolean;
  settlePasses: number;
  debug: boolean;
  mutationObserver: MutationObserver;
  resizeObserver: ResizeObserver;
  observedTargets: Set<HTMLElement>;
  observedSizes: Map<HTMLElement, { width: number; height: number }>;
  stats: BaselineGridStats;
  view: Window;
}

function parsePixels(value: string | null | undefined): number {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function nonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function isHTMLElement(element: Element): element is HTMLElement {
  const constructor = element.ownerDocument.defaultView?.HTMLElement;
  return constructor !== undefined && element.instanceOf(constructor);
}

function metricForElement(element: HTMLElement, metrics: PageMetricSet): FontMetrics {
  for (const level of [1, 2, 3, 4, 5, 6] as const) {
    if (element.tagName === `H${String(level)}` || element.hasClass(`HyperMD-header-${String(level)}`)) {
      return metrics[`h${String(level)}` as keyof Pick<
        PageMetricSet,
        'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
      >];
    }
  }
  if (element.tagName === 'PRE' || element.tagName === 'CODE' ||
    element.hasClass('HyperMD-codeblock') || element.closest('pre')) {
    return metrics.code;
  }
  return metrics.body;
}

function firstBaselineTarget(element: HTMLElement, kind: RhythmKind, view: BaselineView): HTMLElement | null {
  const semantic = flowTarget(element, view);
  if (kind === 'heading' || kind === 'editor-line') {
    return semantic;
  }
  if (kind === 'text') {
    if (semantic.matches('blockquote')) {
      return semantic.querySelector<HTMLElement>('p, li, pre, code') ?? semantic;
    }
    return semantic;
  }
  if (kind === 'code') {
    return semantic.matches('pre')
      ? semantic.querySelector<HTMLElement>(':scope > code') ?? semantic
      : semantic;
  }
  if (kind === 'list') {
    return semantic.querySelector<HTMLElement>(':scope > li, :scope li');
  }
  if (kind === 'composite') {
    if (semantic.matches('table')) return semantic.querySelector<HTMLElement>('th, td');
    if (semantic.matches('blockquote')) {
      return semantic.querySelector<HTMLElement>('p, li, pre, code') ?? semantic;
    }
    if (semantic.matches('.callout')) {
      return semantic.querySelector<HTMLElement>('.callout-title, .callout-content p, .callout-content li, .callout-content code');
    }
  }
  if (kind === 'editor-widget') {
    return semantic.querySelector<HTMLElement>('.cm-line, p, td, th, .callout-title');
  }
  return null;
}

function compositeTextTargets(semantic: HTMLElement): HTMLElement[] {
  return [...semantic.querySelectorAll<HTMLElement>(COMPOSITE_TEXT_SELECTOR)].filter((target) => {
    // A list item's visual line is corrected as a unit, including its marker;
    // shifting the nested paragraph as well would apply the same correction
    // twice. Renderer-owned embeds likewise retain their own internal layout.
    if (target.closest('li')) return false;
    const renderer = target.closest<HTMLElement>(RENDERER_ATOMIC_SELECTOR);
    return !renderer || renderer === semantic;
  });
}

function compositeTextShift(element: HTMLElement): number {
  return parsePixels(element.style.getPropertyValue(COMPOSITE_TEXT_SHIFT_PROPERTY));
}

function baselineFor(
  element: HTMLElement,
  kind: RhythmKind,
  contentRect: DOMRect,
  scale: number,
  metrics: PageMetricSet,
  view: Window,
  viewType: BaselineView,
): number | undefined {
  const target = firstBaselineTarget(element, kind, viewType);
  if (!target) return undefined;
  const rect = target.getBoundingClientRect();
  if (rect.height <= 0 && rect.width <= 0) return undefined;
  const computed = view.getComputedStyle(target);
  const metric = metricForElement(target, metrics);
  const listShift = parsePixels(
    target.closest<HTMLElement>(`.${BASELINE_GRID_LIST_ITEM_CLASS}`)?.style.getPropertyValue(LIST_SHIFT_PROPERTY),
  );
  const innerTextShift = compositeTextShift(target);
  return (rect.top - contentRect.top) / scale +
    parsePixels(computed.paddingTop) +
    parsePixels(computed.borderTopWidth) +
    metric.baseline - listShift - innerTextShift;
}

function pageIndexFor(position: number, style: TemplarNoteStyle, unit: number): number {
  if (style.page.mode !== 'paged') return 0;
  const gap = style.baseline.enabled && style.baseline.mode !== 'free'
    ? alignedPageGap(style.page.height, style.page.gap, unit)
    : style.page.gap;
  const span = style.page.height + gap;
  return span > 0 ? Math.max(0, Math.floor(Math.max(0, position) / span)) : 0;
}

function elementId(element: HTMLElement, index: number): string {
  const existing = element.dataset.templarBaselineId;
  if (existing) return existing;
  const id = `baseline-${String(index + 1)}`;
  element.dataset.templarBaselineId = id;
  return id;
}

function addSvgElement(document: Document, name: string): SVGElement {
  return document.createElementNS('http://www.w3.org/2000/svg', name);
}

/** One SVG layer per page content; it never participates in note layout. */
class BaselineDebugOverlay {
  public clear(contentEl: HTMLElement): void {
    contentEl.querySelectorAll<HTMLElement>('.templar-baseline-debug-overlay').forEach((element) => element.remove());
  }

  public render(snapshot: BaselineGridDebugSnapshot): void {
    const document = snapshot.root.ownerDocument;
    this.clear(snapshot.root);
    const svg = addSvgElement(document, 'svg') as SVGSVGElement;
    svg.classList.add('templar-baseline-debug-overlay');
    svg.dataset.templarOwned = 'true';
    svg.setAttribute('aria-hidden', 'true');
    const height = Math.max(snapshot.root.offsetHeight, snapshot.root.getBoundingClientRect().height, snapshot.origin + snapshot.unit);
    const width = Math.max(snapshot.root.offsetWidth, snapshot.root.getBoundingClientRect().width, 1);
    svg.setAttribute('viewBox', `0 0 ${String(width)} ${String(height)}`);
    svg.setAttribute('preserveAspectRatio', 'none');

    const addLine = (y: number, color: string, opacity: string, widthValue: string): void => {
      const line = addSvgElement(document, 'line');
      line.setAttribute('x1', '0');
      line.setAttribute('x2', String(width));
      line.setAttribute('y1', String(y));
      line.setAttribute('y2', String(y));
      line.setAttribute('stroke', color);
      line.setAttribute('stroke-opacity', opacity);
      line.setAttribute('stroke-width', widthValue);
      svg.append(line);
    };
    for (let y = snapshot.origin; y <= height; y += snapshot.unit) {
      addLine(y, '#2f9e44', '0.3', '1');
    }
    for (const point of snapshot.points) {
      if (point.kind === 'grid') continue;
      const circle = addSvgElement(document, 'circle');
      circle.setAttribute('cx', String(Math.max(3, Math.min(width - 3, point.x))));
      circle.setAttribute('cy', String(point.y));
      circle.setAttribute('r', point.kind === 'failure' ? '4' : '3');
      circle.setAttribute('fill', point.kind === 'failure' ? '#d63939' : point.kind === 'baseline' ? '#2f9e44' : '#228be6');
      circle.setAttribute('data-baseline-id', point.id);
      if (point.error !== undefined) circle.setAttribute('data-baseline-error', String(round(point.error, 3)));
      svg.append(circle);
      const label = addSvgElement(document, 'text');
      label.setAttribute('x', String(Math.min(width - 3, Math.max(3, point.x + 6))));
      label.setAttribute('y', String(point.y - 5));
      label.setAttribute('fill', '#1f2937');
      label.setAttribute('font-size', '8');
      label.setAttribute('font-family', 'monospace');
      label.setAttribute('pointer-events', 'none');
      label.textContent = point.id;
      svg.append(label);
    }
    snapshot.root.append(svg);
  }
}

/**
 * Owns the fixed-lattice correction pass for both Reading View and Live
 * Preview.  Paper origin is never measured from a child and scrolling is not
 * an input to this controller.
 */
export class BaselineGridController {
  private readonly states = new Map<WorkspaceLeaf, ObservationState>();
  private readonly overlay = new BaselineDebugOverlay();

  public configure(
    leaf: WorkspaceLeaf,
    configuration: { contentEl: HTMLElement; style: TemplarNoteStyle; metrics: PageMetricSet },
  ): void {
    this.clear(leaf);
    const { contentEl, style, metrics } = configuration;
    this.cleanupOwnedDom(contentEl);
    if (!style.baseline.enabled || style.baseline.mode === 'free') return;
    let realm: DomRealm;
    try {
      realm = realmFor(contentEl);
    } catch {
      return;
    }
    if (!realm.ResizeObserver || !realm.MutationObserver) return;
    const state: ObservationState = {
      contentEl,
      realm,
      style,
      metrics,
      roots: [],
      frame: null,
      dirty: new Set(),
      needsFullScan: true,
      settlePasses: 0,
      debug: false,
      mutationObserver: new realm.MutationObserver((records) => {
        if (!records.some((record) => this.mutationAffectsFlow(record))) return;
        state.stats.mutationObserverCallbacks += 1;
        state.needsFullScan = true;
        this.schedule(leaf);
      }),
      resizeObserver: new realm.ResizeObserver((entries) => {
        state.stats.resizeObserverCallbacks += 1;
        for (const entry of entries) {
          if (!isHTMLElement(entry.target)) continue;
          const nextSize = { width: entry.contentRect.width, height: entry.contentRect.height };
          const previousSize = state.observedSizes.get(entry.target);
          state.observedSizes.set(entry.target, nextSize);
          const widthChanged = !previousSize || Math.abs(previousSize.width - nextSize.width) > 0.01;
          const heightChanged = !previousSize || Math.abs(previousSize.height - nextSize.height) > 0.01;
          if (!widthChanged && !heightChanged) continue;
          const root = state.roots.find((candidate) => candidate.pageContent === entry.target);
          if (root) {
            // CodeMirror's sizer height includes widget margins and can be
            // reported again after our own write. Width changes are real
            // reflow boundaries; height-only root changes are handled by the
            // widget/virtual-gap owner and must not start a scan loop.
            if (root.view === 'reading' || widthChanged) state.needsFullScan = true;
          }
          else state.dirty.add(entry.target);
        }
        this.schedule(leaf);
      }),
      observedTargets: new Set(),
      observedSizes: new Map(),
      stats: this.emptyStats(),
      view: realm.window,
    };
    this.states.set(leaf, state);
    state.mutationObserver.observe(contentEl, { characterData: true, childList: true, subtree: true });
    this.fullScan(leaf, state);
  }

  public refresh(leaf: WorkspaceLeaf): void {
    const state = this.states.get(leaf);
    if (!state) return;
    state.needsFullScan = true;
    this.fullScan(leaf, state);
  }

  public diagnosticRoots(leaf: WorkspaceLeaf): readonly BaselineGridRootState[] {
    return this.states.get(leaf)?.roots ?? [];
  }

  public stats(leaf: WorkspaceLeaf): BaselineGridStats | null {
    const stats = this.states.get(leaf)?.stats;
    return stats ? { ...stats, nonConvergedElements: [...stats.nonConvergedElements] } : null;
  }

  public toggleDebugOverlay(leaf: WorkspaceLeaf): boolean {
    const state = this.states.get(leaf);
    if (!state) return false;
    state.debug = !state.debug;
    if (state.debug) {
      for (const root of state.roots) this.overlay.render(this.debugSnapshot(root));
    } else {
      this.overlay.clear(state.contentEl);
    }
    return state.debug;
  }

  public clear(leaf: WorkspaceLeaf): void {
    const state = this.states.get(leaf);
    if (!state) return;
    if (state.frame !== null) state.view.cancelAnimationFrame(state.frame);
    state.resizeObserver.disconnect();
    state.mutationObserver.disconnect();
    this.cleanupOwnedDom(state.contentEl);
    this.overlay.clear(state.contentEl);
    this.states.delete(leaf);
  }

  public destroy(): void {
    for (const leaf of [...this.states.keys()]) this.clear(leaf);
  }

  private emptyStats(): BaselineGridStats {
    return {
      measurementPasses: 0,
      writePasses: 0,
      nodesMeasured: 0,
      nodesCorrected: 0,
      fullScans: 0,
      dirtyScans: 0,
      resizeObserverCallbacks: 0,
      mutationObserverCallbacks: 0,
      rafCallbacks: 0,
      nonConvergedElements: [],
    };
  }

  private schedule(leaf: WorkspaceLeaf): void {
    const state = this.states.get(leaf);
    if (!state || state.frame !== null) return;
    state.frame = state.view.requestAnimationFrame(() => {
      state.frame = null;
      state.stats.rafCallbacks += 1;
      this.flush(leaf, state);
    });
  }

  private flush(leaf: WorkspaceLeaf, state: ObservationState): void {
    if (state.needsFullScan) {
      this.fullScan(leaf, state);
      return;
    }
    const dirty = [...state.dirty];
    state.dirty.clear();
    if (dirty.length === 0) return;
    state.settlePasses += 1;
    if (state.settlePasses > MAX_SETTLE_PASSES) {
      for (const element of dirty) this.markNonConverged(state, element);
      return;
    }
    state.stats.dirtyScans += 1;
    const rootsToProcess = new Set<RootRuntime>();
    for (const element of dirty) {
      const root = state.roots.find((candidate) => candidate.flowItems.includes(element) || candidate.pageContent === element);
      if (root) rootsToProcess.add(root);
    }
    for (const root of rootsToProcess) {
      const indices = [...root.flowItems.entries()]
        .filter(([, element]) => dirty.includes(element))
        .map(([index]) => index);
      const start = Math.max(0, Math.min(...indices, root.flowItems.length - 1));
      const changed = this.processRoot(root, start, start + 1);
      if (!changed) state.settlePasses = 0;
    }
    if (state.debug) for (const root of rootsToProcess) this.overlay.render(this.debugSnapshot(root));
  }

  private fullScan(leaf: WorkspaceLeaf, state: ObservationState): void {
    state.needsFullScan = false;
    state.dirty.clear();
    state.stats.nonConvergedElements = [];
    state.stats.fullScans += 1;
    const nextRoots = this.collectRoots(state);
    const previousItems = new Set(state.roots.flatMap((root) => root.flowItems));
    const nextItems = new Set(nextRoots.flatMap((root) => root.flowItems));
    for (const element of previousItems) {
      if (!nextItems.has(element)) this.clearElement(element);
    }
    state.roots = nextRoots;
    this.observeTargets(state);
    // A diagnostic command and the first paint must see the settled result,
    // not the pre-correction geometry from the first measurement pass. Keep
    // measurement and mutation separate inside each pass, then synchronously
    // repeat until the absolute correction map stops changing. ResizeObserver
    // remains the incremental path for later layout changes.
    for (const root of state.roots) {
      let settled = false;
      for (let pass = 0; pass < MAX_SETTLE_PASSES; pass += 1) {
        if (!this.processRoot(root, 0)) {
          settled = true;
          break;
        }
      }
      if (!settled) {
        for (const element of root.flowItems) this.markNonConverged(state, element);
      }
    }
    if (state.debug) for (const root of state.roots) this.overlay.render(this.debugSnapshot(root));
    state.settlePasses = 0;
  }

  private collectRoots(state: ObservationState): RootRuntime[] {
    const candidates: HTMLElement[] = [];
    if (state.contentEl.hasClass(TEMPLAR_CONTENT_CLASS)) candidates.push(state.contentEl);
    candidates.push(...state.contentEl.querySelectorAll<HTMLElement>(`.${TEMPLAR_CONTENT_CLASS}`));
    const unique = [...new Set(candidates)];
    return unique.flatMap((pageContent) => {
      const view: BaselineView | null = pageContent.hasClass('cm-sizer') ||
        Boolean(pageContent.querySelector(':scope > .cm-content, :scope > .cm-contentContainer > .cm-content'))
        ? 'live-preview'
        : pageContent.hasClass('markdown-preview-sizer') || pageContent.closest('.markdown-preview-view')
          ? 'reading'
          : null;
      if (!view) return [];
      const parent = view === 'reading'
        ? pageContent.querySelector<HTMLElement>(':scope > .markdown-preview-section') ??
          (pageContent.hasClass('markdown-preview-section') ? pageContent : null)
        : pageContent.querySelector<HTMLElement>(':scope > .cm-content, :scope > .cm-contentContainer > .cm-content');
      if (!parent) return [];
      const pageRect = pageContent.getBoundingClientRect();
      const horizontalScale = measuredGeometryScale(pageRect.width, pageContent.offsetWidth, 1);
      const geometryScale = measuredGeometryScale(pageRect.height, pageContent.offsetHeight, horizontalScale);
      return [{
        pageContent,
        view,
        lattice: {
          unit: state.style.baseline.unit,
          origin: state.style.layout.paddingTop + state.metrics.body.baseline,
          tolerance: DEFAULT_TOLERANCE,
        },
        metrics: state.metrics,
        style: state.style,
        flowItems: collectFlowItems(pageContent, view),
        measurements: new Map(),
        corrections: new Map(),
        geometryScale,
        parent,
        prefixElement: this.prefixElementFor(pageContent, parent, view),
      }];
    });
  }

  private observeTargets(state: ObservationState): void {
    const targets = new Set<HTMLElement>();
    for (const root of state.roots) {
      targets.add(root.pageContent);
      for (const item of root.flowItems) {
        // Ordinary CodeMirror lines have a fixed source footprint and must
        // remain free of controller-owned margins/classes for cursor mapping.
        // Only virtual gaps and rendered widgets can change the following
        // line's phase.
        if (root.view === 'live-preview' && classifyFlowElement(item, root.view) === 'editor-line') continue;
        targets.add(item);
      }
    }
    for (const target of state.observedTargets) {
      if (!targets.has(target)) {
        state.resizeObserver.unobserve(target);
        state.observedSizes.delete(target);
      }
    }
    for (const target of targets) {
      if (!state.observedTargets.has(target)) state.resizeObserver.observe(target);
    }
    state.observedTargets = targets;
  }

  private processRoot(root: RootRuntime, startIndex: number, endIndex = root.flowItems.length): boolean {
    const measurements = this.measureRoot(root, startIndex, endIndex);
    if (measurements.length === 0) return false;
    // Obsidian keeps the inactive editor/view in the DOM and often gives it a
    // zero-sized layout box. It is still safe to mark its owners, but there is
    // no geometry to correct until that view becomes visible. Treating zero
    // geometry as a real position would make the absolute correction bounce
    // forever (the test DOM has the same characteristic).
    const pageRect = root.pageContent.getBoundingClientRect();
    const hidden = pageRect.width <= 0 && pageRect.height <= 0 &&
      root.pageContent.offsetWidth <= 0 && root.pageContent.offsetHeight <= 0;
    if (hidden) {
      const corrections = new Map<HTMLElement, RhythmCorrection>();
      for (const measurement of measurements) {
        corrections.set(measurement.element, { before: 0, after: 0, reason: 'baseline' });
      }
      const changed = measurements.some((measurement) => {
        const previous = root.corrections.get(measurement.element);
        const next = corrections.get(measurement.element);
        return this.correctionChanged(previous, next);
      });
      this.writeCorrections(root, measurements, corrections);
      for (const measurement of measurements) root.measurements.set(measurement.element, measurement);
      for (const [element, correction] of corrections) root.corrections.set(element, correction);
      return changed;
    }
    const prefixChanged = startIndex === 0 && this.writeLivePrefixCorrection(root, measurements);
    const tableRowDeltas = this.prepareTableRows(root, measurements);
    const corrections = this.computeCorrections(root, measurements, startIndex, tableRowDeltas);
    const changed = prefixChanged || measurements.some((measurement) => {
      const previous = root.corrections.get(measurement.element);
      const next = corrections.get(measurement.element);
      return this.correctionChanged(previous, next);
    });
    this.writeCorrections(root, measurements, corrections);
    this.writeListLineCorrections(root, measurements);
    this.writeCompositeTextCorrections(
      root,
      measurements,
      startIndex === 0 && endIndex >= root.flowItems.length,
    );
    for (const measurement of measurements) root.measurements.set(measurement.element, measurement);
    for (const [element, correction] of corrections) root.corrections.set(element, correction);
    return changed;
  }

  private correctionChanged(previous: RhythmCorrection | undefined, next: RhythmCorrection | undefined): boolean {
    if (!previous || !next) return previous !== next;
    // Browser layout can move a box by a few thousandths of a CSS pixel when
    // a scroll anchor or an async renderer settles. That is below the public
    // diagnostic tolerance and must not be reported as non-convergence.
    return Math.abs(previous.before - next.before) > CORRECTION_STABILITY_EPSILON ||
      Math.abs(previous.after - next.after) > CORRECTION_STABILITY_EPSILON;
  }

  private measureRoot(root: RootRuntime, startIndex: number, endIndex = root.flowItems.length): RhythmMeasurement[] {
    const pageRect = root.pageContent.getBoundingClientRect();
    const scale = root.geometryScale > 0 ? root.geometryScale : 1;
    const measurements: RhythmMeasurement[] = [];
    for (let index = startIndex; index < Math.min(endIndex, root.flowItems.length); index += 1) {
      const element = root.flowItems[index]!;
      const kind = classifyFlowElement(element, root.view);
      if (!kind) continue;
      const rect = element.getBoundingClientRect();
      const computed = root.pageContent.ownerDocument.defaultView?.getComputedStyle(element);
      const existingBefore = parsePixels(element.style.getPropertyValue(BASELINE_BEFORE_PROPERTY));
      const existingAfter = parsePixels(element.style.getPropertyValue(BASELINE_AFTER_PROPERTY));
      const naturalBefore = this.naturalMargin(element, computed?.marginBlockStart ?? computed?.marginTop, NATURAL_MARGIN_BEFORE_PROPERTY);
      const naturalAfter = this.naturalMargin(element, computed?.marginBlockEnd ?? computed?.marginBottom, NATURAL_MARGIN_AFTER_PROPERTY);
      const top = (rect.top - pageRect.top) / scale;
      const bottom = (rect.bottom - pageRect.top) / scale;
      const firstBaseline = baselineFor(
        element,
        kind,
        pageRect,
        scale,
        root.metrics,
        root.pageContent.ownerDocument.defaultView ?? window,
        root.view,
      );
      measurements.push({
        element,
        kind,
        top,
        bottom,
        firstBaseline,
        lastBaseline: firstBaseline,
        marginBefore: naturalBefore,
        marginAfter: naturalAfter,
        existingBeforeCorrection: existingBefore,
        existingAfterCorrection: existingAfter,
        pageIndex: pageIndexFor(top, root.style, root.lattice.unit),
        flowIndex: index,
        intentional: kind === 'blank-space',
      });
    }
    const state = [...this.states.values()].find((candidate) => candidate.roots.includes(root));
    if (state) {
      state.stats.measurementPasses += 1;
      state.stats.nodesMeasured += measurements.length;
    }
    return measurements;
  }

  private naturalMargin(element: HTMLElement, current: string | undefined, property: string): number {
    const stored = parsePixels(element.style.getPropertyValue(property));
    if (element.style.getPropertyValue(property)) return stored;
    const value = nonNegative(parsePixels(current));
    element.style.setProperty(property, `${String(round(value))}px`);
    return value;
  }

  private computeCorrections(
    root: RootRuntime,
    measurements: RhythmMeasurement[],
    startIndex: number,
    tableRowDeltas: Map<HTMLElement, number>,
  ): Map<HTMLElement, RhythmCorrection> {
    const corrections = new Map<HTMLElement, RhythmCorrection>();
    let previousExit = this.prefixBoundary(root, measurements[0]?.element ?? null);
    if (startIndex > 0) {
      const previous = root.flowItems[startIndex - 1];
      const previousMeasurement = previous ? root.measurements.get(previous) : undefined;
      const previousCorrection = previous ? root.corrections.get(previous) : undefined;
      if (previousMeasurement) previousExit = this.naturalBottom(root, previousMeasurement) + (previousCorrection?.before ?? 0) + (previousCorrection?.after ?? 0);
    }
    for (const measurement of measurements) {
      const kind = measurement.kind;
      if (measurement.intentional) {
        corrections.set(measurement.element, { before: 0, after: 0, reason: 'baseline' });
        previousExit = Math.max(previousExit, measurement.bottom);
        continue;
      }
      if (this.isFloatImage(root, measurement)) {
        corrections.set(measurement.element, { before: 0, after: 0, reason: 'baseline' });
        continue;
      }
      const canCorrectBefore = root.view === 'reading' &&
        (isTextKind(kind) || measurement.firstBaseline !== undefined ||
          (isAtomicKind(kind) && (kind !== 'image' || root.style.baseline.snapImages)));
      const naturalBaseline = measurement.firstBaseline === undefined
        ? undefined
        : measurement.firstBaseline - measurement.existingBeforeCorrection;
      const naturalTop = measurement.top - measurement.existingBeforeCorrection;
      let before = 0;
      if (canCorrectBefore) {
        const desired = naturalBaseline ?? naturalTop;
        before = nearestLegalGridDelta(desired, previousExit, root.lattice);
      }
      const naturalBottom = this.naturalBottom(root, measurement);
      const movedBottom = naturalBottom + before + (tableRowDeltas.get(measurement.element) ?? 0);
      const isLiveEditorLine = root.view === 'live-preview' && measurement.element.hasClass('cm-line');
      const after = isLiveEditorLine
        ? 0
        : root.view === 'live-preview'
          ? this.liveExitTail(root, measurement, movedBottom, measurements)
          : exitTailToGrid(movedBottom, root.lattice);
      const reason = before !== 0
        ? measurement.flowIndex === 0 ? 'prefix-exit' : measurement.pageIndex > 0 ? 'page-entry' : 'baseline'
        : kind === 'editor-widget' ? 'widget-exit' : 'block-exit';
      corrections.set(measurement.element, { before: round(before), after: round(after), reason });
      previousExit = movedBottom + after;
    }
    return corrections;
  }

  private naturalBottom(root: RootRuntime, measurement: RhythmMeasurement): number {
    // The trailing correction is written as an actual flow margin. Margins
    // are not part of getBoundingClientRect(), so only the leading margin
    // moves the measured border box. The natural trailing margin remains part
    // of the occupied boundary used to place the next flow item.
    return measurement.bottom - measurement.existingBeforeCorrection + measurement.marginAfter;
  }

  /**
   * A Live Preview gap/widget is followed by a CodeMirror line whose first
   * baseline is offset from its border-box top. Its tail therefore has to end
   * on the lattice translated by that next-line offset, rather than on a raw
   * paper line. This is what keeps a virtualized gap from re-entering with a
   * body baseline half a row away.
   */
  private liveExitTail(
    root: RootRuntime,
    measurement: RhythmMeasurement,
    movedBottom: number,
    currentMeasurements: RhythmMeasurement[],
  ): number {
    const byElement = new Map(currentMeasurements.map((candidate) => [candidate.element, candidate]));
    for (let index = measurement.flowIndex + 1; index < root.flowItems.length; index += 1) {
      const next = byElement.get(root.flowItems[index]!) ?? root.measurements.get(root.flowItems[index]!);
      if (next?.firstBaseline === undefined) continue;
      const baselineOffset = next.firstBaseline - next.top;
      return nextGridDelta(movedBottom, {
        ...root.lattice,
        origin: root.lattice.origin - baselineOffset,
      });
    }
    return exitTailToGrid(movedBottom, root.lattice);
  }

  private prefixBoundary(root: RootRuntime, first: HTMLElement | null): number {
    const pageRect = root.pageContent.getBoundingClientRect();
    const scale = root.geometryScale > 0 ? root.geometryScale : 1;
    let boundary = root.style.layout.paddingTop;
    if (!first) return boundary;
    const firstRect = first.getBoundingClientRect();
    const constructor = first.ownerDocument.defaultView?.HTMLElement;
    const candidates = root.pageContent.querySelectorAll<HTMLElement>(
      ':scope > .metadata-container, :scope > .mod-frontmatter, :scope > .mod-header, :scope > .mod-ui',
    );
    for (const candidate of candidates) {
      if (!constructor || !candidate.instanceOf(constructor) || candidate === first || candidate.contains(first)) continue;
      const rect = candidate.getBoundingClientRect();
      if (rect.bottom > firstRect.top + root.lattice.tolerance * scale) continue;
      boundary = Math.max(boundary, (rect.bottom - pageRect.top) / scale + parsePixels(root.pageContent.ownerDocument.defaultView?.getComputedStyle(candidate).marginBottom));
    }
    return boundary;
  }

  private isFloatImage(root: RootRuntime, measurement: RhythmMeasurement): boolean {
    if (measurement.kind !== 'image') return false;
    const target = flowTarget(measurement.element, root.view);
    const candidates = target.matches('img')
      ? [target]
      : [...target.querySelectorAll<HTMLElement>('img')];
    return candidates.some((candidate) =>
      (candidate.ownerDocument.defaultView?.getComputedStyle(candidate).float ?? 'none') !== 'none');
  }

  private writeCorrections(
    root: RootRuntime,
    measurements: RhythmMeasurement[],
    corrections: Map<HTMLElement, RhythmCorrection>,
  ): void {
    const state = [...this.states.values()].find((candidate) => candidate.roots.includes(root));
    let corrected = 0;
    for (const measurement of measurements) {
      const correction = corrections.get(measurement.element);
      if (!correction) continue;
      const element = measurement.element;
      if (root.view === 'live-preview' && element.hasClass('cm-line')) {
        // CodeMirror owns ordinary line DOM. Static compiler rules establish
        // its unit-height, margin-free footprint; headings and code lines are
        // included here because they are still CodeMirror-owned line boxes.
        // Dynamic ownership belongs only to widgets and virtual gaps.
        element.classList.remove(BASELINE_GRID_ITEM_CLASS, BASELINE_GRID_ATOMIC_CLASS, BASELINE_GRID_INTENTIONAL_CLASS);
        element.removeAttribute(OWNER_PROPERTY);
        delete element.dataset.templarBaselineKind;
        element.style.removeProperty(BASELINE_BEFORE_PROPERTY);
        element.style.removeProperty(BASELINE_AFTER_PROPERTY);
        element.style.removeProperty('margin-block-end');
        continue;
      }
      element.addClass(BASELINE_GRID_ITEM_CLASS);
      // DOMStringMap keys use camelCase; the HTML attribute is explicit here
      // so this remains valid in Chromium as well as the test DOM realm.
      element.setAttribute(OWNER_PROPERTY, 'true');
      element.dataset.templarBaselineKind = measurement.kind;
      if (isAtomicKind(measurement.kind)) element.addClass(BASELINE_GRID_ATOMIC_CLASS);
      else element.removeClass(BASELINE_GRID_ATOMIC_CLASS);
      if (measurement.intentional) element.addClass(BASELINE_GRID_INTENTIONAL_CLASS);
      else element.removeClass(BASELINE_GRID_INTENTIONAL_CLASS);
      const before = `${String(round(correction.before))}px`;
      const after = `${String(round(Math.max(0, correction.after)))}px`;
      if (element.style.getPropertyValue(BASELINE_BEFORE_PROPERTY) !== before) element.style.setProperty(BASELINE_BEFORE_PROPERTY, before);
      if (element.style.getPropertyValue(BASELINE_AFTER_PROPERTY) !== after) element.style.setProperty(BASELINE_AFTER_PROPERTY, after);
      // Obsidian's el-* wrappers can have an auto-sized flex item box. An
      // empty ::after pseudo-element reports the desired block-size but is not
      // included in that wrapper's flow geometry. Write the occupied tail as
      // an explicit margin so layout and getBoundingClientRect agree.
      const flowTail = `${String(round(measurement.marginAfter + Math.max(0, correction.after)))}px`;
      if (element.style.getPropertyValue('margin-block-end') !== flowTail) {
        element.style.setProperty('margin-block-end', flowTail, 'important');
      }
      if (Math.abs(correction.before) > 0.001 || Math.abs(correction.after) > 0.001) corrected += 1;
    }
    if (state) {
      state.stats.writePasses += 1;
      state.stats.nodesCorrected += corrected;
    }
  }

  /**
   * A rendered list item can be a fractional CSS pixel taller than its
   * declared line-height when inline formatting (links, emphasis, images,
   * or a fallback font) participates in the line box. That fractional excess
   * otherwise moves every following item between ruled lines. Shift each
   * item's visual line box to the fixed lattice while leaving list flow and
   * wrapping untouched; the list owner's outer tail still controls the next
   * page-flow block.
   */
  private writeListLineCorrections(root: RootRuntime, measurements: RhythmMeasurement[]): void {
    if (root.view !== 'reading') return;
    const pageRect = root.pageContent.getBoundingClientRect();
    const scale = root.geometryScale > 0 ? root.geometryScale : 1;
    const view = root.pageContent.ownerDocument.defaultView;
    const lists = new Set<HTMLElement>();
    for (const measurement of measurements) {
      if (measurement.kind === 'list') {
        const list = flowTarget(measurement.element, root.view);
        if (list.matches('ul, ol')) lists.add(list);
      } else if (isAtomicKind(measurement.kind)) {
        const owner = flowTarget(measurement.element, root.view);
        owner.querySelectorAll<HTMLElement>('ul, ol').forEach((list) => lists.add(list));
      }
    }
    for (const list of lists) {
      for (const item of list.querySelectorAll<HTMLElement>('li')) {
        const rect = item.getBoundingClientRect();
        if (rect.width <= 0 && rect.height <= 0) {
          item.removeClass(BASELINE_GRID_LIST_ITEM_CLASS);
          item.style.removeProperty(LIST_SHIFT_PROPERTY);
          continue;
        }
        const existing = parsePixels(item.style.getPropertyValue(LIST_SHIFT_PROPERTY));
        const target = item.querySelector<HTMLElement>(':scope > p, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6, :scope > pre, :scope > code') ?? item;
        const targetRect = target.getBoundingClientRect();
        const targetStyle = view?.getComputedStyle(target);
        const naturalBaseline = (targetRect.top - pageRect.top) / scale - existing +
          parsePixels(targetStyle?.paddingTop) +
          parsePixels(targetStyle?.borderTopWidth) +
          metricForElement(target, root.metrics).baseline;
        const shift = nearestGridDelta(naturalBaseline, root.lattice);
        item.addClass(BASELINE_GRID_LIST_ITEM_CLASS);
        item.style.setProperty(LIST_SHIFT_PROPERTY, `${String(round(shift))}px`);
      }
    }
  }

  /**
   * Composite containers own their outer flow edge, but their descendants
   * still contain user-visible text lines. Inline formatting inside a
   * blockquote/callout can make an individual paragraph's border box land a
   * fractional pixel away from the fixed lattice even when the container's
   * first line is correct. Shift only that inner visual line box; it is
   * position-relative, so the container's measured height and following flow
   * remain unchanged.
   */
  private writeCompositeTextCorrections(
    root: RootRuntime,
    measurements: RhythmMeasurement[],
    clearStale: boolean,
  ): void {
    if (root.view !== 'reading') return;
    const pageRect = root.pageContent.getBoundingClientRect();
    const scale = root.geometryScale > 0 ? root.geometryScale : 1;
    const view = root.pageContent.ownerDocument.defaultView;
    const activeTargets = new Set<HTMLElement>();
    for (const measurement of measurements) {
      if (measurement.kind !== 'composite') continue;
      const semantic = flowTarget(measurement.element, root.view);
      const targets = compositeTextTargets(semantic);
      for (const target of targets) {
        activeTargets.add(target);
        const rect = target.getBoundingClientRect();
        if (rect.width <= 0 && rect.height <= 0) {
          this.clearCompositeTextCorrection(target);
          continue;
        }
        const existing = compositeTextShift(target);
        const computed = view?.getComputedStyle(target);
        // The target rect already includes the composite owner's current
        // leading correction. Remove only the target's previous visual shift;
        // subtracting the outer correction as well applies the same phase
        // correction twice on every subsequent pass.
        const naturalBaseline = (rect.top - pageRect.top) / scale - existing +
          parsePixels(computed?.paddingTop) +
          parsePixels(computed?.borderTopWidth) +
          metricForElement(target, root.metrics).baseline;
        const delta = nearestGridDelta(naturalBaseline, root.lattice);
        const shift = Math.abs(delta) <= root.lattice.tolerance ? 0 : round(delta);
        target.addClass(COMPOSITE_TEXT_CLASS);
        target.style.setProperty(COMPOSITE_TEXT_SHIFT_PROPERTY, `${String(shift)}px`);
      }
    }
    // A block can change from composite to atomic/text after an async
    // renderer completes. Remove only this controller's stale inner markers.
    if (clearStale) {
      root.pageContent.querySelectorAll<HTMLElement>(`.${COMPOSITE_TEXT_CLASS}`).forEach((target) => {
        if (!activeTargets.has(target)) this.clearCompositeTextCorrection(target);
      });
    }
  }

  private clearCompositeTextCorrection(element: HTMLElement): void {
    element.classList.remove(COMPOSITE_TEXT_CLASS);
    element.style.removeProperty(COMPOSITE_TEXT_SHIFT_PROPERTY);
  }

  /**
   * Tables need row-local rhythm as well as an outer exit correction.  The
   * row tail is added as cell padding, so text is never stretched or cropped.
   * Return only the change since the currently rendered table height; this
   * keeps repeated passes absolute and prevents a tail from accumulating.
   */
  private prepareTableRows(root: RootRuntime, measurements: RhythmMeasurement[]): Map<HTMLElement, number> {
    const deltas = new Map<HTMLElement, number>();
    const scale = root.geometryScale > 0 ? root.geometryScale : 1;
    for (const measurement of measurements) {
      const table = flowTarget(measurement.element, root.view);
      if (!table.matches('table')) continue;
      let existingTotal = 0;
      let nextTotal = 0;
      for (const row of table.querySelectorAll<HTMLTableRowElement>('tr')) {
        const rect = row.getBoundingClientRect();
        if (rect.height <= 0) continue;
        const existing = parsePixels(row.style.getPropertyValue('--templar-grid-row-after'));
        const naturalHeight = Math.max(0, rect.height / scale - existing);
        const next = exitTailToGrid(naturalHeight, { unit: root.lattice.unit, origin: 0, tolerance: root.lattice.tolerance });
        existingTotal += existing;
        nextTotal += next;
        row.classList.add('templar-baseline-table-row');
        row.style.setProperty('--templar-grid-row-after', `${String(round(next))}px`);
        for (const cell of row.querySelectorAll<HTMLElement>(':scope > th, :scope > td')) {
          if (!cell.style.getPropertyValue('--templar-grid-natural-cell-padding-bottom')) {
            const padding = root.pageContent.ownerDocument.defaultView?.getComputedStyle(cell).paddingBlockEnd ?? '0px';
            cell.style.setProperty('--templar-grid-natural-cell-padding-bottom', padding);
          }
        }
      }
      deltas.set(measurement.element, nextTotal - existingTotal);
    }
    return deltas;
  }

  private debugSnapshot(root: RootRuntime): BaselineGridDebugSnapshot {
    const pageRect = root.pageContent.getBoundingClientRect();
    const scale = root.geometryScale > 0 ? root.geometryScale : 1;
    const points: BaselineGridDebugSnapshot['points'] = [];
    for (const [index, element] of root.flowItems.entries()) {
      const kind = classifyFlowElement(element, root.view);
      if (!kind) continue;
      const measurement = root.measurements.get(element) ?? this.measureRoot(root, index, index + 1)[0];
      if (!measurement) continue;
      const correction = root.corrections.get(element);
      const x = Math.max(8, root.pageContent.offsetWidth - 12);
      if (measurement.firstBaseline !== undefined) {
        const error = distanceToGrid(measurement.firstBaseline, root.lattice);
        points.push({ x, y: measurement.firstBaseline, kind: error > root.lattice.tolerance ? 'failure' : 'baseline', id: elementId(element, index), error });
      }
      const top = measurement.top + (correction?.before ?? 0);
      const bottom = measurement.bottom + (correction?.before ?? 0) + (correction?.after ?? 0);
      points.push({ x: x - 5, y: top, kind: 'entry', id: `${elementId(element, index)}-entry` });
      points.push({ x: x - 5, y: bottom, kind: 'exit', id: `${elementId(element, index)}-exit` });
    }
    // Keep the page rect read in this method so the overlay remains rooted in
    // the same coordinate system even when the page is CSS-zoomed.
    void pageRect;
    void scale;
    return { root: root.pageContent, unit: root.lattice.unit, origin: root.lattice.origin, points };
  }

  private clearElement(element: HTMLElement): void {
    element.removeClass(BASELINE_GRID_ITEM_CLASS, BASELINE_GRID_ATOMIC_CLASS, BASELINE_GRID_INTENTIONAL_CLASS);
    delete element.dataset.templarBaselineKind;
    delete element.dataset.templarBaselineId;
    element.removeAttribute(OWNER_PROPERTY);
    element.style.removeProperty(BASELINE_BEFORE_PROPERTY);
    element.style.removeProperty(BASELINE_AFTER_PROPERTY);
    element.style.removeProperty(NATURAL_MARGIN_BEFORE_PROPERTY);
    element.style.removeProperty(NATURAL_MARGIN_AFTER_PROPERTY);
    element.style.removeProperty('margin-block-end');
    element.removeClass(BASELINE_GRID_LIST_ITEM_CLASS);
    element.style.removeProperty(LIST_SHIFT_PROPERTY);
    this.clearCompositeTextCorrection(element);
  }

  /**
   * Metadata/properties rendered before CodeMirror are not editor lines, but
   * their variable height can leave the first editable line between ruled
   * rows. A small margin on that prefix is safe for CodeMirror's height map;
   * writing a margin or class on a `.cm-line` is not.
   */
  private writeLivePrefixCorrection(root: RootRuntime, measurements: RhythmMeasurement[]): boolean {
    if (root.view !== 'live-preview' || !root.prefixElement) return false;
    const firstText = measurements.find((measurement) => measurement.firstBaseline !== undefined);
    if (!firstText || measurements.some((measurement) => measurement.flowIndex < firstText.flowIndex &&
      measurement.kind !== 'editor-line' && measurement.kind !== 'blank-space')) {
      this.clearLivePrefixCorrection(root);
      return false;
    }

    const prefix = root.prefixElement;
    const existingShift = parsePixels(prefix.style.getPropertyValue(PREFIX_SHIFT_PROPERTY));
    const naturalBaseline = firstText.firstBaseline! - existingShift;
    const nextShift = round(nearestGridDelta(naturalBaseline, root.lattice));
    const changed = Math.abs(existingShift - nextShift) > CORRECTION_STABILITY_EPSILON;
    const view = root.pageContent.ownerDocument.defaultView;
    if (!prefix.style.getPropertyValue(PREFIX_NATURAL_MARGIN_PROPERTY)) {
      const computed = view?.getComputedStyle(prefix);
      const natural = nonNegative(parsePixels(computed?.marginBlockEnd ?? computed?.marginBottom));
      prefix.style.setProperty(PREFIX_NATURAL_MARGIN_PROPERTY, `${String(round(natural))}px`);
    }
    prefix.classList.add(PREFIX_CLASS);
    prefix.style.setProperty(PREFIX_SHIFT_PROPERTY, `${String(nextShift)}px`);
    return changed;
  }

  private clearLivePrefixCorrection(root: RootRuntime): void {
    const prefix = root.prefixElement;
    if (!prefix) return;
    prefix.classList.remove(PREFIX_CLASS);
    prefix.style.removeProperty(PREFIX_SHIFT_PROPERTY);
    prefix.style.removeProperty(PREFIX_NATURAL_MARGIN_PROPERTY);
  }

  private prefixElementFor(pageContent: HTMLElement, parent: HTMLElement, view: BaselineView): HTMLElement | null {
    if (view !== 'live-preview') return null;
    const container = parent.parentElement?.parentElement === pageContent
      ? parent.parentElement
      : parent.parentElement === pageContent ? parent : null;
    if (!container || container.parentElement !== pageContent) return null;
    const children = Array.from(pageContent.children);
    const containerIndex = children.indexOf(container);
    if (containerIndex < 0) return null;
    const prefixSelectors = '.metadata-container, .mod-frontmatter, .mod-header, .mod-ui, .markdown-preview-pusher, .inline-title';
    const candidates = children
      .slice(0, containerIndex)
      .filter(isHTMLElement)
      .filter((element) => element.matches(prefixSelectors));
    return candidates.reverse().find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 || rect.height > 0;
    }) ?? null;
  }

  private markNonConverged(state: ObservationState, element: HTMLElement): void {
    const root = state.roots.find((candidate) => candidate.flowItems.includes(element));
    const index = root?.flowItems.indexOf(element) ?? 0;
    const id = elementId(element, Math.max(0, index));
    if (!state.stats.nonConvergedElements.includes(id)) state.stats.nonConvergedElements.push(id);
  }

  private mutationAffectsFlow(record: MutationRecord): boolean {
    if (record.type === 'characterData') return true;
    if (record.target.nodeType === 1) {
      const target = record.target as Element;
      if (target.matches('.templar-baseline-debug-overlay, .templar-baseline-debug-overlay *') ||
        target.closest('.templar-baseline-debug-overlay')) return false;
    }
    const nodes = [...record.addedNodes, ...record.removedNodes];
    if (nodes.length === 0) return true;
    return nodes.some((node) => {
      if (node.nodeType !== 1) return true;
      const element = node as Element;
      return !element.matches('.templar-baseline-debug-overlay, .templar-baseline-debug-overlay *');
    });
  }

  private cleanupOwnedDom(contentEl: HTMLElement): void {
    contentEl.querySelectorAll<HTMLElement>(`.${BASELINE_GRID_ITEM_CLASS}, [${OWNER_PROPERTY}]`).forEach((element) => this.clearElement(element));
    contentEl.querySelectorAll<HTMLElement>('.templar-baseline-table-row').forEach((row) => {
      row.classList.remove('templar-baseline-table-row');
      row.style.removeProperty('--templar-grid-row-after');
      row.querySelectorAll<HTMLElement>(':scope > th, :scope > td').forEach((cell) => {
        cell.style.removeProperty('--templar-grid-natural-cell-padding-bottom');
      });
    });
    // Remove beta2-owned artifacts when upgrading a note without leaving
    // their old phase correction in the live DOM.
    contentEl.querySelectorAll<HTMLElement>('.templar-grid-snap-block').forEach((element) => {
      element.classList.remove('templar-grid-snap-block');
      element.style.removeProperty('--templar-grid-snap');
      element.style.removeProperty('--templar-grid-natural-margin-end');
      element.style.removeProperty('--templar-editor-line-tail');
    });
    contentEl.querySelectorAll<HTMLElement>('img').forEach((image) => image.style.removeProperty('--templar-image-snap'));
    contentEl.querySelectorAll<HTMLElement>('[style]').forEach((element) => {
      element.classList.remove(BASELINE_GRID_LIST_ITEM_CLASS);
      element.style.removeProperty(LIST_SHIFT_PROPERTY);
    });
    contentEl.querySelectorAll<HTMLElement>(`.${PREFIX_CLASS}`).forEach((element) => {
      element.classList.remove(PREFIX_CLASS);
      element.style.removeProperty(PREFIX_SHIFT_PROPERTY);
      element.style.removeProperty(PREFIX_NATURAL_MARGIN_PROPERTY);
    });
    contentEl.querySelectorAll<HTMLElement>(`.${COMPOSITE_TEXT_CLASS}`).forEach((element) => {
      this.clearCompositeTextCorrection(element);
    });
    this.overlay.clear(contentEl);
  }
}

export function createGridLattice(style: TemplarNoteStyle, metrics: PageMetricSet): GridLattice {
  return {
    unit: style.baseline.unit,
    origin: style.layout.paddingTop + metrics.body.baseline,
    tolerance: DEFAULT_TOLERANCE,
  };
}

export function baselineGridKind(element: HTMLElement, view: BaselineView): RhythmKind | null {
  return classifyFlowElement(element, view);
}
