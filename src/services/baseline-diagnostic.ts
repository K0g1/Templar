import { TEMPLAR_CONTENT_CLASS, TEMPLAR_PAGE_CLASS } from '../constants';
import type { FontMetrics } from '../types';
import { measuredGeometryScale } from '../utils/grid';
import type { PageMetricSet } from './style-compiler';
import { collectFlowItems, isAtomicKind } from './rendering/baseline-grid/classifier';
import { distanceToGrid, type GridLattice } from './rendering/baseline-grid/math';
import type { BaselineGridRootState, BaselineGridStats, BaselineView, RhythmKind } from './rendering/baseline-grid/types';

export type BaselineFailureKind =
  | 'text-baseline'
  | 'block-entry'
  | 'block-exit'
  | 'row-height'
  | 'blank-row'
  | 'page-phase'
  | 'editor-line'
  | 'ownership'
  | 'non-convergence';

export interface BaselineDiagnosticFailure {
  id: string;
  view: BaselineView;
  kind: BaselineFailureKind;
  tag: string;
  classes: string;
  textPreview: string;
  expectedPosition: number;
  measuredPosition: number;
  error: number;
  pageIndex: number;
  gridIndex: number;
  /** Compatibility aliases retained for integrations that used beta2 output. */
  className: string;
  text: string;
  value: number;
  expected: number;
}

export interface BaselineDiagnosticReport {
  gridUnit: number;
  gridOrigin: number;
  tolerance: number;
  viewType: BaselineView | 'mixed' | 'unknown';
  pageMode: string;
  pageSize: string;
  pageScale: number;
  fontFamily: string;
  fontMetrics: PageMetricSet;
  pagesChecked: number;
  textChecked: number;
  blocksChecked: number;
  widgetsChecked: number;
  maxBaselineError: number;
  meanBaselineError: number;
  maxBlockExitError: number;
  correctionsApplied: number;
  measurementPasses: number;
  writePasses: number;
  fullScans: number;
  dirtyScans: number;
  resizeObserverCallbacks: number;
  mutationObserverCallbacks: number;
  rafCallbacks: number;
  failureCount: number;
  failures: BaselineDiagnosticFailure[];
  /** Beta2 alias. */
  unit: number;
}

export interface BaselineDiagnosticOptions {
  tolerance?: number;
  roots?: readonly BaselineGridRootState[];
  stats?: BaselineGridStats | null;
}

const TEXT_SELECTOR = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'pre > code',
  'th', 'td', '.callout-title', '.callout-content > p', '.callout-content li',
  '.cm-content > .cm-line',
].join(',');

function parsePixels(value: string | null | undefined): number {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
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
  if (element.tagName === 'CODE' || element.tagName === 'PRE' || element.hasClass('HyperMD-codeblock') || element.closest('pre')) return metrics.code;
  return metrics.body;
}

function visible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return (rect.width > 0 || rect.height > 0) && Boolean(element.textContent?.trim());
}

function textPreview(element: HTMLElement): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 96);
}

function viewFor(pageContent: HTMLElement): BaselineView {
  return pageContent.hasClass('cm-sizer') || pageContent.querySelector('.cm-content')
    ? 'live-preview'
    : 'reading';
}

function latticeFor(pageContent: HTMLElement, unit: number, metrics: PageMetricSet): GridLattice {
  const style = pageContent.ownerDocument.defaultView?.getComputedStyle(pageContent);
  const origin = parsePixels(
    style?.getPropertyValue('--templar-grid-origin') ||
    style?.getPropertyValue('--templar-paper-baseline-position'),
  ) || parsePixels(style?.paddingTop) + metrics.body.baseline;
  return { unit, origin, tolerance: 0.4 };
}

function geometryScale(pageContent: HTMLElement): number {
  const rect = pageContent.getBoundingClientRect();
  const horizontal = measuredGeometryScale(rect.width, pageContent.offsetWidth, 1);
  return measuredGeometryScale(rect.height, pageContent.offsetHeight, horizontal);
}

function pageIndex(position: number, pageSpan: number): number {
  return pageSpan > 0 ? Math.max(0, Math.floor(Math.max(0, position) / pageSpan)) : 0;
}

