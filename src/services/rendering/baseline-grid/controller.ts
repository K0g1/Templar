import type { WorkspaceLeaf } from 'obsidian';
import type { FontMetrics, TemplarNoteStyle } from '../../../types';
import { TEMPLAR_CONTENT_CLASS } from '../../../constants';
import { measuredGeometryScale } from '../../../utils/grid';
import { round } from '../../../utils/value';
import type { PageMetricSet } from '../../style-compiler';
import { realmFor, type DomRealm } from '../../dom-realm';
import {
  BASELINE_GRID_ATOMIC_CLASS,
  BASELINE_GRID_INTENTIONAL_CLASS,
  BASELINE_GRID_ITEM_CLASS,
  collectFlowItems,
  isAtomicKind,
  isTextKind,
  classifyFlowElement,
} from './classifier';
import {
  distanceToGrid,
  exitTailToGrid,
  nearestLegalGridDelta,
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
const OWNER_PROPERTY = 'data-templar-baseline-owner';
const DEFAULT_TOLERANCE = 0.4;
const MAX_SETTLE_PASSES = 8;

interface RootRuntime extends BaselineGridRootState {
  geometryScale: number;
  parent: HTMLElement;
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

function firstBaselineTarget(element: HTMLElement, kind: RhythmKind): HTMLElement | null {
  if (kind === 'heading' || kind === 'text' || kind === 'code' || kind === 'editor-line') {
    return element;
  }
  if (kind === 'list') {
    return element.querySelector<HTMLElement>(':scope > li, :scope li');
  }
  if (kind === 'composite') {
    if (element.matches('table')) return element.querySelector<HTMLElement>('th, td');
    if (element.matches('.callout')) {
      return element.querySelector<HTMLElement>('.callout-title, .callout-content p, .callout-content li, .callout-content code');
    }
  }
  if (kind === 'editor-widget') {
    return element.querySelector<HTMLElement>('.cm-line, p, td, th, .callout-title');
  }
  return null;
}

function baselineFor(
  element: HTMLElement,
  kind: RhythmKind,
  contentRect: DOMRect,
  scale: number,
  metrics: PageMetricSet,
  view: Window,
): number | undefined {
  const target = firstBaselineTarget(element, kind);
  if (!target) return undefined;
  const rect = target.getBoundingClientRect();
  if (rect.height <= 0 && rect.width <= 0) return undefined;
  const computed = view.getComputedStyle(target);
  const metric = metricForElement(target, metrics);
  return (rect.top - contentRect.top) / scale +
    parsePixels(computed.paddingTop) +
    parsePixels(computed.borderTopWidth) +
    metric.baseline;
}

function pageIndexFor(position: number, style: TemplarNoteStyle, unit: number): number {
  if (style.page.mode !== 'paged') return 0;
  const gap = style.baseline.enabled && style.baseline.mode !== 'free'
    ? style.page.gap + ((-(style.page.height + style.page.gap)) % unit + unit) % unit
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
          const root = state.roots.find((candidate) => candidate.pageContent === entry.target);
          if (root) state.needsFullScan = true;
          else state.dirty.add(entry.target);
        }
        this.schedule(leaf);
      }),
      observedTargets: new Set(),
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
    state.stats.fullScans += 1;
    const nextRoots = this.collectRoots(state);
    const previousItems = new Set(state.roots.flatMap((root) => root.flowItems));
    const nextItems = new Set(nextRoots.flatMap((root) => root.flowItems));
    for (const element of previousItems) {
      if (!nextItems.has(element)) this.clearElement(element);
    }
    state.roots = nextRoots;
    this.observeTargets(state);
    for (const root of state.roots) this.processRoot(root, 0);
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
        ? pageContent.querySelector<HTMLElement>(':scope > .markdown-preview-section')
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
      }];
    });
  }

  private observeTargets(state: ObservationState): void {
    const targets = new Set<HTMLElement>();
    for (const root of state.roots) {
      targets.add(root.pageContent);
      for (const item of root.flowItems) targets.add(item);
    }
    for (const target of state.observedTargets) {
      if (!targets.has(target)) state.resizeObserver.unobserve(target);
    }
    for (const target of targets) {
      if (!state.observedTargets.has(target)) state.resizeObserver.observe(target);
    }
    state.observedTargets = targets;
  }

  private processRoot(root: RootRuntime, startIndex: number, endIndex = root.flowItems.length): boolean {
    const measurements = this.measureRoot(root, startIndex, endIndex);
    if (measurements.length === 0) return false;
    const tableRowDeltas = this.prepareTableRows(root, measurements);
    const corrections = this.computeCorrections(root, measurements, startIndex, tableRowDeltas);
    const changed = measurements.some((measurement) => {
      const previous = root.corrections.get(measurement.element);
      const next = corrections.get(measurement.element);
      return previous?.before !== next?.before || previous?.after !== next?.after || previous?.reason !== next?.reason;
    });
    this.writeCorrections(root, measurements, corrections);
    for (const measurement of measurements) root.measurements.set(measurement.element, measurement);
    for (const [element, correction] of corrections) root.corrections.set(element, correction);
    return changed;
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
      const firstBaseline = baselineFor(element, kind, pageRect, scale, root.metrics, root.pageContent.ownerDocument.defaultView ?? window);
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
      if (this.isFloatImage(measurement)) {
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
      const after = kind === 'editor-line' ? 0 : exitTailToGrid(movedBottom, root.lattice);
      const reason = before !== 0
        ? measurement.flowIndex === 0 ? 'prefix-exit' : measurement.pageIndex > 0 ? 'page-entry' : 'baseline'
        : kind === 'editor-widget' ? 'widget-exit' : 'block-exit';
      corrections.set(measurement.element, { before: round(before), after: round(after), reason });
      previousExit = movedBottom + after;
    }
    return corrections;
  }

  private naturalBottom(root: RootRuntime, measurement: RhythmMeasurement): number {
    const atomic = isAtomicKind(measurement.kind);
    return measurement.bottom - (atomic ? 0 : measurement.existingAfterCorrection) + measurement.marginAfter;
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

  private isFloatImage(measurement: RhythmMeasurement): boolean {
    return measurement.kind === 'image' &&
      (measurement.element.ownerDocument.defaultView?.getComputedStyle(measurement.element).float ?? 'none') !== 'none';
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
      element.addClass(BASELINE_GRID_ITEM_CLASS);
      element.dataset[OWNER_PROPERTY.replace(/^data-/, '')] = 'true';
      element.dataset.templarBaselineKind = measurement.kind;
      if (isAtomicKind(measurement.kind)) element.addClass(BASELINE_GRID_ATOMIC_CLASS);
      else element.removeClass(BASELINE_GRID_ATOMIC_CLASS);
      if (measurement.intentional) element.addClass(BASELINE_GRID_INTENTIONAL_CLASS);
      else element.removeClass(BASELINE_GRID_INTENTIONAL_CLASS);
      if (measurement.kind === 'editor-line') {
        element.style.removeProperty(BASELINE_BEFORE_PROPERTY);
        element.style.removeProperty(BASELINE_AFTER_PROPERTY);
        continue;
      }
      const before = `${String(round(correction.before))}px`;
      const after = `${String(round(Math.max(0, correction.after)))}px`;
      if (element.style.getPropertyValue(BASELINE_BEFORE_PROPERTY) !== before) element.style.setProperty(BASELINE_BEFORE_PROPERTY, before);
      if (element.style.getPropertyValue(BASELINE_AFTER_PROPERTY) !== after) element.style.setProperty(BASELINE_AFTER_PROPERTY, after);
      if (Math.abs(correction.before) > 0.001 || Math.abs(correction.after) > 0.001) corrected += 1;
    }
    if (state) {
      state.stats.writePasses += 1;
      state.stats.nodesCorrected += corrected;
    }
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
      if (!measurement.element.matches('table')) continue;
      let existingTotal = 0;
      let nextTotal = 0;
      for (const row of measurement.element.querySelectorAll<HTMLTableRowElement>('tr')) {
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
    delete element.dataset.templarBaselineOwner;
    element.style.removeProperty(BASELINE_BEFORE_PROPERTY);
    element.style.removeProperty(BASELINE_AFTER_PROPERTY);
    element.style.removeProperty(NATURAL_MARGIN_BEFORE_PROPERTY);
    element.style.removeProperty(NATURAL_MARGIN_AFTER_PROPERTY);
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