function baselineTarget(element: HTMLElement, kind: RhythmKind): HTMLElement | null {
  if (kind === 'list') return element.querySelector<HTMLElement>(':scope > li, :scope li');
  if (kind === 'composite') {
    if (element.matches('table')) return element.querySelector<HTMLElement>('th, td');
    return element.querySelector<HTMLElement>('.callout-title, .callout-content p, .callout-content li');
  }
  if (kind === 'editor-widget') return element.querySelector<HTMLElement>('.cm-line, p, td, th, .callout-title');
  if (kind === 'atomic' || kind === 'image') return null;
  return element;
}

function failureFor(
  element: HTMLElement,
  view: BaselineView,
  kind: BaselineFailureKind,
  measuredPosition: number,
  expectedPosition: number,
  pageIndexValue: number,
  gridIndex: number,
  error: number,
  id: string,
): BaselineDiagnosticFailure {
  const className = typeof element.className === 'string' ? element.className : String(element.className ?? '');
  const preview = textPreview(element);
  return {
    id,
    view,
    kind,
    tag: element.tagName.toLowerCase(),
    classes: className,
    textPreview: preview,
    expectedPosition,
    measuredPosition,
    error,
    pageIndex: pageIndexValue,
    gridIndex,
    className,
    text: preview,
    value: error,
    expected: expectedPosition,
  };
}

function expectedGridPosition(position: number, lattice: GridLattice): { expected: number; error: number; row: number } {
  const row = lattice.unit > 0 ? Math.round((position - lattice.origin) / lattice.unit) : 0;
  const expected = lattice.origin + row * lattice.unit;
  return { expected, error: Math.abs(position - expected), row };
}

/** Checks all currently rendered roots against the fixed absolute lattice. */
export function diagnoseBaselineAlignment(
  contentEl: HTMLElement,
  metrics: PageMetricSet,
  toleranceOrOptions: number | BaselineDiagnosticOptions = 0.4,
  options: BaselineDiagnosticOptions = {},
): BaselineDiagnosticReport {
  const resolvedOptions: BaselineDiagnosticOptions = typeof toleranceOrOptions === 'number'
    ? { ...options, tolerance: toleranceOrOptions }
    : toleranceOrOptions;
  const tolerance = resolvedOptions.tolerance ?? 0.4;
  const pageRoots = [...contentEl.querySelectorAll<HTMLElement>(`.${TEMPLAR_PAGE_CLASS}`)]
    .filter((element) => element.getBoundingClientRect().width > 0 || element.offsetWidth > 0);
  const rootStates = resolvedOptions.roots ?? [];
  const rootByPageContent = new Map(rootStates.map((root) => [root.pageContent, root]));
  const firstPageRoot = pageRoots[0];
  const unit = parsePixels(
    firstPageRoot?.querySelector<HTMLElement>(`.${TEMPLAR_CONTENT_CLASS}`)?.ownerDocument.defaultView?.getComputedStyle(firstPageRoot).getPropertyValue('--templar-grid') ?? '',
  );
  const report: BaselineDiagnosticReport = {
    gridUnit: unit,
    gridOrigin: 0,
    tolerance,
    viewType: 'unknown',
    pageMode: pageRoots[0]?.dataset.templarMode ?? 'unknown',
    pageSize: 'unknown',
    pageScale: 1,
    fontFamily: 'unknown',
    fontMetrics: metrics,
    pagesChecked: 0,
    textChecked: 0,
    blocksChecked: 0,
    widgetsChecked: 0,
    maxBaselineError: 0,
    meanBaselineError: 0,
    maxBlockExitError: 0,
    correctionsApplied: 0,
    measurementPasses: resolvedOptions.stats?.measurementPasses ?? 0,
    writePasses: resolvedOptions.stats?.writePasses ?? 0,
    fullScans: resolvedOptions.stats?.fullScans ?? 0,
    dirtyScans: resolvedOptions.stats?.dirtyScans ?? 0,
    resizeObserverCallbacks: resolvedOptions.stats?.resizeObserverCallbacks ?? 0,
    mutationObserverCallbacks: resolvedOptions.stats?.mutationObserverCallbacks ?? 0,
    rafCallbacks: resolvedOptions.stats?.rafCallbacks ?? 0,
    failureCount: 0,
    failures: [],
    unit,
  };
  if (unit <= 0) return report;

  let totalBaselineError = 0;
  let baselineSamples = 0;
  let idCounter = 0;
  const views = new Set<BaselineView>();
  for (const pageRoot of pageRoots) {
    const pageContent = pageRoot.querySelector<HTMLElement>(`:scope > .${TEMPLAR_CONTENT_CLASS}`);
    if (!pageContent) continue;
    const view = viewFor(pageContent);
    views.add(view);
    const lattice = rootByPageContent.get(pageContent)?.lattice ?? latticeFor(pageContent, unit, metrics);
    const scale = geometryScale(pageContent);
    const contentRect = pageContent.getBoundingClientRect();
    const viewWindow = pageContent.ownerDocument.defaultView;
    const computedPage = viewWindow?.getComputedStyle(pageRoot);
    const computedContent = viewWindow?.getComputedStyle(pageContent);
    const pageSpan = parsePixels(computedContent?.getPropertyValue('--templar-page-span'));
    const pageHeight = parsePixels(computedContent?.getPropertyValue('--templar-page-height'));
    const pageWidth = parsePixels(computedContent?.getPropertyValue('--templar-page-width'));
    report.gridOrigin = lattice.origin;
    report.pageScale = parsePixels(computedContent?.getPropertyValue('--templar-page-scale')) || 1;
    report.pageSize = pageWidth > 0 && pageHeight > 0 ? `${String(pageWidth)}×${String(pageHeight)}` : report.pageSize;
    report.fontFamily = computedPage?.fontFamily ?? report.fontFamily;
    report.pagesChecked += 1;
    const flowItems = rootByPageContent.get(pageContent)?.flowItems ?? collectFlowItems(pageContent, view);
    const pageSpanValue = pageSpan > 0 ? pageSpan : pageHeight;

    for (const item of flowItems) {
      if (!visible(item) && !item.hasClass('templar-blank-line-spacer')) continue;
      const kind = rootByPageContent.get(pageContent)?.measurements.get(item)?.kind ??
        (item.hasClass('cm-line') ? 'editor-line' : item.matches('img') ? 'image' : 'atomic');
      const rect = item.getBoundingClientRect();
      const top = (rect.top - contentRect.top) / scale;
      const bottom = (rect.bottom - contentRect.top) / scale;
      const itemPage = pageIndex(top, pageSpanValue);
      report.blocksChecked += 1;
      if (isAtomicKind(kind)) report.widgetsChecked += 1;
      const itemStyle = viewWindow?.getComputedStyle(item);
      const entryValue = kind === 'image' || isAtomicKind(kind)
        ? top
        : (() => {
          const target = baselineTarget(item, kind);
          if (!target) return top;
          const targetRect = target.getBoundingClientRect();
          const targetStyle = viewWindow?.getComputedStyle(target);
          return (targetRect.top - contentRect.top) / scale + parsePixels(targetStyle?.paddingTop) + parsePixels(targetStyle?.borderTopWidth) + metricForElement(target, metrics).baseline;
        })();
      const entry = expectedGridPosition(entryValue, lattice);
      const entryError = distanceToGrid(entryValue, lattice);
      if (entryError > tolerance) {
        idCounter += 1;
        report.failures.push(failureFor(item, view, kind === 'editor-line' ? 'editor-line' : 'block-entry', entryValue, entry.expected, itemPage, entry.row, entryError, `baseline-${String(idCounter)}`));
      }
      const correctionBefore = parsePixels(item.style.getPropertyValue('--templar-grid-before'));
      const correctionAfter = parsePixels(item.style.getPropertyValue('--templar-grid-after'));
      if (Math.abs(correctionBefore) > 0.001 || Math.abs(correctionAfter) > 0.001) report.correctionsApplied += 1;
      if (item.hasClass('templar-blank-line-spacer')) {
        const count = Math.max(1, parsePixels(item.style.getPropertyValue('--templar-blank-lines')));
        const expectedHeight = unit * count;
        const actualHeight = rect.height / scale;
        const rowError = Math.abs(actualHeight - expectedHeight);
        if (rowError > tolerance) {
          idCounter += 1;
          report.failures.push(failureFor(item, view, 'blank-row', actualHeight, expectedHeight, itemPage, Math.round(top / unit), rowError, `baseline-${String(idCounter)}`));
        }
        continue;
      }
      const exitValue = bottom + parsePixels(itemStyle?.marginBlockEnd ?? itemStyle?.marginBottom);
      const exit = expectedGridPosition(exitValue, lattice);
      const exitError = distanceToGrid(exitValue, lattice);
      report.maxBlockExitError = Math.max(report.maxBlockExitError, exitError);
      if (exitError > tolerance) {
        idCounter += 1;
        report.failures.push(failureFor(item, view, 'block-exit', exitValue, exit.expected, itemPage, exit.row, exitError, `baseline-${String(idCounter)}`));
      }
    }

    const textCandidates = [...pageContent.querySelectorAll<HTMLElement>(TEXT_SELECTOR)]
      .filter((element) => visible(element))
      .filter((element) => !element.hasClass('HyperMD-frontmatter'))
      .filter((element) => !element.closest('.metadata-container, .mod-frontmatter, .mod-ui, .templar-blank-line-spacer'));
    for (const element of textCandidates) {
      const rect = element.getBoundingClientRect();
      const style = viewWindow?.getComputedStyle(element);
      const metric = metricForElement(element, metrics);
      const measured = (rect.top - contentRect.top) / scale + parsePixels(style?.paddingTop) + parsePixels(style?.borderTopWidth) + metric.baseline;
      const result = expectedGridPosition(measured, lattice);
      const error = distanceToGrid(measured, lattice);
      report.textChecked += 1;
      totalBaselineError += error;
      baselineSamples += 1;
      report.maxBaselineError = Math.max(report.maxBaselineError, error);
      if (error > tolerance) {
        idCounter += 1;
        report.failures.push(failureFor(element, view, 'text-baseline', measured, result.expected, pageIndex((rect.top - contentRect.top) / scale, pageSpanValue), result.row, error, `baseline-${String(idCounter)}`));
      }
    }

    for (const row of pageContent.querySelectorAll<HTMLTableRowElement>('table tr')) {
      const rect = row.getBoundingClientRect();
      if (rect.height <= 0) continue;
      const rowHeight = rect.height / scale;
      const rowError = distanceToGrid(rowHeight, { ...lattice, origin: 0 });
      if (rowError > tolerance) {
        idCounter += 1;
        const rowResult = expectedGridPosition(rowHeight, { ...lattice, origin: 0 });
        report.failures.push(failureFor(row, view, 'row-height', rowHeight, rowResult.expected, pageIndex((rect.top - contentRect.top) / scale, pageSpanValue), rowResult.row, rowError, `baseline-${String(idCounter)}`));
      }
    }
    if (pageSpanValue > 0) {
      const pageError = distanceToGrid(pageSpanValue, { ...lattice, origin: 0 });
      if (pageError > tolerance) {
        idCounter += 1;
        const pageResult = expectedGridPosition(pageSpanValue, { ...lattice, origin: 0 });
        report.failures.push(failureFor(pageContent, view, 'page-phase', pageSpanValue, pageResult.expected, 0, pageResult.row, pageError, `baseline-${String(idCounter)}`));
      }
    }
  }
  report.viewType = views.size === 1 ? [...views][0]! : views.size > 1 ? 'mixed' : 'unknown';
  report.meanBaselineError = baselineSamples > 0 ? totalBaselineError / baselineSamples : 0;
  report.failureCount = report.failures.length;
  return report;
}

export function formatBaselineDiagnostic(report: BaselineDiagnosticReport): string {
  if (report.gridUnit <= 0) return 'Ruled-line diagnostic unavailable: the active page is not gridded.';
  const status = report.failureCount === 0 ? 'PASS' : 'FAIL';
  return `Ruled-line check ${status}: ${String(report.textChecked)} text / ${String(report.blocksChecked)} blocks / ${String(report.widgetsChecked)} widgets; max baseline ${report.maxBaselineError.toFixed(3)}px, max exit ${report.maxBlockExitError.toFixed(3)}px (${String(report.failureCount)} issues).`;
}

export function serializeBaselineDiagnostic(report: BaselineDiagnosticReport): string {
  return JSON.stringify(report, null, 2);
}
